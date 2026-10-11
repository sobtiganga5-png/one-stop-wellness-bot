
const http = require("node:http");

const BOT_NAME = "One Stop Wellness Hub";
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

const WHEEL_URL =
  "https://sobtiganga5-png.github.io/one-stop-wheel/";

const CATALOGUE_URL =
  "https://docs.google.com/spreadsheets/d/1lDyik6O8-A4or25wWKdZPYIkzIQP8IcC_iGO_riBh5w/edit";

const CATALOGUE_FEED_URL =
  "https://script.google.com/macros/s/AKfycbx0OdVM3RAC2yv_AviMihqqxVKQspzTYmicE_MrpKoovMejdIgC8wgT2oXEw9aIY8yd/exec";

const CONTACT_EMAIL = "sales@bridgepointtraders.com";

// Set USD_TO_INR in Render environment variables to your chosen rate.
// Fallback is configurable; verify the rate before sending quotations.
const USD_TO_INR = Number(process.env.USD_TO_INR || 85);

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Temporary in-memory sessions. Sessions reset if the service restarts.
const sessions = new Map();
const searchResults = new Map();

async function telegram(method, data) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  const result = await response.json();

  if (!result.ok) {
    console.error("Telegram API error:", result.description);
  }

  return result;
}

async function sendMessage(chatId, text, keyboard) {
  const payload = { chat_id: chatId, text };
  if (keyboard) payload.reply_markup = keyboard;
  return telegram("sendMessage", payload);
}

const mainMenu = {
  inline_keyboard: [
    [{ text: "🛍️ Browse Live Product Catalogue", url: CATALOGUE_URL }],
    [{ text: "🔎 Search Products", callback_data: "search" }],
    [{ text: "🧾 Create Multi-Product Quote", callback_data: "quote" }],
    [{ text: "🎁 Spin the Wheel", url: WHEEL_URL }],
    [
      { text: "📩 Contact Us", callback_data: "contact" },
      { text: "ℹ️ About Us", callback_data: "about" }
    ]
  ]
};

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, { cart: [], stage: "" });
  }
  return sessions.get(chatId);
}

function priceInUSD(product) {
  const raw = String(product.priceText || "").trim();

  if (!raw || /₹|INR|price unavailable|not available/i.test(raw)) {
    return null;
  }

  // Catalogue prices are expected to be in USD per strip.
  const match = raw.replace(/,/g, "").match(/(?:USD|\$)?\s*(\d+(?:\.\d+)?)/i);
  if (!match) return null;

  const price = Number(match[1]);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function productName(product) {
  return [product.product, product.brand]
    .filter(Boolean)
    .join(" — ") || "Product";
}

function money(amount) {
  return Number(amount).toFixed(2);
}

async function searchProducts(chatId, query) {
  try {
    const url = `${CATALOGUE_FEED_URL}?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      throw new Error(`Catalogue returned HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data.success || !Array.isArray(data.products)) {
      throw new Error("Invalid catalogue response");
    }

    if (!data.products.length) {
      await sendMessage(
        chatId,
        `No matching products found for "${query}". Try another name or open the catalogue.`,
        mainMenu
      );
      return;
    }

    const products = data.products.slice(0, 10);
    searchResults.set(chatId, products);

    const lines = products.map((p, i) => {
      const price = priceInUSD(p);
      return [
        `${i + 1}. ${productName(p)}`,
        p.salt ? `Salt: ${p.salt}` : "",
        p.packing ? `Packing: ${p.packing}` : "",
        p.category ? `Category: ${p.category}` : "",
        price === null
          ? "Price: Unavailable — cannot add to quote"
          : `Price per strip: $${money(price)}`
      ].filter(Boolean).join("\n");
    });

    const keyboard = products.map((p, i) => [{
      text: priceInUSD(p) === null
        ? `❌ ${i + 1}. Price unavailable`
        : `➕ Add ${i + 1} to quote`,
      callback_data: `add:${i}`
    }]);

    keyboard.push(
      [{ text: "🧾 View Quote Cart", callback_data: "cart" }],
      [{ text: "🔎 Search Another Product", callback_data: "more" }],
      [{ text: "🏠 Main Menu", callback_data: "home" }]
    );

    await sendMessage(
      chatId,
      `🔎 Results for "${query}"\n\n${lines.join("\n\n")}\n\n` +
      "Tap an Add button to include a product in your quotation.",
      { inline_keyboard: keyboard }
    );
  } catch (error) {
    console.error("Product search error:", error.message);
    await sendMessage(
      chatId,
      "Live product search is temporarily unavailable. Please try again or open the catalogue.",
      mainMenu
    );
  }
}

