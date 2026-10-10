
const http = require("node:http");

// ==================== CONFIGURATION ====================

const BOT_NAME = "One Stop Wellness Hub";
const WHEEL_URL = "https://sobtiganga5-png.github.io/one-stop-wheel/";

const CATALOGUE_FEED_URL =
  "https://script.google.com/macros/s/AKfycbx0OdVM3RAC2yv_AviMihqqxVKQspzTYmicE_MrpKoovMejdIgC8wgT2oXEw9aIY8yd/exec";

const CONTACT_EMAIL = "sales@bridgepointtraders.com";

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || "";
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable.");
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const sessions = new Map();

// ==================== TELEGRAM HELPERS ====================

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
    console.error("Callback error:", error.message);
  }
}

// ==================== MENUS ====================

function mainMenu() {
  return {
    inline_keyboard: [
      [{ text: "🎁 Spin the Wheel", web_app: { url: WHEEL_URL } }],
      [
        { text: "🔎 Browse Products", callback_data: "browse" },
        { text: "📩 Contact Us", callback_data: "contact" }
      ],
      [{ text: "ℹ️ About Us", callback_data: "about" }]
    ]
  };
}

function welcomeMessage() {
  return (
    `Welcome to ${BOT_NAME}! 👋\n\n` +
    "Search our public product catalogue and request a quotation.\n\n" +
    "You can search by product name, strength, salt/content or brand."
  );
}

// ==================== PUBLIC CATALOGUE ====================

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
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Rank results by how well the search matches.
// Missing fields never disqualify a product.
function searchMatches(products, query) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);

  if (!terms.length) return [];

  const scored = products.map((product, index) => {
    const name = normalize(product.product);
    const salt = normalize(product.salt);
    const brand = normalize(product.brand);
    const packing = normalize(product.packing);
    const category = normalize(product.category);

    const fields = [name, salt, brand, packing, category]
      .filter(Boolean);

    const combined = fields.join(" ");
    let matchedTerms = 0;
    let score = 0;

    for (const term of terms) {
      if (name.includes(term)) {
        score += 10;
        matchedTerms++;
      } else if (salt.includes(term)) {
        score += 7;
        matchedTerms++;
      } else if (brand.includes(term)) {
        score += 6;
        matchedTerms++;
      } else if (packing.includes(term) || category.includes(term)) {
        score += 2;
        matchedTerms++;
      } else if (combined.includes(term)) {
        score += 1;
        matchedTerms++;
      }
    }

    // Prefer products matching all search terms.
    const coverage = matchedTerms / terms.length;
    score += coverage * 5;

    if (name === normalize(query)) score += 30;

    return { product, score, coverage, index };
  });

  // First show strong matches, then partial matches if needed.
  const exactCandidates = scored
    .filter(item => item.coverage === 1 && item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const partialCandidates = scored
    .filter(item => item.coverage > 0 && item.coverage < 1)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const results = exactCandidates.length
    ? exactCandidates.concat(partialCandidates)
    : partialCandidates.length
      ? partialCandidates
      : scored
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score || a.index - b.index);

  return results.map(item => item.product);
}

