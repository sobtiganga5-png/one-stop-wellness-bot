
const http = require("node:http");

const BOT_NAME = "One Stop Wellness Hub";
const WHEEL_URL = "https://sobtiganga5-png.github.io/one-stop-wheel/";
const SHEET_ID = "1lDyik6O8-A4or25wWKdZPYIkzIQP8IcC_iGO_riBh5w";
const SHEET_GID = "1057980873";
const CATALOGUE_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}#gid=${SHEET_GID}`;
const CSV_URL =
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
const CONTACT_EMAIL = "sales@bridgepointtraders.com";

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL;

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable.");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const sessions = new Map();

async function telegram(method, data = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  const result = await response.json();
  if (!result.ok) {
    console.error(`Telegram ${method} failed:`, result.description);
  }
  return result;
}

async function sendMessage(chatId, text, replyMarkup) {
  const data = { chat_id: chatId, text };
  if (replyMarkup) data.reply_markup = replyMarkup;
  return telegram("sendMessage", data);
}

async function sendWelcome(chatId) {
  sessions.delete(String(chatId));

  return sendMessage(
    chatId,
    `👋 Welcome to ${BOT_NAME}!\n\n` +
      "Your pharmaceutical and dermatology product supply contact.\n\n" +
      "Please choose an option below:",
    {
      inline_keyboard: [
        [{ text: "🎁 Spin the Wheel", web_app: { url: WHEEL_URL } }],
        [{ text: "🛍️ Browse Products", callback_data: "products" }],
        [{ text: "🧾 Request a Quotation", callback_data: "quotation" }],
        [{ text: "📩 Contact Us", callback_data: "contact" }],
        [{ text: "ℹ️ About Us", callback_data: "about" }]
      ]
    }
  );
}

// Parse CSV while preserving commas inside quoted cells.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value !== "")) rows.push(row);
  return rows;
}

async function getCatalogue() {
  const response = await fetch(CSV_URL, {
    headers: { "Cache-Control": "no-cache" }
  });

  if (!response.ok) {
    throw new Error(`Google Sheets returned HTTP ${response.status}`);
  }

  const csv = await response.text();

  if (csv.trim().startsWith("<!DOCTYPE html") ||
      csv.trim().startsWith("<html")) {
    throw new Error("Google Sheet did not return CSV. Check link access.");
  }

  const rows = parseCSV(csv);
  const headerIndex = rows.findIndex(row =>
    row.some(cell => /PRODUCT NAME/i.test(cell)) &&
    row.some(cell => /PACKING/i.test(cell)) &&
    row.some(cell => /RATE\s*\(USD\)/i.test(cell))
  );

  if (headerIndex < 0) {
    throw new Error("Could not find catalogue column headings.");
  }

  const headers = rows[headerIndex].map(v => v.toUpperCase());
  const column = pattern => headers.findIndex(h => pattern.test(h));

  const productCol = column(/PRODUCT NAME/);
  const saltCol = column(/SALT|CONTENT/);
  const packingCol = column(/PACKING/);
  const brandCol = column(/BRAND/);
  const priceCol = column(/RATE\s*\(USD\)/);

  return rows.slice(headerIndex + 1)
    .map(row => ({
      product: row[productCol] || "",
      salt: saltCol >= 0 ? row[saltCol] || "" : "",
      packing: row[packingCol] || "",
      brand: brandCol >= 0 ? row[brandCol] || "" : "",
      priceText: row[priceCol] || ""
    }))
    .filter(item => item.product && item.packing);
}

