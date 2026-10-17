
const BOT_NAME = "One Stop Wellness Hub";
const USD_TO_INR = 85;

const WHEEL_URL = "https://sobtiganga5-png.github.io/one-stop-wheel/";
const CATALOGUE_URL =
  "https://docs.google.com/spreadsheets/d/1lDyik6O8-A4or25wWKdZPYIkzIQP8IcC_iGO_riBh5w/edit";
const CATALOGUE_FEED_URL =
  "https://script.google.com/macros/s/AKfycbx0OdVM3RAC2yv_AviMihqqxVKQspzTYmicE_MrpKoovMejdIgC8wgT2oXEw9aIY8yd/exec";
const CONTACT_USERNAME = "gangasobti";

// Private admin group and forum topic IDs
const ADMIN_GROUP_ID = "-1004454174288";
const QUOTATION_TOPIC_ID = 5;
const WHEEL_CLAIMS_TOPIC_ID = 6;

const BENEFICIARY = "BRIDGE POINT TRADERS";
const BENEFICIARY_ADDRESS =
  "FOURTH FLOOR HOUSE NO 31 404 ROOM NO 01 FLAT NO 404 PLOT NO 637 SATYAM DIVINE NAGPUR 440017";

const BANKS = [
  {
    name: "IndusInd Bank",
    accountEnv: "BANK1_ACCOUNT_NUMBER",
    type: "CURRENT ACCOUNT",
    ifscEnv: "BANK1_IFSC",
    defaultIfsc: "INDB0002259",
    swiftEnv: "BANK1_SWIFT",
    defaultSwift: "INDBINBBNAS",
    branchCode: "2259",
    address:
      "Shop no G1 & G2 Rana Palladium, Kashmiri Gali, Opp HDFC Bank Ltd, Near Indora, Nagpur 440017"
  },
  {
    name: "AU Small Finance Bank",
    accountEnv: "BANK2_ACCOUNT_NUMBER",
    type: "CURRENT ACCOUNT",
    ifscEnv: "BANK2_IFSC",
    defaultIfsc: "AUBL0002369",
    swiftEnv: "BANK2_SWIFT",
    defaultSwift: "AUBLINBBXXX",
    branchCode: "2369",
    address:
      "BLK NO.4, Telephone Exchange Square, Gandhi Grain Market, 25, CA Road, Nagpur 440008"
  }
];

const mainMenu = {
  inline_keyboard: [
    [{ text: "🎡 Spin the Wheel — Claim Your Offer", url: WHEEL_URL }],
    [{ text: "🛍️ Browse Live Product Catalogue", url: CATALOGUE_URL }],
    [{ text: "🔎 Search Products", callback_data: "search" }],
    [{ text: "🧾 Create Multi-Product Quotation", callback_data: "quote" }],
    [{ text: "💳 Payment Methods", callback_data: "payments" }],
    [{ text: "📩 Contact Ganga Sobti", callback_data: "contact" }],
    [{ text: "ℹ️ About Us", callback_data: "about" }]
  ]
};

// Temporary session storage. Sessions may reset when Workers restart.
// Persistent storage should be added for production reliability.
const sessions = new Map();
const searchResults = new Map();

function getSession(chatId) {
  const key = String(chatId);
  if (!sessions.has(key)) {
    sessions.set(key, {
      cart: [],
      stage: "",
      country: null,
      pendingProduct: null,
      submitting: false
    });
  }
  return sessions.get(key);
}

function money(value) {
  return Number(value).toFixed(2);
}

function safe(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function productName(product) {
  return [product?.product, product?.brand]
    .filter(Boolean)
    .join(" — ") || "Product";
}

function priceInUSD(product) {
  const raw = String(product?.priceText || "").trim();
  if (!raw || /₹|INR|unavailable|not available/i.test(raw)) return null;

  const match = raw.replace(/,/g, "")
    .match(/(?:USD\s*|\$\s*)(\d+(?:\.\d+)?)/i);

  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function subtotalOf(session) {
  return session.cart.reduce(
    (sum, item) => sum + item.price * item.quantity, 0
  );
}

async function telegram(env, method, data) {
  if (!env.BOT_TOKEN) throw new Error("Missing BOT_TOKEN");

  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );

  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    throw new Error(
      result?.description || `Telegram HTTP ${response.status}`
    );
  }
  return result;
}

