
const http = require("node:http");

const BOT_NAME = "One Stop Wellness Hub";
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const PORT = Number(process.env.PORT || 3000);
const USD_TO_INR = Number(process.env.USD_TO_INR || 85);

const WHEEL_URL =
  "https://sobtiganga5-png.github.io/one-stop-wheel/";

const CATALOGUE_URL =
  "https://docs.google.com/spreadsheets/d/1lDyik6O8-A4or25wWKdZPYIkzIQP8IcC_iGO_riBh5w/edit";

const CATALOGUE_FEED_URL =
  "https://script.google.com/macros/s/AKfycbx0OdVM3RAC2yv_AviMihqqxVKQspzTYmicE_MrpKoovMejdIgC8wgT2oXEw9aIY8yd/exec";

const CONTACT_EMAIL = "sales@bridgepointtraders.com";
const API = BOT_TOKEN
  ? `https://api.telegram.org/bot${BOT_TOKEN}`
  : "";

const sessions = new Map();
const searchResults = new Map();

async function telegram(method, data) {
  if (!BOT_TOKEN) throw new Error("Missing BOT_TOKEN");

  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20000)
  });

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.ok) {
    throw new Error(
      result?.description || `Telegram API HTTP ${response.status}`
    );
  }

  return result;
}

async function sendMessage(chatId, text, keyboard) {
  const payload = {
    chat_id: chatId,
    text: String(text).slice(0, 4000)
  };

  if (keyboard) payload.reply_markup = keyboard;

  return telegram("sendMessage", payload);
}

async function ack(callbackId) {
  try {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId
    });
  } catch (error) {
    console.error("Callback acknowledgement:", error.message);
  }
}

const mainMenu = {
  inline_keyboard: [
    [{
      text: "🛍️ Browse Live Product Catalogue",
      url: CATALOGUE_URL
    }],
    [{
      text: "🔎 Search Products",
      callback_data: "search"
    }],
    [{
      text: "🧾 Create Multi-Product Quote",
      callback_data: "quote"
    }],
    [{
      text: "🎁 Spin the Wheel",
      url: WHEEL_URL
    }],
    [
      { text: "📩 Contact Us", callback_data: "contact" },
      { text: "ℹ️ About Us", callback_data: "about" }
    ]
  ]
};

function getSession(chatId) {
  const key = String(chatId);

  if (!sessions.has(key)) {
    sessions.set(key, {
      cart: [],
      stage: "",
      pendingProduct: null,
      country: null,
      submitting: false
    });
  }

  return sessions.get(key);
}

function money(value) {
  return Number(value).toFixed(2);
}

function priceInUSD(product) {
  const raw = String(product?.priceText || "").trim();

  if (
    !raw ||
    /₹|INR|price unavailable|not available/i.test(raw)
  ) {
    return null;
  }

  // Accept prices such as "$2.50", "USD 2.50" or "USD $2.50".
  const match = raw
    .replace(/,/g, "")
    .match(/(?:USD\s*)?\$\s*(\d+(?:\.\d+)?|(?:\d+))/i)
    || raw.replace(/,/g, "").match(/USD\s*(\d+(?:\.\d+)?)/i);

  if (!match) return null;

  const value = Number(match[1]);

  return Number.isFinite(value) && value > 0
    ? value
    : null;
}

function productName(product) {
  return [
    product?.product,
    product?.brand
  ].filter(Boolean).join(" — ") || "Product";
}

function subtotalOf(session) {
  return session.cart.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
}

function cartKeyboard() {
  return {
    inline_keyboard: [
      [{
        text: "📩 Submit Order Request",
        callback_data: "submit_order"
      }],
      [{
        text: "➕ Add More Products",
        callback_data: "more"
      }],
      [{
        text: "🚚 Select Country & Calculate Total",
        callback_data: "checkout"
      }],
      [{
        text: "🗑️ Clear Cart",
        callback_data: "clearcart"
      }],
      [{
        text: "🏠 Main Menu",
        callback_data: "home"
      }]
    ]
  };
}