function display(value, fallback = "Not specified") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function parsePrice(priceText) {
  const cleaned = String(priceText || "")
    .replace(/,/g, "")
    .replace(/[^0-9.]/g, "");

  if (!cleaned) return null;

  const price = Number(cleaned);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function money(amount) {
  return "$" + amount.toFixed(2);
}

// ==================== PRODUCT SEARCH ====================

async function searchProducts(chatId, query) {
  await sendMessage(chatId, "🔎 Searching all public catalogue categories...");

  try {
    const catalogue = await getCatalogue();
    const matches = searchMatches(catalogue, query).slice(0, 10);

    if (!matches.length) {
      await sendMessage(
        chatId,
        "I couldn't find an exact match for that search.\n\n" +
        "Try a shorter product name, brand or strength. " +
        "If the product is listed under a different name, contact us " +
        "for manual assistance.",
        {
          inline_keyboard: [
            [{ text: "🔎 Search Again", callback_data: "browse" }],
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
      `Found ${matches.length} possible match(es) for "${query}".\n\n` +
      "Select Request Quotation for the product you need."
    );

    for (let i = 0; i < matches.length; i++) {
      const p = matches[i];
      const price = parsePrice(p.priceText);

      const details = [
        `📦 ${display(p.product)}`,
        `Content: ${display(p.salt)}`,
        `Brand: ${display(p.brand)}`,
        `Packing: ${display(p.packing)}`,
        `Category: ${display(p.category)}`,
        `Catalogue price: ${
          price === null
            ? "Price to be confirmed"
            : money(price) + " per listed packing unit"
        }`
      ].join("\n");

      await sendMessage(chatId, details, {
        inline_keyboard: [[{
          text: "🧾 Request Quotation",
          callback_data: `quote:${i}`
        }]]
      });
    }

    await sendMessage(chatId, "Choose your next action:", mainMenu());
  } catch (error) {
    console.error("Catalogue search failed:", error.message);

    await sendMessage(
      chatId,
      "The catalogue is temporarily unavailable. Please try again shortly.",
      mainMenu()
    );
  }
}

// ==================== QUOTATION FLOW ====================

async function startQuotation(chatId, index) {
  const session = sessions.get(chatId);
  const product = session?.searchResults?.[index];

  if (!product) {
    await sendMessage(
      chatId,
      "This selection has expired. Please search for the product again.",
      mainMenu()
    );
    return;
  }

  session.selectedProduct = product;
  session.quantity = null;
  session.country = null;
  session.stage = "quantity";
  sessions.set(chatId, session);

  await sendMessage(
    chatId,
    "🧾 QUOTATION REQUEST\n\n" +
    `Product: ${display(product.product)}\n` +
    `Packing: ${display(product.packing)}\n` +
    `Catalogue price: ${
      parsePrice(product.priceText) === null
        ? "Price to be confirmed"
        : money(parsePrice(product.priceText))
    }\n\n` +
    "Enter the quantity of listed packing units you require.\n" +
    "Example: 10"
  );
}

async function handleQuotationMessage(chatId, text) {
  const session = sessions.get(chatId);

  if (!session?.stage) return false;

  if (session.stage === "quantity") {
    const quantity = Number(text.trim());

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      await sendMessage(
        chatId,
        "Enter a valid whole-number quantity, such as 10."
      );
      return true;
    }

    session.quantity = quantity;
    session.stage = "country";
    sessions.set(chatId, session);

    await sendMessage(
      chatId,
      "🌍 Enter the destination country for this order."
    );
    return true;
  }

  if (session.stage === "country") {
    const country = text.trim();

    if (country.length < 2 || country.length > 100) {
      await sendMessage(chatId, "Please enter a valid country name.");
      return true;
    }

    session.country = country;
    session.stage = "confirm";
    session.quoteSummary = buildQuoteSummary(session);
    sessions.set(chatId, session);

    await sendMessage(chatId, session.quoteSummary, {
      inline_keyboard: [
        [{ text: "✅ Submit Quotation Request", callback_data: "submit_quote" }],
        [{ text: "❌ Cancel", callback_data: "cancel_quote" }]
      ]
    });

    return true;
  }

  return false;
}

function buildQuoteSummary(session) {
  const p = session.selectedProduct;
  const unitPrice = parsePrice(p.priceText);
  const subtotal = unitPrice === null
    ? "Price to be confirmed"
    : money(unitPrice * session.quantity);

  return (
    "🧾 QUOTATION SUMMARY\n\n" +
    `Product: ${display(p.product)}\n` +
    `Strength/content: ${display(p.salt)}\n` +
    `Brand: ${display(p.brand)}\n` +
    `Packing: ${display(p.packing)}\n` +
    `Quantity: ${session.quantity} listed packing unit(s)\n` +
    `Destination: ${session.country}\n` +
    `Unit price: ${
      unitPrice === null
        ? "To be confirmed"
        : money(unitPrice)
    }\n` +
    `Estimated product subtotal: ${subtotal}\n\n` +
    "Shipping, taxes, availability and any missing catalogue details " +
    "must be confirmed before a final quotation can be issued."
  );
}

async function submitQuotation(chatId) {
  const session = sessions.get(chatId);

  if (!session?.quoteSummary || !session.selectedProduct) {
    await sendMessage(
      chatId,
      "Your quotation request has expired. Please search again.",
      mainMenu()
    );
    return;
  }

  // Notify the customer that their request was submitted.
  // Configure ADMIN_CHAT_ID in Render to also send the request to your team.
  if (ADMIN_CHAT_ID) {
    try {
      await sendMessage(
        ADMIN_CHAT_ID,
        "📥 NEW QUOTATION REQUEST\n\n" +
        session.quoteSummary +
        `\n\nCustomer Telegram ID: ${chatId}`
      );
    } catch (error) {
      console.error("Admin notification failed:", error.message);

      await sendMessage(
        chatId,
        "We couldn't forward the request automatically. Please contact " +
        CONTACT_EMAIL + " to complete your enquiry.",
        mainMenu()
      );
      return;
    }
  }

  session.stage = null;
  sessions.set(chatId, session);

  await sendMessage(
    chatId,
    ADMIN_CHAT_ID
      ? "✅ Your quotation request has been submitted successfully. " +
        "Our team can review your requirements and confirm the final price."
      : "✅ Your quotation summary is ready.\n\n" +
        "Automatic forwarding to the sales team is not configured yet. " +
        "Please send this request to " + CONTACT_EMAIL +
        " to obtain a confirmed quotation.",
    mainMenu()
  );
}

// ==================== BUTTON HANDLERS ====================

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
      "🔎 Type a product name, strength, salt/content or brand.\n\n" +
      "Example: ALFUZOSIN HYDROCHLORIDE"
    );
    return;
  }

  if (data === "contact") {
    await sendMessage(
      chatId,
      `📩 Contact Us\n\nEmail: ${CONTACT_EMAIL}`,
      mainMenu()
    );
    return;
  }

  if (data === "about") {
    await sendMessage(
      chatId,
      `${BOT_NAME}\n\n` +
      "Search the public catalogue and submit product quotation requests.",
      mainMenu()
    );
    return;
  }

  if (data.startsWith("quote:")) {
    const index = Number(data.slice("quote:".length));

    if (Number.isInteger(index) && index >= 0) {
      await startQuotation(chatId, index);
    } else {
      await sendMessage(chatId, "Invalid product selection. Search again.");
    }
    return;
  }

  if (data === "submit_quote") {
    await submitQuotation(chatId);
    return;
  }

  if (data === "cancel_quote") {
    const session = sessions.get(chatId);
    if (session) session.stage = null;

    await sendMessage(chatId, "Quotation request cancelled.", mainMenu());
  }
}

// ==================== MESSAGE HANDLER ====================

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
      "Use /start to open the menu, or type a product name to search.",
      mainMenu()
    );
    return;
  }

  const session = sessions.get(chatId);

  if (session?.stage === "quantity" || session?.stage === "country") {
    if (await handleQuotationMessage(chatId, text)) return;
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

  // Direct product search from any normal message.
  await searchProducts(chatId, text);
}

// ==================== HTTP SERVER ====================

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`${BOT_NAME} is running.`);
    return;
  }

  if (req.method !== "POST" || req.url !== "/") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  let body = "";

  req.on("data", chunk => {
    body += chunk;
    if (body.length > 1_000_000) req.destroy();
  });

  req.on("end", () => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");

    let update;

    try {
      update = JSON.parse(body || "{}");
    } catch (error) {
      console.error("Invalid webhook JSON:", error.message);
      return;
    }

    Promise.resolve()
      .then(async () => {
        if (update.callback_query) {
          await handleCallback(update.callback_query);
        } else if (update.message) {
          await handleMessage(update.message);
        }
      })
      .catch(error => {
        console.error("Update handling error:", error.message);
      });
  });
});

server.listen(PORT, () => {
  console.log(`${BOT_NAME} listening on port ${PORT}`);
});