async function sendMessage(env, chatId, text, keyboard, threadId) {
  const payload = {
    chat_id: chatId,
    text: String(text).slice(0, 4000)
  };
  if (keyboard) payload.reply_markup = keyboard;
  if (threadId !== undefined && threadId !== null) {
    payload.message_thread_id = threadId;
  }
  return telegram(env, "sendMessage", payload);
}

async function answerCallback(env, callbackId) {
  try {
    await telegram(env, "answerCallbackQuery", {
      callback_query_id: callbackId
    });
  } catch (error) {
    console.error("Callback acknowledgement:", error.message);
  }
}

function cartKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📩 Submit to Ganga Sobti", callback_data: "submit_order" }],
      [{ text: "➕ Add More Products", callback_data: "more" }],
      [{ text: "🚚 Calculate Shipping & Total", callback_data: "checkout" }],
      [{ text: "🗑️ Clear Cart", callback_data: "clearcart" }],
      [{ text: "🏠 Main Menu", callback_data: "home" }]
    ]
  };
}

// PRODUCT SEARCH
async function searchProducts(env, chatId, query) {
  try {
    const response = await fetch(
      `${CATALOGUE_FEED_URL}?q=${encodeURIComponent(query)}`
    );
    if (!response.ok) throw new Error(`Catalogue HTTP ${response.status}`);

    const data = await response.json();
    if (!data?.success || !Array.isArray(data.products)) {
      throw new Error("Unexpected catalogue feed format");
    }

    if (!data.products.length) {
      await sendMessage(
        env, chatId, `No matching products found for "${query}".`, mainMenu
      );
      return;
    }

    const products = data.products.slice(0, 10);
    searchResults.set(String(chatId), products);

    const lines = products.map((p, i) => {
      const price = priceInUSD(p);
      return [
        `${i + 1}. ${productName(p)}`,
        p.salt ? `Salt: ${p.salt}` : "",
        p.packing ? `Packing: ${p.packing}` : "",
        p.category ? `Category: ${p.category}` : "",
        price === null
          ? "Price: Please contact us"
          : `Price per unit: $${money(price)}`
      ].filter(Boolean).join("\n");
    });

    const keyboard = products.map((p, i) => [{
      text: priceInUSD(p) === null
        ? `ℹ️ ${i + 1}. Ask for Price`
        : `➕ Add ${i + 1} to Quote`,
      callback_data: `add:${i}`
    }]);

    keyboard.push(
      [{ text: "🧾 View Quote Cart", callback_data: "cart" }],
      [{ text: "🔎 Search Another Product", callback_data: "more" }],
      [{ text: "🏠 Main Menu", callback_data: "home" }]
    );

    await sendMessage(
      env,
      chatId,
      `🔎 Results for "${safe(query)}"\n\n${lines.join("\n\n")}\n\nSelect a product below.`,
      { inline_keyboard: keyboard }
    );
  } catch (error) {
    console.error("Product search error:", error.message);
    await sendMessage(
      env, chatId,
      "Product search is temporarily unavailable. Please use the catalogue or contact @gangasobti.",
      mainMenu
    );
  }
}

// QUOTATION CART
async function showCart(env, chatId) {
  const session = getSession(chatId);

  if (!session.cart.length) {
    await sendMessage(env, chatId,
      "Your quotation cart is empty. Search for a product to begin.", {
        inline_keyboard: [
          [{ text: "🔎 Search Products", callback_data: "more" }],
          [{ text: "🏠 Main Menu", callback_data: "home" }]
        ]
      });
    return;
  }

  const subtotal = subtotalOf(session);
  const lines = session.cart.map((item, i) =>
    `${i + 1}. ${item.name}\nQuantity: ${item.quantity}\nUnit price: $${money(item.price)}\nLine total: $${money(item.quantity * item.price)}`
  );

  await sendMessage(
    env, chatId,
    `🧾 BRIDGE POINT TRADERS — QUOTATION CART\n\n${lines.join("\n\n")}\n\nProduct subtotal: $${money(subtotal)}\nApprox. INR subtotal: ₹${money(subtotal * USD_TO_INR)}\n\nChoose shipping calculation or submit your request.`,
    cartKeyboard()
  );
}