function quoteKeyboard() {
  return {
    inline_keyboard: [
      [{
        text: "📩 Submit Order Request",
        callback_data: "submit_order"
      }],
      [{
        text: "➕ Add More Products",
        callback_data: "more"
      }],
      [{
        text: "🧾 View Quote Cart",
        callback_data: "cart"
      }],
      [{
        text: "🏠 Main Menu",
        callback_data: "home"
      }]
    ]
  };
}

async function searchProducts(chatId, query) {
  try {
    const response = await fetch(
      `${CATALOGUE_FEED_URL}?q=${encodeURIComponent(query)}`,
      {
        redirect: "follow",
        signal: AbortSignal.timeout(20000)
      }
    );

    if (!response.ok) {
      throw new Error(`Catalogue HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data?.success || !Array.isArray(data.products)) {
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
    searchResults.set(String(chatId), products);

    const lines = products.map((product, index) => {
      const price = priceInUSD(product);

      return [
        `${index + 1}. ${productName(product)}`,
        product.salt ? `Salt: ${product.salt}` : "",
        product.packing ? `Packing: ${product.packing}` : "",
        product.category ? `Category: ${product.category}` : "",
        price === null
          ? "Price: Unavailable — cannot add to quote"
          : `Price per strip: $${money(price)}`
      ].filter(Boolean).join("\n");
    });

    const keyboard = products.map((product, index) => [{
      text: priceInUSD(product) === null
        ? `❌ ${index + 1}. Price unavailable`
        : `➕ Add ${index + 1} to quote`,
      callback_data: `add:${index}`
    }]);

    keyboard.push(
      [{ text: "🧾 View Quote Cart", callback_data: "cart" }],
      [{ text: "🔎 Search Another Product", callback_data: "more" }],
      [{ text: "🏠 Main Menu", callback_data: "home" }]
    );

    await sendMessage(
      chatId,
      `🔎 Results for "${query}"\n\n` +
      `${lines.join("\n\n")}\n\n` +
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

  const subtotal = subtotalOf(session);

  const lines = session.cart.map((item, index) =>
    `${index + 1}. ${item.name}\n` +
    `   Quantity: ${item.quantity} strips × $${money(item.price)}\n` +
    `   Line total: $${money(item.quantity * item.price)}`
  );

  await sendMessage(
    chatId,
    `🧾 YOUR QUOTATION CART\n\n` +
    `${lines.join("\n\n")}\n\n` +
    `Product subtotal: $${money(subtotal)}\n` +
    `Approx. INR subtotal: ₹${money(subtotal * USD_TO_INR)}\n\n` +
    "Submit this request now or select a destination for an estimated shipping total.",
    cartKeyboard()
  );
}

async function showFinalQuote(chatId, session, country) {
  const shipping = country === "USA" ? 70 : 35;
  const subtotal = subtotalOf(session);
  const total = subtotal + shipping;
  const countryName = country === "OTHER" ? "Other country" : country;

  const lines = session.cart.map((item, index) =>
    `${index + 1}. ${item.name}\n` +
    `   ${item.quantity} strips × $${money(item.price)} = $${money(item.quantity * item.price)}`
  );

  await sendMessage(
    chatId,
    `🧾 QUOTATION — ${countryName}\n\n` +
    `${lines.join("\n\n")}\n\n` +
    `Product subtotal: $${money(subtotal)}\n` +
    `Shipping estimate: $${money(shipping)}\n` +
    `ESTIMATED GRAND TOTAL: $${money(total)}\n\n` +
    `Approx. INR total (1 USD = ₹${money(USD_TO_INR)}): ₹${money(total * USD_TO_INR)}\n\n` +
    "Shipping and availability must be confirmed by our team. This is an estimate, not an order confirmation.",
    quoteKeyboard()
  );
}

async function submitOrder(chatId, from) {
  const session = getSession(chatId);

  if (!session.cart.length) {
    await sendMessage(
      chatId,
      "Your quote cart is empty. Add products before submitting.",
      mainMenu
    );
    return;
  }

  if (!ADMIN_CHAT_ID) {
    console.error("Missing ADMIN_CHAT_ID environment variable.");

    await sendMessage(
      chatId,
      "Order submission is not configured yet. Please contact our team.",
      mainMenu
    );
    return;
  }

  if (session.submitting) {
    await sendMessage(
      chatId,
      "Your request is already being submitted. Please wait."
    );
    return;
  }

  session.submitting = true;

  try {
    const subtotal = subtotalOf(session);
    const countryNames = {
      USA: "USA",
      UK: "UK",
      OTHER: "Other country"
    };

    const shipping = session.country
      ? (session.country === "USA" ? 70 : 35)
      : null;

    const total = shipping === null
      ? null
      : subtotal + shipping;

    const customerName = [
      from?.first_name,
      from?.last_name
    ].filter(Boolean).join(" ") || "Not provided";

    const username = from?.username
      ? `@${from.username}`
      : "Not set";

    const items = session.cart.map((item, index) =>
      `${index + 1}. ${item.name}\n` +
      `   Quantity: ${item.quantity} strips\n` +
      `   Unit price: $${money(item.price)}\n` +
      `   Line total: $${money(item.price * item.quantity)}`
    ).join("\n\n");

    const adminMessage =
      `📩 NEW PRODUCT ORDER REQUEST\n\n` +
      `Customer: ${customerName}\n` +
      `Telegram username: ${username}\n` +
      `Telegram user ID: ${from?.id || chatId}\n` +
      `Customer chat ID: ${chatId}\n\n` +
      `PRODUCTS\n${items}\n\n` +
      `Product subtotal: $${money(subtotal)}\n` +
      `Destination: ${session.country ? (countryNames[session.country] || session.country) : "Not selected"}\n` +
      `Shipping estimate: ${shipping === null ? "To be confirmed" : "$" + money(shipping)}\n` +
      `Estimated total: ${total === null ? "To be confirmed" : "$" + money(total)}\n\n` +
      `Request time: ${new Date().toISOString()}\n` +
      `Status: Pending team review`;

    // Send the request to the configured admin Telegram chat.
    await sendMessage(ADMIN_CHAT_ID, adminMessage);

    // Clear the cart only after Telegram confirms delivery.
    session.cart = [];
    session.country = null;
    session.stage = "";
    session.pendingProduct = null;

    await sendMessage(
      chatId,
      "✅ Your product request has been submitted successfully!\n\n" +
      "Our team will review the requested products, quantities and shipping details. This is an enquiry, not a confirmed order.",
      mainMenu
    );
  } catch (error) {
    console.error("Order submission error:", error.message);

    await sendMessage(
      chatId,
      "⚠️ We couldn't confirm that your request was submitted. Your cart has been kept. Please try again or contact our team.",
      {
        inline_keyboard: [
          [{ text: "🔁 Try Submission Again", callback_data: "submit_order" }],
          [{ text: "📩 Contact Us", callback_data: "contact" }],
          [{ text: "🏠 Main Menu", callback_data: "home" }]
        ]
      }
    );
  } finally {
    session.submitting = false;
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    const callback = update.callback_query;
    const chatId = callback.message?.chat?.id;

    await ack(callback.id);

    if (!chatId) return;

    const session = getSession(chatId);
    const action = callback.data || "";

    if (["search", "quote", "more"].includes(action)) {
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
      const product = (searchResults.get(String(chatId)) || [])[index];

      if (!product) {
        await sendMessage(
          chatId,
          "These search results have expired. Please search again.",
          mainMenu
        );
        return;
      }

      const price = priceInUSD(product);

      if (price === null) {
        await sendMessage(
          chatId,
          "This product has no usable USD price in the public catalogue, so it cannot be added to the quote."
        );
        return;
      }

      session.pendingProduct = {
        name: productName(product),
        price
      };

      session.stage = "quantity";

      await sendMessage(
        chatId,
        `➕ ${session.pendingProduct.name}\n` +
        `Price per strip: $${money(price)}\n\n` +
        "Enter the quantity in strips (whole number, e.g. 10)."
      );
      return;
    }

    if (action === "cart") {
      await showCart(chatId);
      return;
    }

    if (action === "submit_order") {
      await submitOrder(chatId, callback.from);
      return;
    }

    if (action === "clearcart") {
      session.cart = [];
      session.country = null;
      session.stage = "";
      session.pendingProduct = null;

      await sendMessage(
        chatId,
        "Your quotation cart has been cleared.",
        mainMenu
      );
      return;
    }

    if (action === "checkout") {
      if (!session.cart.length) {
        await showCart(chatId);
        return;
      }

      session.stage = "country";

      await sendMessage(
        chatId,
        "🌍 Select the destination country for shipping:",
        {
          inline_keyboard: [
            [{ text: "🇺🇸 USA — $70 shipping estimate", callback_data: "country:USA" }],
            [{ text: "🇬🇧 UK — $35 shipping estimate", callback_data: "country:UK" }],
            [{ text: "🌍 All Other Countries — $35 estimate", callback_data: "country:OTHER" }],
            [{ text: "⬅️ Back to Cart", callback_data: "cart" }]
          ]
        }
      );
      return;
    }

    if (action.startsWith("country:")) {
      const country = action.split(":")[1];

      if (!["USA", "UK", "OTHER"].includes(country)) {
        await sendMessage(chatId, "Please select a valid destination.", mainMenu);
        return;
      }

      if (!session.cart.length) {
        await showCart(chatId);
        return;
      }

      session.country = country;
      session.stage = "";

      await showFinalQuote(chatId, session, country);
      return;
    }

    if (action === "contact") {
      await sendMessage(
        chatId,
        `📩 Contact Us\n\nTelegram: @gangasobti\nEmail: ${CONTACT_EMAIL}`,
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
        "Explore our pharmaceutical catalogue and connect with our team for product enquiries and support.",
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

      await sendMessage(
        chatId,
        `Welcome to ${BOT_NAME}! 👋\n\nChoose an option below:`,
        mainMenu
      );
    }

    return;
  }

  if (!update.message?.chat) return;

  const chatId = update.message.chat.id;
  const text = (update.message.text || "").trim();

  if (!text) return;

  const session = getSession(chatId);

  if (text === "/start" || text.startsWith("/start ")) {
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

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000000
    ) {
      await sendMessage(
        chatId,
        "Please enter a whole number of strips, such as 10. To cancel, send /cancel."
      );
      return;
    }

    const item = session.pendingProduct;

    if (!item) {
      session.stage = "";

      await sendMessage(
        chatId,
        "Please search for the product again.",
        mainMenu
      );
      return;
    }

    const existing = session.cart.find(
      product =>
        product.name === item.name &&
        product.price === item.price
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
          [{ text: "📩 Submit Order Request", callback_data: "submit_order" }],
          [{ text: "🚚 Calculate Total & Shipping", callback_data: "checkout" }]
        ]
      }
    );
    return;
  }

  // Any other ordinary message is treated as a product search.
  await searchProducts(chatId, text);
}

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    res.end(`${BOT_NAME} is running.`);
    return;
  }

  if (req.method !== "POST" || req.url !== "/telegram") {
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    res.end("Not found");
    return;
  }

  let body = "";
  let tooLarge = false;

  req.on("data", chunk => {
    body += chunk;

    if (Buffer.byteLength(body, "utf8") > 1000000) {
      tooLarge = true;
      res.writeHead(413, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      res.end("Payload too large");
      req.destroy();
    }
  });

  req.on("end", async () => {
    if (tooLarge) return;

    try {
      const update = JSON.parse(body);
      await handleUpdate(update);

      if (!res.headersSent) {
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8"
        });
        res.end("OK");
      }
    } catch (error) {
      console.error("Update handling error:", error.message);

      if (!res.headersSent) {
        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8"
        });
        res.end("OK");
      }
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
    await telegram("setWebhook", {
      url: `${baseUrl.replace(/\/$/, "")}/telegram`
    });

    console.log("Telegram webhook configured successfully.");
  } catch (error) {
    console.error("Webhook setup error:", error.message);
  }
});