function parsePrice(value) {
  const cleaned = String(value).replace(/[$,\s]/g, "");
  if (!cleaned || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const price = Number(cleaned);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function mainMenuButton() {
  return {
    inline_keyboard: [
      [{ text: "⬅️ Main Menu", callback_data: "menu" }]
    ]
  };
}

async function beginQuotation(chatId) {
  sessions.set(String(chatId), { step: "search" });
  await sendMessage(
    chatId,
    "🧾 REQUEST A QUOTATION\n\n" +
      "Type the product name, brand, or salt/content name you need.\n\n" +
      "Example: OSEPTIN or SEMAGLUTIDE\n\n" +
      "I'll search the live catalogue for matching products.",
    {
      inline_keyboard: [
        [{ text: "❌ Cancel", callback_data: "qcancel" }],
        [{ text: "⬅️ Main Menu", callback_data: "menu" }]
      ]
    }
  );
}

async function searchProducts(chatId, query) {
  await sendMessage(chatId, "🔎 Searching your live catalogue...");

  let catalogue;
  try {
    catalogue = await getCatalogue();
  } catch (error) {
    console.error("Catalogue error:", error);
    sessions.delete(String(chatId));
    await sendMessage(
      chatId,
      "Sorry, I couldn't read the live catalogue just now.\n\n" +
        "Please try again later or contact " + CONTACT_EMAIL,
      mainMenuButton()
    );
    return;
  }

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = catalogue.filter(item => {
    const searchable =
      `${item.product} ${item.salt} ${item.brand} ${item.packing}`.toLowerCase();
    return terms.every(term => searchable.includes(term));
  }).slice(0, 10);

  if (!matches.length) {
    await sendMessage(
      chatId,
      "No matching products found. Try another product name or salt/content name.",
      {
        inline_keyboard: [
          [{ text: "🔎 Search Again", callback_data: "quotation" }],
          [{ text: "⬅️ Main Menu", callback_data: "menu" }]
        ]
      }
    );
    sessions.delete(String(chatId));
    return;
  }

  sessions.set(String(chatId), {
    step: "select",
    matches
  });

  const buttons = matches.map((item, index) => {
    const price = parsePrice(item.priceText);
    const priceLabel = price === null ? "Price unavailable" : `$${price.toFixed(2)}`;
    const label =
      `${item.product} | ${item.packing} | ${priceLabel}`;
    return [{
      text: label.slice(0, 60),
      callback_data: `qprod:${index}`
    }];
  });

  buttons.push([{ text: "❌ Cancel", callback_data: "qcancel" }]);

  await sendMessage(
    chatId,
    "✅ MATCHING CATALOGUE PRODUCTS\n\n" +
      "Select the exact product and packing below.\n" +
      "Prices are in USD and use the catalogue's packing unit.",
    { inline_keyboard: buttons }
  );
}

async function handleMessage(message) {
  if (!message.chat || !message.text) return;

  const chatId = message.chat.id;
  const key = String(chatId);
  const text = message.text.trim();

  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] || "";
    sessions.delete(key);

    if (payload.startsWith("claim_")) {
      await sendMessage(
        chatId,
        "🎉 OFFER CLAIM REQUEST\n\n" +
          "Reference: " + payload.slice(6) +
          "\n\nPlease contact our team to verify your offer.\n" +
          CONTACT_EMAIL,
        mainMenuButton()
      );
      return;
    }

    await sendWelcome(chatId);
    return;
  }

  if (text === "/menu") {
    await sendWelcome(chatId);
    return;
  }

  if (text === "/quote") {
    await beginQuotation(chatId);
    return;
  }

  const session = sessions.get(key);

  if (!session) {
    await sendMessage(
      chatId,
      "Please choose an option from the menu or type /start.",
      mainMenuButton()
    );
    return;
  }

  if (session.step === "search") {
    if (text.length < 2) {
      await sendMessage(chatId, "Please enter at least 2 characters.");
      return;
    }
    await searchProducts(chatId, text);
    return;
  }

  if (session.step === "quantity") {
    const quantity = Number(text);

    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
      await sendMessage(
        chatId,
        "Please enter a whole-number quantity of packing units, such as 2 or 10."
      );
      return;
    }

    session.quantity = quantity;
    session.step = "country";
    sessions.set(key, session);

    await sendMessage(
      chatId,
      "🌍 Which country should the order be delivered to?\n\n" +
        "Please type the destination country."
    );
    return;
  }

  if (session.step === "country") {
    const country = text.slice(0, 80);
    const item = session.product;
    const price = parsePrice(item.priceText);

    if (price === null) {
      sessions.delete(key);
      await sendMessage(
        chatId,
        "This product doesn't have a valid USD price in the catalogue, so I can't calculate an automatic quotation.\n\n" +
          "Please contact " + CONTACT_EMAIL,
        mainMenuButton()
      );
      return;
    }

    const subtotal = price * session.quantity;
    const quoteId = `Q${Date.now().toString().slice(-9)}`;

    const quotation =
      `🧾 QUOTATION ${quoteId}\n\n` +
      `Product: ${item.product}\n` +
      (item.salt ? `Salt / Content: ${item.salt}\n` : "") +
      (item.brand ? `Brand: ${item.brand}\n` : "") +
      `Packing: ${item.packing}\n` +
      `Price per packing unit: $${price.toFixed(2)}\n` +
      `Quantity: ${session.quantity} packing unit(s)\n` +
      `Product subtotal: $${subtotal.toFixed(2)} USD\n\n` +
      `Destination: ${country}\n` +
      `Shipping: Not included; confirm separately.\n\n` +
      "This is an automated product quotation based on the live catalogue. " +
      "Final availability, shipping and any applicable charges must be confirmed by our team.\n\n" +
      `Contact: ${CONTACT_EMAIL}`;

    sessions.delete(key);
    await sendMessage(chatId, quotation, {
      inline_keyboard: [
        [{ text: "🧾 Request Another Quote", callback_data: "quotation" }],
        [{ text: "📩 Contact Us", callback_data: "contact" }],
        [{ text: "⬅️ Main Menu", callback_data: "menu" }]
      ]
    });
    return;
  }

  await sendMessage(chatId, "Please select an option or type /start.");
}

