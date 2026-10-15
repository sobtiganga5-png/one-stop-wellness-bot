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

const CONTACT_USERNAME = "gangasobti";
const CONTACT_EMAIL = "sales@bridgepointtraders.com";

const API = BOT_TOKEN
  ? `https://api.telegram.org/bot${BOT_TOKEN}`
  : "";

const sessions = new Map();
const searchResults = new Map();

// BANK DETAILS
// Account numbers are read from Render environment variables.
// Add BANK1_ACCOUNT_NUMBER and BANK2_ACCOUNT_NUMBER in Render.

const BANKS = [
  {
    name: "IndusInd Bank",
    account: process.env.BANK1_ACCOUNT_NUMBER || "",
    type: "CURRENT ACCOUNT",
    ifsc: process.env.BANK1_IFSC || "INDB0002259",
    swift: process.env.BANK1_SWIFT || "INDBINBBNAS",
    branchCode: "2259",
    address:
      "Shop no G1 & G2 Rana Palladium, Kashmiri Gali, Opp HDFC Bank Ltd, Near Indora, Nagpur 440017"
  },
  {
    name: "AU Small Finance Bank",
    account: process.env.BANK2_ACCOUNT_NUMBER || "",
    type: "CURRENT ACCOUNT",
    ifsc: process.env.BANK2_IFSC || "AUBL0002369",
    swift: process.env.BANK2_SWIFT || "AUBLINBBXXX",
    branchCode: "2369",
    address:
      "BLK NO.4, Telephone Exchange Square, Gandhi Grain Market, 25, CA Road, Nagpur 440008"
  }
];

const BENEFICIARY = "BRIDGE POINT TRADERS";

const BENEFICIARY_ADDRESS =
  "FOURTH FLOOR HOUSE NO 31 404 ROOM NO 01 FLAT NO 404 PLOT NO 637 SATYAM DIVINE NAGPUR 440017";

async function telegram(method, data) {
  if (!BOT_TOKEN) {
    throw new Error("Missing BOT_TOKEN");
  }

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

  if (keyboard) {
    payload.reply_markup = keyboard;
  }

  return telegram("sendMessage", payload);
}

async function acknowledge(callbackId) {
  try {
    await telegram("answerCallbackQuery", {
      callback_query_id: callbackId
    });
  } catch (error) {
    console.error("Callback error:", error.message);
  }
}

// MAIN MENU — SPIN WHEEL IS FIRST

const mainMenu = {
  inline_keyboard: [
    [
      {
        text: "🎡 Spin the Wheel — Claim Your Offer",
        url: WHEEL_URL
      }
    ],
    [
      {
        text: "🛍️ Browse Live Product Catalogue",
        url: CATALOGUE_URL
      }
    ],
    [
      {
        text: "🔎 Search Products",
        callback_data: "search"
      }
    ],
    [
      {
        text: "🧾 Create Multi-Product Quotation",
        callback_data: "quote"
      }
    ],
    [
      {
        text: "💳 Payment Methods",
        callback_data: "payments"
      }
    ],
    [
      {
        text: "📩 Contact Ganga Sobti",
        callback_data: "contact"
      }
    ],
    [
      {
        text: "ℹ️ About Us",
        callback_data: "about"
      }
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

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function productName(product) {
  return [
    product?.product,
    product?.brand
  ].filter(Boolean).join(" — ") || "Product";
}

function priceInUSD(product) {
  const raw = String(product?.priceText || "").trim();

  if (!raw || /₹|INR|unavailable|not available/i.test(raw)) {
    return null;
  }

  const match = raw
    .replace(/,/g, "")
    .match(/(?:USD\s*|\$\s*)(\d+(?:\.\d+)?)/i);

  if (!match) return null;

  const value = Number(match[1]);

  return Number.isFinite(value) && value > 0
    ? value
    : null;
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
      [
        {
          text: "📩 Submit to Ganga Sobti",
          callback_data: "submit_order"
        }
      ],
      [
        {
          text: "➕ Add More Products",
          callback_data: "more"
        }
      ],
      [
        {
          text: "🚚 Select Country & Calculate Total",
          callback_data: "checkout"
        }
      ],
      [
        {
          text: "🗑️ Clear Cart",
          callback_data: "clearcart"
        }
      ],
      [
        {
          text: "🏠 Main Menu",
          callback_data: "home"
        }
      ]
    ]
  };
}

// PRODUCT SEARCH

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
      throw new Error("Invalid catalogue feed response");
    }

    if (!data.products.length) {
      await sendMessage(
        chatId,
        `No matching products found for "${query}". Try another name.`,
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
          ? "Price: Please contact us"
          : `Price per strip: $${money(price)}`
      ].filter(Boolean).join("\n");
    });

    const keyboard = products.map((product, index) => [{
      text: priceInUSD(product) === null
        ? `ℹ️ ${index + 1}. Ask for Price`
        : `➕ Add ${index + 1} to Quote`,
      callback_data: `add:${index}`
    }]);

    keyboard.push(
      [{ text: "🧾 View Quote Cart", callback_data: "cart" }],
      [{ text: "🔎 Search Another Product", callback_data: "more" }],
      [{ text: "🏠 Main Menu", callback_data: "home" }]
    );

    await sendMessage(
      chatId,
      `🔎 Results for "${escapeText(query)}"\n\n${lines.join("\n\n")}\n\nSelect a product to add it to your quotation.`,
      { inline_keyboard: keyboard }
    );

  } catch (error) {
    console.error("Product search error:", error.message);

    await sendMessage(
      chatId,
      "Product search is temporarily unavailable. Please try again or open the catalogue.",
      mainMenu
    );
  }
}