async function showCart(chatId) {
  const session = getSession(chatId);

  if (!session.cart.length) {
    await sendMessage(
      chatId,
      "Your quote cart is empty. Search for a product to get started.",
      {
        inline_keyboard: [
          [{ text: "🔎 Search Products", callback_data: "more" }],
          [{ text: "🏠 Main Menu", callback_data: "home" }]
        ]
      }
    );
    return;
  }

  let subtotal = 0;
  const lines = session.cart.map((item, i) => {
    const lineTotal = item.price * item.quantity;
    subtotal += lineTotal;
    return `${i + 1}. ${item.name}\n` +
      `   Quantity: ${item.quantity} strips × $${money(item.price)}\n` +
      `   Line total: $${money(lineTotal)}`;
  });

  await sendMessage(
    chatId,
    `🧾 YOUR QUOTATION CART\n\n${lines.join("\n\n")}\n\n` +
    `Subtotal: $${money(subtotal)}\n` +
    `Approx. INR subtotal: ₹${money(subtotal * USD_TO_INR)}\n\n` +
    "Add more products or proceed to shipping.",
    {
      inline_keyboard: [
        [{ text: "➕ Add More Products", callback_data: "more" }],
        [{ text: "🚚 Select Country & Calculate Total", callback_data: "checkout" }],
        [{ text: "🗑️ Clear Cart", callback_data: "clearcart" }],
        [{ text: "🏠 Main Menu", callback_data: "home" }]
      ]
    }
  );
}