async function handleCallback(callback) {
  await telegram("answerCallbackQuery", {
    callback_query_id: callback.id
  });

  if (!callback.message) return;

  const chatId = callback.message.chat.id;
  const key = String(chatId);
  const data = callback.data || "";

  if (data === "menu") {
    await sendWelcome(chatId);
    return;
  }

  if (data === "qcancel") {
    sessions.delete(key);
    await sendMessage(chatId, "Quotation cancelled.", mainMenuButton());
    return;
  }

  if (data === "quotation") {
    await beginQuotation(chatId);
    return;
  }

  if (data.startsWith("qprod:")) {
    const session = sessions.get(key);
    const index = Number(data.slice(6));

    if (!session || session.step !== "select" ||
        !Number.isInteger(index) || !session.matches[index]) {
      await sendMessage(
        chatId,
        "That selection has expired. Please start your quotation again.",
        {
          inline_keyboard: [
            [{ text: "🧾 Start Quotation", callback_data: "quotation" }]
          ]
        }
      );
      return;
    }

    const item = session.matches[index];
    const price = parsePrice(item.priceText);

    if (price === null) {
      await sendMessage(
        chatId,
        `⚠️ ${item.product}\n\n` +
          `Packing: ${item.packing}\n` +
          "A valid USD price is not listed for this product. Please contact our team for a quotation.\n" +
          CONTACT_EMAIL,
        {
          inline_keyboard: [
            [{ text: "🔎 Search Another Product", callback_data: "quotation" }],
            [{ text: "⬅️ Main Menu", callback_data: "menu" }]
          ]
        }
      );
      sessions.delete(key);
      return;
    }

    session.product = item;
    session.step = "quantity";
    sessions.set(key, session);

    await sendMessage(
      chatId,
      `✅ PRODUCT SELECTED\n\n` +
        `Product: ${item.product}\n` +
        (item.salt ? `Salt / Content: ${item.salt}\n` : "") +
        (item.brand ? `Brand: ${item.brand}\n` : "") +
        `Packing: ${item.packing}\n` +
        `Price per packing unit: $${price.toFixed(2)} USD\n\n` +
        "Enter the quantity in the packing units shown above.\n" +
        "For example, enter 2 for 2 pens or 2 packs.",
      {
        inline_keyboard: [
          [{ text: "❌ Cancel", callback_data: "qcancel" }]
        ]
      }
    );
    return;
  }

  if (data === "products") {
    await sendMessage(
      chatId,
      "🛍️ LIVE PRODUCT CATALOGUE\n\n" +
        "Browse the live Google Sheets catalogue or request a quotation directly here.",
      {
        inline_keyboard: [
          [{ text: "📊 Open Live Catalogue", url: CATALOGUE_URL }],
          [{ text: "🧾 Request a Quotation", callback_data: "quotation" }],
          [{ text: "⬅️ Main Menu", callback_data: "menu" }]
        ]
      }
    );
    return;
  }

  if (data === "contact") {
    await sendMessage(
      chatId,
      "📩 CONTACT US\n\n" +
        "Email: " + CONTACT_EMAIL +
        "\n\nPlease include your product requirements, quantities and destination country.",
      mainMenuButton()
    );
    return;
  }

  if (data === "about") {
    await sendMessage(
      chatId,
      "ℹ️ ABOUT US\n\n" +
        "One Stop Wellness Hub connects customers with pharmaceutical and dermatology product supply enquiries.\n\n" +
        "For product availability and quotations, contact:\n" +
        CONTACT_EMAIL,
      {
        inline_keyboard: [
          [{ text: "📊 Browse Catalogue", callback_data: "products" }],
          [{ text: "🧾 Request a Quotation", callback_data: "quotation" }],
          [{ text: "⬅️ Main Menu", callback_data: "menu" }]
        ]
      }
    );
  }
}

async function processUpdate(update) {
  try {
    if (update.message) await handleMessage(update.message);
    if (update.callback_query) await handleCallback(update.callback_query);
  } catch (error) {
    console.error("Update processing error:", error);
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`${BOT_NAME} is running.`);
    return;
  }

  if (req.method === "POST" && req.url === "/telegram-webhook") {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });

    req.on("end", () => {
      let update;
      try {
        update = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end("Invalid JSON");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      void processUpdate(update);
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`${BOT_NAME} server started on port ${PORT}`);

  if (!BASE_URL) {
    console.error("Missing RENDER_EXTERNAL_URL environment variable.");
    return;
  }

  const result = await telegram("setWebhook", {
    url: `${BASE_URL.replace(/\/$/, "")}/telegram-webhook`,
    allowed_updates: ["message", "callback_query"]
  });

  if (result.ok) {
    console.log("Telegram webhook successfully configured.");
  } else {
    console.error("Webhook setup failed:", result.description);
  }
});