// QUOTATION CART

async function showCart(chatId) {
  const session = getSession(chatId);

  if (!session.cart.length) {
    await sendMessage(
      chatId,
      "Your quotation cart is empty. Search for a product to get started.",
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
    `Quantity: ${item.quantity} strips\n` +
    `Unit price: $${money(item.price)}\n` +
    `Line total: $${money(item.quantity * item.price)}`
  );

  await sendMessage(
    chatId,
    `🧾 BRIDGE POINT TRADERS — QUOTATION CART\n\n` +
    `${lines.join("\n\n")}\n\n` +
    `Product subtotal: $${money(subtotal)}\n` +
    `Approx. INR subtotal: ₹${money(subtotal * USD_TO_INR)}\n\n` +
    `Select a destination to calculate estimated shipping, or submit your request.`,
    cartKeyboard()
  );
}

async function showFinalQuote(chatId, session, country) {
  const shipping = country === "USA" ? 70 : 35;
  const subtotal = subtotalOf(session);
  const total = subtotal + shipping;

  const destination = {
    USA: "USA",
    UK: "United Kingdom",
    OTHER: "Other country"
  }[country];

  const lines = session.cart.map((item, index) =>
    `${index + 1}. ${item.name}\n` +
    `${item.quantity} strips × $${money(item.price)} = ` +
    `$${money(item.quantity * item.price)}`
  );

  await sendMessage(
    chatId,
    `🧾 QUOTATION — ${destination}\n\n` +
    `${lines.join("\n\n")}\n\n` +
    `Product subtotal: $${money(subtotal)}\n` +
    `Shipping estimate: $${money(shipping)}\n` +
    `ESTIMATED GRAND TOTAL: $${money(total)}\n\n` +
    `Approx. INR total: ₹${money(total * USD_TO_INR)}\n\n` +
    `⚠️ Shipping, stock, final prices and import requirements must be confirmed by our team. This is an estimate, not an order confirmation.`,
    cartKeyboard()
  );
}

// SUBMIT QUOTATION TO GANGA

async function submitOrder(chatId, from) {
  const session = getSession(chatId);

  if (!session.cart.length) {
    await sendMessage(
      chatId,
      "Your quotation cart is empty. Add products before submitting.",
      mainMenu
    );
    return;
  }

  if (!ADMIN_CHAT_ID) {
    await sendMessage(
      chatId,
      "Order submission is not configured yet. Please contact @gangasobti.",
      mainMenu
    );
    return;
  }

  if (session.submitting) {
    await sendMessage(chatId, "Your request is being submitted. Please wait.");
    return;
  }

  session.submitting = true;

  try {
    const subtotal = subtotalOf(session);
    const shipping = session.country
      ? (session.country === "USA" ? 70 : 35)
      : null;

    const total = shipping === null ? null : subtotal + shipping;

    const customerName = [
      from?.first_name,
      from?.last_name
    ].filter(Boolean).join(" ") || "