async function showFinalQuote(env, chatId, session, country) {
  const shipping = country === "USA" ? 70 : 35;
  const subtotal = subtotalOf(session);
  const total = subtotal + shipping;
  const destination = country === "USA" ? "USA"
    : country === "UK" ? "United Kingdom" : "Other country";

  const lines = session.cart.map((item, i) =>
    `${i + 1}. ${item.name}\n${item.quantity} × $${money(item.price)} = $${money(item.quantity * item.price)}`
  );

  await sendMessage(
    env, chatId,
    `🧾 ESTIMATED QUOTATION — ${destination}\n\n${lines.join("\n\n")}\n\nProduct subtotal: $${money(subtotal)}\nShipping estimate: $${money(shipping)}\nESTIMATED GRAND TOTAL: $${money(total)}\nApprox. INR total: ₹${money(total * USD_TO_INR)}\n\n⚠️ Shipping, stock, final prices and import requirements must be confirmed by our team. This is not an order confirmation.`,
    cartKeyboard()
  );
}

// SUBMIT QUOTATION TO ADMIN TOPIC 5
async function submitOrder(env, chatId, from) {
  const session = getSession(chatId);

  if (!session.cart.length) {
    await sendMessage(env, chatId, "Your quotation cart is empty. Add products first.", mainMenu);
    return;
  }

  if (session.submitting) {
    await sendMessage(env, chatId, "Your request is being submitted. Please wait.");
    return;
  }

  session.submitting = true;

  try {
    const subtotal = subtotalOf(session);
    const shipping = session.country
      ? (session.country === "USA" ? 70 : 35)
      : null;
    const total = shipping === null ? null : subtotal + shipping;

    const customerName = [from?.first_name, from?.last_name]
      .filter(Boolean).join(" ") || "Customer";

    const lines = session.cart.map((item, i) =>
      `${i + 1}. ${item.name}\nQty: ${item.quantity}\nUnit: $${money(item.price)}\nLine total: $${money(item.quantity * item.price)}`
    );

    const adminText =
      `📩 NEW QUOTATION REQUEST\n\n` +
      `Customer: ${customerName}\n` +
      `Username: ${from?.username ? "@" + from.username : "Not provided"}\n` +
      `Telegram ID: ${chatId}\n\n` +
      `${lines.join("\n\n")}\n\n` +
      `Subtotal: $${money(subtotal)}\n` +
      (shipping === null
        ? "Shipping: Not selected\nTotal: To be confirmed\n"
        : `Destination: ${session.country}\nShipping estimate: $${money(shipping)}\nEstimated total: $${money(total)}\n`) +
      `\nPlease review stock, destination, shipping, price and import requirements before confirming.`;

    await sendMessage(
      env, ADMIN_GROUP_ID, adminText, undefined, QUOTATION_TOPIC_ID
    );

    await sendMessage(
      env, chatId,
      "✅ Your quotation request has been sent to Ganga Sobti for review. This is a request only; your order is not confirmed until our team replies.",
      mainMenu
    );
  } catch (error) {
    console.error("Submit quotation error:", error.message);
    await sendMessage(
      env, chatId,
      "Sorry, your request could not be submitted. Please try again later or contact @gangasobti.",
      mainMenu
    );
  } finally {
    session.submitting = false;
  }
}

// PAYMENT OPTIONS
async function showPayments(env, chatId) {
  await sendMessage(env, chatId,
    "💳 PAYMENT METHODS\n\nChoose a payment option to view general instructions.", {
      inline_keyboard: [
        [{ text: "💚 Wise", callback_data: "pay_wise" }],
        [{ text: "🏦 Wire Transfer", callback_data: "pay_bank" }],
        [{ text: "💸 Remitly", callback_data: "pay_remitly" }],
        [{ text: "📩 Contact Ganga", callback_data: "contact" }],
        [{ text: "🏠 Main Menu", callback_data: "home" }]
      ]
    });
}