async function handleUpdate(update) {
  if (update.callback_query) {
    const callback = update.callback_query;
    const chatId = callback.message?.chat?.id;

    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id
    });

    if (!chatId) return;

    const session = getSession(chatId);
    const action = callback.data || "";

    if (action === "search" || action === "quote" || action === "more") {
      session.stage = "search";
      await sendMessage(
        chatId,
        action === "quote"
          ? "🧾 Let's build your quotation.\n\nEnter the first product name or brand."
          : "🔎 Enter a product name, brand, salt or strength.\n\nExample: EXTRA SUPER AVANA",
        {
          inline_keyboard: [
            [{ text: "🛍️ Open Live Catalogue", url: CATALOGUE_URL }],
            [{ text: "🏠 Main Menu", callback_data: "home" }]
          ]
        }
      );
      return;
    }

    if (action.startsWith("add:")) {
      const index = Number(action.split(":")[1]);
      const products = searchResults.get(chatId) || [];
      const product = products[index];

      if (!product) {
        await sendMessage(chatId, "These search results have expired. Please search again.", mainMenu);
        return;
      }

      const price = priceInUSD(product);
      if (price === null) {
        await sendMessage(chatId, "This product has no usable USD price in the public catalogue, so it cannot be added to the quote.");
        return;
      }

      session.pendingProduct = {
        name: productName(product),
        price
      };
      session.stage = "quantity";

      await sendMessage(
        chatId,
        `➕ ${session.pendingProduct.name}\nPrice per strip: $${money(price)}\n\nEnter the quantity in strips (whole number, e.g. 10).`
      );
      return;
    }

    if (action === "cart") {
      await showCart(chatId);
      return;
    }

    if (action === "clearcart") {
      session.cart = [];
      session.stage = "";
      await sendMessage(chatId, "Your quotation cart has been cleared.", mainMenu);
      return;
    }

    if (action === "checkout") {
      if (!session.cart.length) {
        await showCart(chatId);
        return;
      }

      session.stage = "country";
      await sendMessage(chatId, "🌍 Select the destination country for shipping:", {
        inline_keyboard: [
          [{ text: "🇺🇸 USA — $70 shipping", callback_data: "country:USA" }],
          [{ text: "🇬🇧 UK — $35 shipping", callback_data: "country:UK" }],
          [{ text: "🌍 All Other Countries — $35", callback_data: "country:OTHER" }],
          [{ text: "⬅️ Back to Cart", callback_data: "cart" }]
        ]
      });
      return;
    }

    if (action.startsWith("country:")) {
      const country = action.split(":")[1];
      const shipping = country === "USA" ? 70 : 35;
      const subtotal = session.cart.reduce(
        (sum, item) => sum + item.price * item.quantity, 0
      );
      const total = subtotal + shipping;
      const countryName = country === "OTHER" ? "Other country" : country;

      session.stage = "";
      session.country = country;

      const lines = session.cart.map((item, i) =>
        `${i + 1}. ${item.name}\n` +
        `   ${item.quantity} strips × $${money(item.price)} = $${money(item.quantity * item.price)}`
      );

      await sendMessage(
        chatId,
        `🧾 QUOTATION — ${countryName}\n\n` +
        `${lines.join("\n\n")}\n\n` +
        `Product subtotal: $${money(subtotal)}\n` +
        `Shipping: $${money(shipping)}\n` +
        `GRAND TOTAL: $${money(total)}\n\n` +
        `Approx. INR total (1 USD = ₹${money(USD_TO_INR)}): ₹${money(total * USD_TO_INR)}\n\n` +
        "INR is an indicative conversion using the configured exchange rate. Please confirm product availability, shipping and final pricing with our team.",
        {
          inline_keyboard: [
            [{ text: "➕ Add More Products", callback_data: "more" }],
            [{ text: "📩 Contact Us", callback_data: "contact" }],
            [{ text: "🏠 Main Menu", callback_data: "home" }]
          ]
        }
      );
      return;
    }

    if (action === "contact") {
      await sendMessage(
        chatId,
        "📩 Contact Us\n\nContact us directly on Telegram: @gangasobti",
        {
          inline_keyboard: [
            [{ text: "📩 Message Us on Telegram", url: "https://t.me/gangasobti" }],
            [{ text: "🏠 Main Menu", callback_data: "home" }]
          ]
        }
      );
      return;
    }

    if (action === "about") {
      await sendMessage(
        chatId,
        "ℹ️ About One Stop Wellness Hub\n\n" +
        "Welcome to One Stop Wellness Hub, powered by Bridge Point Traders.\n\n" +
        "Explore our pharmaceutical catalogue, learn about our packing process, and connect with our team for product enquiries and support.",
        {
          inline_keyboard: [
            [{ text: "📦 Packing Video", url: "https://drive.google.com/file/d/1NVOLL7gBCUrirTiSsPb6nDO4otgOQdue/view?usp=sharing" }],
            [{ text: "🏬 Store Tour", url: "https://drive.google.com/file/d/1Ff3IgHrcc-QUS8RUMBa6N_5SXu4PmgaJ/view?usp=sharing" }],
            [{ text: "🏠 Main Menu", callback_data: "home" }]
          ]
        }
      );
      return;
    }

    if (action === "home") {
      session.stage = "";
      await sendMessage(chatId, `Welcome to ${BOT_NAME}! 👋\n\nChoose an option below:`, mainMenu);
    }

    return;
  }

  if (!update.message || !update.message.chat) return;

  const chatId = update.message.chat.id;
  const text = (update.message.text || "").trim();
  if (!text) return;

  const session = getSession(chatId);

  if (text === "/start" || text === "/start@OneStopWellnessBot") {
    session.stage = "";
    await sendMessage(
      chatId,
      `Welcome to ${BOT_NAME}! 👋\n\n` +
      "Browse our live catalogue, search products or create a multi-product quotation.\n\n" +
      "Choose an option below:",
      mainMenu
    );
    return;
  }

  if (text === "/help") {
    await sendMessage(
      chatId,
      "Use /start for the main menu. Search for products or choose Create Multi-Product Quote to build a quotation.",
      mainMenu
    );
    return;
  }

  if (text === "/cancel") {
    session.stage = "";
    session.pendingProduct = null;
    await sendMessage(chatId, "Current step cancelled.", mainMenu);
    return;
  }

  if (text.startsWith("/")) {
    await sendMessage(chatId, "Please choose an option:", mainMenu);
    return;
  }

  if (session.stage === "quantity") {
    const quantity = Number(text);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) {
      await sendMessage(chatId, "Please enter a whole number of strips, such as 10. To cancel, send /cancel.");
      return;
    }

    const item = session.pendingProduct;
    if (!item) {
      session.stage = "";
      await sendMessage(chatId, "Please search for the product again.", mainMenu);
      return;
    }

    const existing = session.cart.find(
      p => p.name === item.name && p.price === item.price
    );

    if (existing) {
      existing.quantity += quantity;
    } else {
      session.cart.push({ ...item, quantity });
    }

    session.pendingProduct = null;
    session.stage = "";

    await sendMessage(
      chatId,
      `✅ Added ${quantity} strips of ${item.name} to your quote.`,
      {
        inline_keyboard: [
          [{ text: "➕ Add Another Product", callback_data: "more" }],
          [{ text: "🧾 View Quote Cart", callback_data: "cart" }],
          [{ text: "🚚 Calculate Total & Shipping", callback_data: "checkout" }]
        ]
      }
    );
    return;
  }

  // Normal product search remains available from chat.
  await searchProducts(chatId, text);
}

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`${BOT_NAME} is running.`);
    return;
  }

  if (req.method !== "POST" || req.url !== "/telegram") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  let body = "";

  req.on("data", chunk => {
    body += chunk;
    if (body.length > 1000000) req.destroy();
  });

  req.on("end", async () => {
    try {
      const update = JSON.parse(body);
      await handleUpdate(update);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    } catch (error) {
      console.error("Update handling error:", error.message);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    }
  });
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`${BOT_NAME} listening on port ${PORT}`);

  const baseUrl = process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) {
    console.error("Missing RENDER_EXTERNAL_URL on Render.");
    return;
  }

  try {
    const result = await telegram("setWebhook", {
      url: `${baseUrl}/telegram`
    });

    if (result.ok) {
      console.log("Telegram webhook configured successfully.");
    } else {
      console.error("Webhook configuration failed:", result.description);
    }
  } catch (error) {
    console.error("Webhook setup error:", error.message);
  }
});
