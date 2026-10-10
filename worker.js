
const http = require("node:http");

const BOT_NAME = "One Stop Wellness Hub";
const WHEEL_URL = "https://sobtiganga5-png.github.io/one-stop-wheel/";
const CATALOGUE_FEED_URL =
  "https://script.google.com/macros/s/AKfycbx0OdVM3RAC2yv_AviMihqqxVKQspzTYmicE_MrpKoovMejdIgC8wgT2oXEw9aIY8yd/exec";
const CONTACT_EMAIL = "sales@bridgepointtraders.com";

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable.");
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const sessions = new Map();

async function telegram(method, data = {}) {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram HTTP ${response.status}`);
  }

  return result.result;
}

async function sendMessage(chatId, text, replyMarkup) {
  const data = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  };

  if (replyMarkup) data.reply_markup = replyMarkup;

  return telegram("sendMessage", data);
}

async function answerCallback(callbackId, text = "") {
  try {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId,
      text
    });
  } catch (error) {
    console.error("Callback response error:", error.message);
  }
}

function mainMenu() {
  return {
    inline_keyboard: [
      [
        {
          text: "🎁 Spin the Wheel",
          web_app: { url: WHEEL_URL }
        }
      ],
      [
        { text: "🔎 Browse Products", callback_data: "browse" },
        { text: "📩 Contact Us", callback_data: "contact" }
      ],
      [
        { text: "ℹ️ About Us", callback_data: "about" }
      ]
    ]
  };
}

function welcomeMessage() {
  return (
    `Welcome to ${BOT_NAME}! 👋\n\n` +
    "Explore our public product catalogue, search by product name " +
    "or brand, and request a quotation.\n\n" +
    "Choose an option below to get started."
  );
}

async function getCatalogue() {
  const response = await fetch(CATALOGUE_FEED_URL, {
    headers: { "Cache-Control": "no-cache" }
  });

  if (!response.ok) {
    throw new Error(`Catalogue feed HTTP ${response.status}`);
  }

  const data = await response.json();

  if (!data.success || !Array.isArray(data.products)) {
    throw new Error(data.error || "Invalid catalogue feed response");
  }

  return data.products;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchMatches(products, query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);

  if (!terms.length) return [];

  return products.filter(product => {
    const searchable = normalize([
      product.product,
      product.salt,
      product.brand,
      product.packing,
      product.category
    ].join(" "));

    return terms.every(term => searchable.includes(term));
  });
}

function parsePrice(priceText) {
  const cleaned = String(priceText || "")
    .replace(/,/g, "")
    .replace(/[^0-9.]/g, "");

  const price = Number(cleaned);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function formatMoney(amount) {
  return "$" + amount.toFixed(2);
}

async function searchProducts(chatId, query) {
  await sendMessage(chatId, "🔎 Searching your live public catalogue...");

  try {
    const products = await getCatalogue();
    const matches = searchMatches(products, query).slice(0, 10);

    if (!matches.length) {
      await sendMessage(
        chatId,
        `No matching products found for: ${query}\n\n` +
        "Try the product name, brand name, or strength. " +
        "You can also contact us for assistance.",
        {
          inline_keyboard: [
            [{ text: "📩 Contact Us", callback_data: "contact" }],
            [{ text: "🏠 Main Menu", callback_data: "home" }]
          ]
        }
      );
      return;
    }

    const session = sessions.get(chatId) || {};
    session.searchResults = matches;
    session.stage = null;
    sessions.set(chatId, session);

    await sendMessage(
      chatId,
      `Found ${matches.length} matching product(s).\n\n` +
      "Select a product below to view its details and request a quotation."
    );

    for (let i = 0; i < matches.length; i++) {
      const product = matches[i];
      const price = parsePrice(product.priceText);

      const details = [
        `📦 ${product.product}`,
        product.salt ? `Content: ${product.salt}` : null,
        product.brand ? `Brand: ${product.brand}` : null,
        product.packing ? `Packing: ${product.packing}` : null,
        `Category: ${product.category}`,
        price !== null
          ? `Catalogue price: ${formatMoney(price)} per listed packing unit`
          : `Catalogue price: ${product.priceText || "Please enquire"}`
      ].filter(Boolean).join("\n");

      await sendMessage(chatId, details, {
        inline_keyboard: [
          [{
            text: "🧾 Request Quotation",
            callback_data: `quote:${i}`
          }]
        ]
      });
    }

    await sendMessage(chatId, "What would you like to do next?", mainMenu());
  } catch (error) {
    console.error("Catalogue search error:", error.message);

    await sendMessage(
      chatId,
      "Sorry, I couldn't access the catalogue right now. " +
      "Please try again shortly or contact " + CONTACT_EMAIL + ".",
      mainMenu()
    );
  }
}

async function startQuotation(chatId, index) {
  const session = sessions.get(chatId);
  const product = session?.searchResults?.[index];

  if (!product) {
    await sendMessage(
      chatId,
      "That product selection has expired. Please search again.",
      mainMenu()
    );
    return;
  }

  session.selectedProduct = product;
  session.stage = "quantity";
  session.quantity = null;
  session.country = null;
  sessions.set(chatId, session);

  await sendMessage(
    chatId,
    `🧾 Quotation Request\n\n` +
    `Product: ${product.product}\n` +
    `Packing: ${product.packing || "As listed"}\n` +
    `Catalogue price: ${product.priceText || "Please enquire"}\n\n` +
    "Enter the quantity of listed packing units you require.\n\n" +
    "Example: 10"
  );
}

async function handleQuotationMessage(chatId, text) {
  const session = sessions.get(chatId);

  if (!session || !session.stage) return false;

  if (session.stage === "quantity") {
    const quantity = Number(String(text).trim());

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) {
      await sendMessage(
        chatId,
        "Please enter a valid whole-number quantity, such as 10."
      );
      return true;
    }

    session.quantity = quantity;
    session.stage = "country";
    sessions.set(chatId, session);

    await sendMessage(
      chatId,
      "🌍 Which country should the order be shipped to?\n\n" +
      "Enter the destination country."
    );
    return true;
  }

  if (session.stage === "country") {
    const country = String(text).trim();

    if (country.length < 2 || country.length > 100) {
      await sendMessage(chatId, "Please enter a valid destination country.");
      return true;
    }

    session.country = country;
    session.stage = "confirm";
    sessions.set(chatId, session);

    const product = session.selectedProduct;
    const unitPrice = parsePrice(product.priceText);
    const total = unitPrice !== null
      ? formatMoney(unitPrice * session.quantity)
      : "To be confirmed";

    const summary =
      "🧾 YOUR QUOTATION REQUEST\n\n" +
      `Product: ${product.product}\n` +
      `Content: ${product.salt || "As listed"}\n` +
      `Brand: ${product.brand || "As listed"}\n` +
      `Packing per unit: ${product.packing || "As listed"}\n` +
      `Quantity: ${session.quantity} packing unit(s)\n` +
      `Destination: ${country}\n` +
      `Catalogue unit price: ${product.priceText || "To be confirmed"}\n` +
      `Estimated product subtotal: ${total}\n\n` +
      "This is an estimate based on the listed catalogue price. " +
      "Shipping, applicable taxes, export eligibility, availability, " +
      "and other charges are not included. Final pricing and shipment " +
      "are subject to confirmation and applicable laws.";

    session.quoteSummary = summary;
    sessions.set(chatId, session);

    await sendMessage(chatId, summary, {
      inline_keyboard: [
        [{ text: "✅ Submit Request", callback_data: "submit_quote" }],
        [{ text: "❌ Cancel", callback_data: "cancel_quote" }]
      ]
    });

    return true;
  }

  return false;
}

async function handleCallback(callback) {
  const chatId = callback.message?.chat?.id;
  const data = callback.data || "";

  await answerCallback(callback.id);

  if (!chatId) return;

  if (data === "home") {
    const session = sessions.get(chatId);
    if (session) session.stage = null;
    await sendMessage(chatId, welcomeMessage(), mainMenu());
    return;
  }

  if (data === "browse") {
    const session = sessions.get(chatId) || {};
    session.stage = "search";
    sessions.set(chatId, session);

    await sendMessage(
      chatId,
      "🔎 Enter the product name, brand, or strength you want to find.\n\n" +
      "Example: EXTRA SUPER AVANA"
    );
    return;
  }

  if (data === "contact") {
    await sendMessage(
      chatId,
      "📩 Contact Us\n\n" +
      "Bridge Point Traders\n" +
      `Email: ${CONTACT_EMAIL}\n\n` +
      "Send us your product requirements for assistance.",
      mainMenu()
    );
    return;
  }

  if (data === "about") {
    await sendMessage(
      chatId,
      "ℹ️ About Us\n\n" +
      "Bridge Point Traders is a pharmaceutical trading and export business " +
      "based in India. Product availability, export eligibility, and " +
      "shipping depend on the destination country's applicable requirements.\n\n" +
      `Contact: ${CONTACT_EMAIL}`,
      mainMenu()
    );
    return;
  }

  if (data.startsWith("quote:")) {
    const index = Number(data.split(":")[1]);

    if (!Number.isInteger(index) || index < 0) {
      await sendMessage(chatId, "Invalid selection. Please search again.");
      return;
    }

    await startQuotation(chatId, index);
    return;
  }

  if (data === "submit_quote") {
    const session = sessions.get(chatId);

    if (!session?.quoteSummary || !session.selectedProduct) {
      await sendMessage(
        chatId,
        "Your quotation request has expired. Please search again.",
        mainMenu()
      );
      return;
    }

    session.stage = null;
    sessions.set(chatId, session);

    await sendMessage(
      chatId,
      "✅ Your quotation request has been recorded in this chat.\n\n" +
      "To obtain a confirmed quotation, email your requirements to " +
      `${CONTACT_EMAIL}.\n\n` +
      "Please include your destination country and any additional requirements.",
      mainMenu()
    );
    return;
  }

  if (data === "cancel_quote") {
    const session = sessions.get(chatId);
    if (session) session.stage = null;

    await sendMessage(chatId, "Quotation request cancelled.", mainMenu());
  }
}

async function handleMessage(message) {
  if (!message?.chat?.id || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text === "/start" || text === "/menu") {
    sessions.delete(chatId);
    await sendMessage(chatId, welcomeMessage(), mainMenu());
    return;
  }

  if (text === "/help") {
    await sendMessage(
      chatId,
      "Use /start to open the menu.\n" +
      "Use Browse Products to search the public catalogue.\n" +
      "You can also type a product name directly.",
      mainMenu()
    );
    return;
  }

  const session = sessions.get(chatId);

  if (session?.stage === "quantity" || session?.stage === "country") {
    const handled = await handleQuotationMessage(chatId, text);
    if (handled) return;
  }

  if (session?.stage === "search") {
    session.stage = null;
    sessions.set(chatId, session);
    await searchProducts(chatId, text);
    return;
  }

  if (text.startsWith("/")) {
    await sendMessage(chatId, "Choose an option from the menu.", mainMenu());
    return;
  }

  await searchProducts(chatId, text);
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`${BOT_NAME} is running.`);
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  let body = "";

  req.on("data", chunk => {
    body += chunk;
    if (body.length > 1_000_000) req.destroy();
  });

  req.on("end", async () => {
    try {
      const update = JSON.parse(body || "{}");

      // Respond to Telegram promptly; process the update afterward.
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");

      if (update.callback_query) {
        await handleCallback(update.callback_query);
      } else if (update.message) {
        await handleMessage(update.message);
      }
    } catch (error) {
      console.error("Webhook processing error:", error.message);

      if (!res.writableEnded) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("OK");
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`${BOT_NAME} listening on port ${PORT}`);
});