async function showBankDetails(env, chatId) {
  const details = BANKS.map((b) =>
    `${b.name}\n` +
    `Beneficiary: ${BENEFICIARY}\n` +
    `Account type: ${b.type}\n` +
    `Account number: ${env[b.accountEnv] || "Please request verified details from Ganga"}\n` +
    `IFSC: ${env[b.ifscEnv] || b.defaultIfsc}\n` +
    `SWIFT: ${env[b.swiftEnv] || b.defaultSwift}\n` +
    `Branch code: ${b.branchCode}\nBranch: ${b.address}`
  ).join("\n\n──────────────\n\n");

  await sendMessage(
    env, chatId,
    `🏦 WIRE TRANSFER DETAILS\n\n${details}\n\nBeneficiary address:\n${BENEFICIARY_ADDRESS}\n\n⚠️ Verify the beneficiary and bank details with Ganga before transferring. Never rely on changed payment instructions without confirmation.`,
    {
      inline_keyboard: [
        [{ text: "📩 Confirm Details with Ganga", callback_data: "contact" }],
        [{ text: "🏠 Main Menu", callback_data: "home" }]
      ]
    }
  );
}

// CALLBACK BUTTONS
async function handleCallback(env, callback) {
  await answerCallback(env, callback.id);

  const chatId = callback.message?.chat?.id;
  if (!chatId || callback.message?.chat?.type !== "private") return;

  const data = callback.data || "";
  const session = getSession(chatId);

  if (data === "home") {
    session.stage = "";
    await sendMessage(env, chatId,
      `Welcome to ${BOT_NAME}!\n\nHow can we help you today?`, mainMenu);
    return;
  }

  if (data === "search" || data === "more") {
    session.stage = "search";
    await sendMessage(env, chatId, "🔎 Type the product name you want to search for.");
    return;
  }

  if (data === "quote" || data === "cart") {
    await showCart(env, chatId);
    return;
  }

  if (data.startsWith("add:")) {
    const index = Number(data.split(":")[1]);
    const products = searchResults.get(String(chatId)) || [];
    const product = products[index];

    if (!product) {
      await sendMessage(env, chatId, "That search result has expired. Please search again.", mainMenu);
      return;
    }

    const price = priceInUSD(product);
    if (price === null) {
      await sendMessage(env, chatId, "Please contact @gangasobti for this product's price.", mainMenu);
      return;
    }

    session.pendingProduct = { name: productName(product), price };
    session.stage = "quantity";
    await sendMessage(env, chatId,
      `Selected: ${session.pendingProduct.name}\nPrice: $${money(price)}\n\nEnter the quantity as a whole number.`);
    return;
  }

  if (data === "checkout") {
    if (!session.cart.length) {
      await showCart(env, chatId);
      return;
    }
    await sendMessage(env, chatId,
      "Choose the destination for the shipping estimate:", {
        inline_keyboard: [
          [{ text: "🇺🇸 USA — $70 estimate", callback_data: "country:USA" }],
          [{ text: "🇬🇧 UK — $35 estimate", callback_data: "country:UK" }],
          [{ text: "🌍 Other — $35 estimate", callback_data: "country:OTHER" }],
          [{ text: "🏠 Main Menu", callback_data: "home" }]
        ]
      });
    return;
  }

  if (data.startsWith("country:")) {
    session.country = data.split(":")[1];
    await showFinalQuote(env, chatId, session, session.country);
    return;
  }

  if (data === "submit_order") {
    await submitOrder(env, chatId, callback.from);
    return;
  }

  if (data === "clearcart") {
    session.cart = [];
    session.country = null;
    session.pendingProduct = null;
    session.stage = "";
    await sendMessage(env, chatId, "Your quotation cart has been cleared.", mainMenu);
    return;
  }

  if (data === "payments") {
    await showPayments(env, chatId);
    return;
  }

  if (data === "pay_bank") {
    await showBankDetails(env, chatId);
    return;
  }

  if (data === "pay_wise") {
    await sendMessage(env, chatId,
      "💚 WISE\n\nPlease contact @gangasobti to confirm the recipient details and payment instructions for your invoice. Verify the recipient before sending money.",
      mainMenu);
    return;
  }

  if (data === "pay_remitly") {
    await sendMessage(env, chatId,
      "💸 REMITLY\n\nPlease contact @gangasobti to confirm whether this payment method is available for your transaction and to receive verified instructions.",
      mainMenu);
    return;
  }

  if (data === "contact") {
    await sendMessage(env, chatId,
      "📩 Contact Ganga Sobti\nTelegram: @gangasobti\n\nPlease share your product requirements for a quotation.", {
        inline_keyboard: [
          [{ text: "Open Telegram Contact", url: "https://t.me/" + CONTACT_USERNAME }],
          [{ text: "🏠 Main Menu", callback_data: "home" }]
        ]
      });
    return;
  }

  if (data === "about") {
    await sendMessage(env, chatId,
      "ℹ️ BRIDGE POINT TRADERS\n\nPharmaceutical and dermatology product sourcing and export enquiries.\n\nProduct availability, pricing, shipping, documentation and destination import requirements must be confirmed individually with our team.",
      mainMenu);
  }
}

// WHEEL CLAIMS TO ADMIN TOPIC 6
async function handleWheelClaim(env, chatId, payload, from) {
  try {
    const customerName = [from?.first_name, from?.last_name]
      .filter(Boolean).join(" ") || "Customer";

    await sendMessage(
      env,
      ADMIN_GROUP_ID,
      `🎡 WHEEL OFFER CLAIM\n\nCustomer: ${customerName}\nUsername: ${from?.username ? "@" + from.username : "Not provided"}\nTelegram ID: ${chatId}\nClaim payload: ${payload}\n\nPlease verify the offer manually before approving.`,
      undefined,
      WHEEL_CLAIMS_TOPIC_ID
    );
  } catch (error) {
    console.error("Wheel claim forwarding error:", error.message);
  }

  await sendMessage(
    env, chatId,
    "🎡 Your offer claim has been received for manual review. The offer is not confirmed until Ganga verifies it. Please contact @gangasobti if you need help.",
    mainMenu
  );
}

// PRIVATE CUSTOMER MESSAGES ONLY
async function handleMessage(env, message) {
  const chatId = message.chat?.id;
  if (!chatId || message.chat?.type !== "private") return;

  const text = String(message.text || "").trim();
  const from = message.from || {};
  const session = getSession(chatId);

  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] || "";

    if (payload.startsWith("claim_")) {
      await handleWheelClaim(env, chatId, payload, from);
      return;
    }

    session.stage = "";
    await sendMessage(env, chatId,
      `Welcome to ${BOT_NAME}! 🎉\n\nBrowse products, build a quotation, or claim a wheel offer below.`,
      mainMenu);
    return;
  }

  if (text === "/menu") {
    await sendMessage(env, chatId, "Choose an option:", mainMenu);
    return;
  }

  if (text === "/help") {
    await sendMessage(env, chatId,
      "Use the menu to search products, build a quotation, view payment options, or contact @gangasobti.",
      mainMenu);
    return;
  }

  if (session.stage === "quantity") {
    const quantity = Number(text);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
      await sendMessage(env, chatId, "Please enter a whole-number quantity greater than zero.");
      return;
    }

    if (!session.pendingProduct) {
      session.stage = "";
      await sendMessage(env, chatId, "Please search for the product again.", mainMenu);
      return;
    }

    session.cart.push({
      name: session.pendingProduct.name,
      price: session.pendingProduct.price,
      quantity
    });

    session.pendingProduct = null;
    session.stage = "";
    await showCart(env, chatId);
    return;
  }

  if (session.stage === "search") {
    session.stage = "";
    await searchProducts(env, chatId, text);
    return;
  }

  if (text.startsWith("/")) {
    await sendMessage(env, chatId, "Use /menu to open the main menu.", mainMenu);
    return;
  }

  await sendMessage(env, chatId,
    "To search the catalogue, select Search Products from the menu. For direct help, contact @gangasobti.",
    mainMenu);
}

// CLOUDFLARE WORKER ENTRY POINT
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(`${BOT_NAME} is running`, {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        botConfigured: Boolean(env.BOT_TOKEN),
        adminConfigured: Boolean(ADMIN_GROUP_ID)
      });
    }

    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return new Response("Not found", { status: 404 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    try {
      if (update.callback_query) {
        await handleCallback(env, update.callback_query);
      } else if (update.message) {
        await handleMessage(env, update.message);
      }
    } catch (error) {
      console.error("Webhook processing error:", error.message);
    }

    return Response.json({ ok: true });
  }
};
