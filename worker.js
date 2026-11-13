'use strict';

// BRIDGE POINT TRADERS — ONE STOP WELLNESS HUB
// Render-compatible Node.js Telegram bot.
// Required environment variable: BOT_TOKEN
// Optional: ADMIN_GROUP_ID, bank variables, WEBHOOK_SECRET

const http = require('node:http');
const { URL } = require('node:url');

const BOT_NAME = 'One Stop Wellness Hub';
const USD_TO_INR = 85;

const WHEEL_URL =
  'https://sobtiganga5-png.github.io/one-stop-wheel/';

const CATALOGUE_URL =
  'https://docs.google.com/spreadsheets/d/1lDyik6O8-A4or25wWKdZPYIkzIQP8IcC_iGO_riBh5w/edit';

const CATALOGUE_FEED_URL =
  'https://script.google.com/macros/s/AKfycbxd1T2EJ2_ssd1yOGUVoMelHjFdTrZeIQjpIIx4sOwfK4gWQQQLt9LuzbpAZ9L2zCO3/exec';

const CONTACT_USERNAME = 'gangasobti';
const ADMIN_GROUP_ID =
  process.env.ADMIN_GROUP_ID || '-1004454174288';

const QUOTATION_TOPIC_ID = 5;
const WHEEL_CLAIMS_TOPIC_ID = 6;

const BENEFICIARY = 'BRIDGE POINT TRADERS';

const BENEFICIARY_ADDRESS =
  'FOURTH FLOOR HOUSE NO 31 404 ROOM NO 01 FLAT NO 404 PLOT NO 637 SATYAM DIVINE NAGPUR 440017';

const PORT = Number(process.env.PORT || 10000);

const BANKS = [
  {
    name: 'IndusInd Bank',
    accountEnv: 'BANK1_ACCOUNT_NUMBER',
    type: 'CURRENT ACCOUNT',
    ifscEnv: 'BANK1_IFSC',
    defaultIfsc: 'INDB0002259',
    swiftEnv: 'BANK1_SWIFT',
    defaultSwift: 'INDBINBBNAS',
    branchCode: '2259',
    address:
      'Shop no G1 & G2 Rana Palladium, Kashmiri Gali, Opp HDFC Bank Ltd, Near Indora, Nagpur 440017'
  },
  {
    name: 'AU Small Finance Bank',
    accountEnv: 'BANK2_ACCOUNT_NUMBER',
    type: 'CURRENT ACCOUNT',
    ifscEnv: 'BANK2_IFSC',
    defaultIfsc: 'AUBL0002369',
    swiftEnv: 'BANK2_SWIFT',
    defaultSwift: 'AUBLINBBXXX',
    branchCode: '2369',
    address:
      'BLK NO.4, Telephone Exchange Square, Gandhi Grain Market, 25, CA Road, Nagpur 440008'
  }
];

const mainMenu = {
  inline_keyboard: [
    [{ text: '🎡 Spin the Wheel — Claim Your Offer', url: WHEEL_URL }],
    [{ text: '🛍️ Browse Live Product Catalogue', url: CATALOGUE_URL }],
    [{ text: '🔎 Search Products', callback_data: 'search' }],
    [{ text: '🧾 Create Multi-Product Quotation', callback_data: 'quote' }],
    [{ text: '💳 Payment Methods', callback_data: 'payments' }],
    [{ text: '📩 Contact Ganga Sobti', callback_data: 'contact' }],
    [{ text: 'ℹ️ About Us', callback_data: 'about' }]
  ]
};

// Sessions are stored in memory and reset when Render restarts.
const sessions = new Map();
const searchResults = new Map();

function getSession(chatId) {
  const key = String(chatId);

  if (!sessions.has(key)) {
    sessions.set(key, {
      cart: [],
      stage: '',
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
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function productName(product) {
  return [product?.product, product?.brand]
    .filter(Boolean)
    .join(' — ') || 'Product';
}

function priceInUSD(product) {
  const raw = String(product?.priceText || '').trim();

  if (!raw || /₹|INR|unavailable|not available/i.test(raw)) {
    return null;
  }

  const match = raw
    .replace(/,/g, '')
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

function shippingForCountry(country) {
  const rates = {
    USA: 70,
    UK: 35,
    AUSTRALIA: 50,
    SOUTH_AFRICA: 50,
    JAPAN: 40,
    SOUTH_KOREA: 25,
    HONG_KONG: 35,
    PHILIPPINES: 35,
    OTHER: 50
  };

  return rates[country] ?? 50;
}

function destinationName(country) {
  const destinations = {
    USA: 'USA',
    UK: 'United Kingdom',
    AUSTRALIA: 'Australia',
    SOUTH_AFRICA: 'South Africa',
    JAPAN: 'Japan',
    SOUTH_KOREA: 'South Korea',
    HONG_KONG: 'Hong Kong',
    PHILIPPINES: 'Philippines',
    OTHER: 'Other Country'
  };

  return destinations[country] || 'Other Country';
}

// TELEGRAM API

async function telegram(method, data) {
  if (!process.env.BOT_TOKEN) {
    throw new Error('Missing BOT_TOKEN environment variable');
  }

  const response = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

async function sendMessage(chatId, text, keyboard, threadId) {
  const payload = {
    chat_id: chatId,
    text: String(text).slice(0, 4000)
  };

  if (keyboard) {
    payload.reply_markup = keyboard;
  }

  if (threadId !== undefined && threadId !== null) {
    payload.message_thread_id = threadId;
  }

  return telegram('sendMessage', payload);
}

async function answerCallback(callbackId) {
  try {
    await telegram('answerCallbackQuery', {
      callback_query_id: callbackId
    });
  } catch (error) {
    console.error('Callback acknowledgement:', error.message);
  }
}

function cartKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📩 Submit to Ganga Sobti', callback_data: 'submit_order' }],
      [{ text: '➕ Add More Products', callback_data: 'more' }],
      [{ text: '🚚 Calculate Shipping & Total', callback_data: 'checkout' }],
      [{ text: '🗑️ Clear Cart', callback_data: 'clearcart' }],
      [{ text: '🏠 Main Menu', callback_data: 'home' }]
    ]
  };
}

// PRODUCT SEARCH

async function searchProducts(chatId, query) {
  try {
    const response = await fetch(
      `${CATALOGUE_FEED_URL}?q=${encodeURIComponent(query)}`
    );

    if (!response.ok) {
      throw new Error(`Catalogue HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data?.success || !Array.isArray(data.products)) {
      throw new Error(
        data?.error || 'Unexpected catalogue feed format'
      );
    }

    if (!data.products.length) {
      await sendMessage(
        chatId,
        `No matching products found for "${safe(query)}". Try a shorter name or contact @gangasobti.`,
        mainMenu
      );
      return;
    }

    const products = data.products.slice(0, 10);
    searchResults.set(String(chatId), products);

    const lines = products.map((product, i) => {
      const price = priceInUSD(product);

      return [
        `${i + 1}. ${productName(product)}`,
        product.salt ? `Salt: ${product.salt}` : '',
        product.packing ? `Packing: ${product.packing}` : '',
        product.category ? `Category: ${product.category}` : '',
        price === null
          ? 'Price: Please contact us'
          : `Price per unit: $${money(price)}`
      ].filter(Boolean).join('\n');
    });

    await sendMessage(
      chatId,
      `🔎 Results for "${safe(query)}"\n\n` +
        `${lines.join('\n\n')}\n\n` +
        'Tap "Add to Quotation", then enter the product number and quantity.',
      {
        inline_keyboard: [
          [{
            text: '➕ Add to Quotation',
            callback_data: 'add_to_quote'
          }]
        ]
      }
    );
  } catch (error) {
    console.error('Product search error:', error.message);

    await sendMessage(
      chatId,
      'Product search is temporarily unavailable. Please try again or contact @gangasobti.',
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
      'Your quotation cart is empty. Search for a product to begin.',
      {
        inline_keyboard: [
          [{ text: '🔎 Search Products', callback_data: 'more' }],
          [{ text: '🏠 Main Menu', callback_data: 'home' }]
        ]
      }
    );
    return;
  }

  const subtotal = subtotalOf(session);

  const lines = session.cart.map((item, i) =>
    `${i + 1}. ${item.name}\n` +
    `Quantity: ${item.quantity}\n` +
    `Unit price: $${money(item.price)}\n` +
    `Line total: $${money(item.quantity * item.price)}`
  );

  await sendMessage(
    chatId,
    `🧾 BRIDGE POINT TRADERS — QUOTATION CART\n\n` +
      `${lines.join('\n\n')}\n\n` +
      `Product subtotal: $${money(subtotal)}\n` +
      `Approx. INR subtotal: ₹${money(subtotal * USD_TO_INR)}\n\n` +
      'Choose shipping calculation or submit your request.',
    cartKeyboard()
  );
}

async function showFinalQuote(chatId, session, country) {
  const shipping = shippingForCountry(country);
  const subtotal = subtotalOf(session);
  const total = subtotal + shipping;

  const lines = session.cart.map((item, i) =>
    `${i + 1}. ${item.name}\n` +
    `${item.quantity} × $${money(item.price)} = $${money(item.quantity * item.price)}`
  );

  await sendMessage(
    chatId,
    `🧾 ESTIMATED QUOTATION — ${destinationName(country)}\n\n` +
      `${lines.join('\n\n')}\n\n` +
      `Product subtotal: $${money(subtotal)}\n` +
      `Shipping estimate: $${money(shipping)}\n` +
      `ESTIMATED GRAND TOTAL: $${money(total)}\n` +
      `Approx. INR total: ₹${money(total * USD_TO_INR)}\n\n` +
      '⚠️ Shipping, stock, final prices and import requirements must be confirmed by our team. This is not an order confirmation.',
    cartKeyboard()
  );
}

async function submitOrder(chatId, from) {
  const session = getSession(chatId);

  if (!session.cart.length) {
    await sendMessage(
      chatId,
      'Your quotation cart is empty. Add products first.',
      mainMenu
    );
    return;
  }

  if (session.submitting) {
    await sendMessage(
      chatId,
      'Your request is being submitted. Please wait.'
    );
    return;
  }

  session.submitting = true;

  try {
    const subtotal = subtotalOf(session);

    const shipping = session.country
      ? shippingForCountry(session.country)
      : null;

    const total = shipping === null
      ? null
      : subtotal + shipping;

    const customerName = [
      from?.first_name,
      from?.last_name
    ].filter(Boolean).join(' ') || 'Customer';

    const lines = session.cart.map((item, i) =>
      `${i + 1}. ${item.name}\n` +
      `Qty: ${item.quantity}\n` +
      `Unit: $${money(item.price)}\n` +
      `Line total: $${money(item.quantity * item.price)}`
    );

    const adminText =
      `📩 NEW QUOTATION REQUEST\n\n` +
      `Customer: ${customerName}\n` +
      `Username: ${from?.username ? '@' + from.username : 'Not provided'}\n` +
      `Telegram ID: ${chatId}\n\n` +
      `${lines.join('\n\n')}\n\n` +
      `Subtotal: $${money(subtotal)}\n` +
      (
        shipping === null
          ? 'Shipping: Not selected\nTotal: To be confirmed\n'
          : `Destination: ${destinationName(session.country)}\n` +
            `Shipping estimate: $${money(shipping)}\n` +
            `Estimated total: $${money(total)}\n`
      ) +
      '\nPlease review stock, destination, shipping, price and import requirements before confirming.';

    await sendMessage(
      ADMIN_GROUP_ID,
      adminText,
      undefined,
      QUOTATION_TOPIC_ID
    );

    await sendMessage(
      chatId,
      '✅ Your quotation request has been sent to Ganga Sobti for review. This is a request only; your order is not confirmed until our team replies.',
      mainMenu
    );
  } catch (error) {
    console.error('Submit quotation error:', error.message);

    await sendMessage(
      chatId,
      'Sorry, your request could not be submitted. Please try again later or contact @gangasobti.',
      mainMenu
    );
  } finally {
    session.submitting = false;
  }
}

// PAYMENT OPTIONS

async function showPayments(chatId) {
  await sendMessage(
    chatId,
    '💳 PAYMENT METHODS\n\nChoose a payment option to view general instructions.',
    {
      inline_keyboard: [
        [{ text: '💚 Wise', callback_data: 'pay_wise' }],
        [{ text: '🏦 Wire Transfer', callback_data: 'pay_bank' }],
        [{ text: '💸 Remitly', callback_data: 'pay_remitly' }],
        [{ text: '📩 Contact Ganga', callback_data: 'contact' }],
        [{ text: '🏠 Main Menu', callback_data: 'home' }]
      ]
    }
  );
}

async function showBankDetails(chatId) {
  const details = BANKS.map(bank =>
    `${bank.name}\n` +
    `Beneficiary: ${BENEFICIARY}\n` +
    `Account type: ${bank.type}\n` +
    `Account number: ${process.env[bank.accountEnv] || 'Please request verified details from Ganga'}\n` +
    `IFSC: ${process.env[bank.ifscEnv] || bank.defaultIfsc}\n` +
    `SWIFT: ${process.env[bank.swiftEnv] || bank.defaultSwift}\n` +
    `Branch code: ${bank.branchCode}\n` +
    `Branch: ${bank.address}`
  ).join('\n\n──────────────\n\n');

  await sendMessage(
    chatId,
    `🏦 WIRE TRANSFER DETAILS\n\n${details}\n\n` +
      `Beneficiary address:\n${BENEFICIARY_ADDRESS}\n\n` +
      '⚠️ Verify the beneficiary and bank details with Ganga before transferring. Never rely on changed payment instructions without confirmation.',
    {
      inline_keyboard: [
        [{ text: '📩 Confirm Details with Ganga', callback_data: 'contact' }],
        [{ text: '🏠 Main Menu', callback_data: 'home' }]
      ]
    }
  );
}

// CALLBACK BUTTONS

async function handleCallback(callback) {
  await answerCallback(callback.id);

  const message = callback.message;
  const chatId = message?.chat?.id;

  // Keep customer workflows restricted to private chats.
  if (!chatId || message?.chat?.type !== 'private') {
    return;
  }

  const data = callback.data || '';
  const session = getSession(chatId);

  if (data === 'home') {
    session.stage = '';
    await sendMessage(
      chatId,
      `Welcome to ${BOT_NAME}!\n\nHow can we help you today?`,
      mainMenu
    );
    return;
  }

  if (data === 'search' || data === 'more') {
    session.stage = 'search';
    await sendMessage(
      chatId,
      '🔎 Type the product name you want to search for.'
    );
    return;
  }

  if (data === 'quote' || data === 'cart') {
    await showCart(chatId);
    return;
  }

  if (data === 'add_to_quote') {
    const products = searchResults.get(String(chatId)) || [];

    if (!products.length) {
      await sendMessage(
        chatId,
        'Your search results have expired. Please search again.',
        mainMenu
      );
      return;
    }

    session.stage = 'product_index';

    await sendMessage(
      chatId,
      `Enter the product number you want to add (1-${products.length}).`
    );
    return;
  }

  if (data === 'checkout') {
    if (!session.cart.length) {
      await showCart(chatId);
      return;
    }

    await sendMessage(
      chatId,
      '🌍 Select your shipping destination:',
      {
        inline_keyboard: [
          [{ text: '🇺🇸 USA — $70 estimate', callback_data: 'country:USA' }],
          [{ text: '🇬🇧 United Kingdom — $35 estimate', callback_data: 'country:UK' }],
          [{ text: '🇦🇺 Australia — $50 estimate', callback_data: 'country:AUSTRALIA' }],
          [{ text: '🇿🇦 South Africa — $50 estimate', callback_data: 'country:SOUTH_AFRICA' }],
          [{ text: '🇯🇵 Japan — $40 estimate', callback_data: 'country:JAPAN' }],
          [{ text: '🇰🇷 South Korea — $25 estimate', callback_data: 'country:SOUTH_KOREA' }],
          [{ text: '🇭🇰 Hong Kong — $35 estimate', callback_data: 'country:HONG_KONG' }],
          [{ text: '🇵🇭 Philippines — $35 estimate', callback_data: 'country:PHILIPPINES' }],
          [{ text: '🌍 Other Country — $50 estimate', callback_data: 'country:OTHER' }],
          [{ text: '🏠 Main Menu', callback_data: 'home' }]
        ]
      }
    );
    return;
  }

  if (data.startsWith('country:')) {
    session.country = data.split(':')[1];
    await showFinalQuote(chatId, session, session.country);
    return;
  }

  if (data === 'submit_order') {
    await submitOrder(chatId, callback.from);
    return;
  }

  if (data === 'clearcart') {
    session.cart = [];
    session.country = null;
    session.pendingProduct = null;
    session.stage = '';

    await sendMessage(
      chatId,
      'Your quotation cart has been cleared.',
      mainMenu
    );
    return;
  }

  if (data === 'payments') {
    await showPayments(chatId);
    return;
  }

  if (data === 'pay_bank') {
    await showBankDetails(chatId);
    return;
  }

  if (data === 'pay_wise') {
    await sendMessage(
      chatId,
      '💚 WISE\n\nPlease contact @gangasobti to confirm the recipient details and payment instructions for your invoice. Verify the recipient before sending money.',
      mainMenu
    );
    return;
  }

  if (data === 'pay_remitly') {
    await sendMessage(
      chatId,
      '💸 REMITLY\n\nPlease contact @gangasobti to confirm whether this payment method is available for your transaction and to receive verified instructions.',
      mainMenu
    );
    return;
  }

  if (data === 'contact') {
    await sendMessage(
      chatId,
      '📩 Contact Ganga Sobti\nTelegram: @gangasobti\n\nPlease share your product requirements for a quotation.',
      {
        inline_keyboard: [
          [{
            text: 'Open Telegram Contact',
            url: `https://t.me/${CONTACT_USERNAME}`
          }],
          [{ text: '🏠 Main Menu', callback_data: 'home' }]
        ]
      }
    );
    return;
  }

  if (data === 'about') {
    await sendMessage(
      chatId,
      'ℹ️ BRIDGE POINT TRADERS\n\nPharmaceutical and dermatology product sourcing and export enquiries.\n\nProduct availability, pricing, shipping, documentation and destination import requirements must be confirmed individually with our team.',
      mainMenu
    );
  }
}

// WHEEL OFFER CLAIMS

async function handleWheelClaim(chatId, payload, from) {
  // Reject retired free-shipping offers.
  if (payload.startsWith('claim_freeshipping_')) {
    await sendMessage(
      chatId,
      'This free-shipping offer has expired and cannot be claimed. Please visit the Spin the Wheel page for current offers.',
      mainMenu
    );
    return;
  }

  try {
    const customerName = [
      from?.first_name,
      from?.last_name
    ].filter(Boolean).join(' ') || 'Customer';

    await sendMessage(
      ADMIN_GROUP_ID,
      `🎡 WHEEL OFFER CLAIM\n\n` +
        `Customer: ${customerName}\n` +
        `Username: ${from?.username ? '@' + from.username : 'Not provided'}\n` +
        `Telegram ID: ${chatId}\n` +
        `Claim payload: ${payload}\n\n` +
        'Please verify the offer manually before approving.',
      undefined,
      WHEEL_CLAIMS_TOPIC_ID
    );
  } catch (error) {
    console.error('Wheel claim forwarding error:', error.message);
  }

  await sendMessage(
    chatId,
    '🎡 Your offer claim has been received for manual review. The offer is not confirmed until Ganga verifies it. Please contact @gangasobti if you need help.',
    mainMenu
  );
}

// MESSAGE HANDLER

async function handleMessage(message) {
  const chatId = message.chat?.id;
  const text = String(message.text || '').trim();

  if (!chatId) return;

  // GROUP SUPPORT:
  // Only the test command is handled in groups.
  // Product searches, quotations and payment options stay private.
  if (message.chat?.type !== 'private') {
    if (
      /^\/testbot(?:@OneStopWellnessBot)?(?:\s|$)/i.test(text)
    ) {
      await sendMessage(
        chatId,
        `✅ ${BOT_NAME} is connected to this group!`
      );
    }
    return;
  }

  const from = message.from || {};
  const session = getSession(chatId);

  if (text.startsWith('/start')) {
    const payload = text.split(/\s+/)[1] || '';

    if (payload.startsWith('claim_')) {
      await handleWheelClaim(chatId, payload, from);
      return;
    }

    session.stage = '';

    await sendMessage(
      chatId,
      `Welcome to ${BOT_NAME}! 🎉\n\nBrowse products, build a quotation, or claim a wheel offer below.`,
      mainMenu
    );
    return;
  }

  if (text === '/menu') {
    session.stage = '';
    await sendMessage(chatId, 'Choose an option:', mainMenu);
    return;
  }

  if (text === '/help') {
    await sendMessage(
      chatId,
      'Use the menu to search products, build a quotation, view payment options, or contact @gangasobti.',
      mainMenu
    );
    return;
  }

  if (session.stage === 'product_index') {
    const products = searchResults.get(String(chatId)) || [];
    const index = Number(text);

    if (
      !/^\d+$/.test(text) ||
      index < 1 ||
      index > products.length
    ) {
      await sendMessage(
        chatId,
        products.length
          ? `Please enter a valid product number from 1 to ${products.length}.`
          : 'Your search results have expired. Please search again.',
        products.length ? undefined : mainMenu
      );
      return;
    }

    const product = products[index - 1];
    const price = priceInUSD(product);

    if (price === null) {
      session.stage = '';

      await sendMessage(
        chatId,
        "Please contact @gangasobti for this product's price.",
        mainMenu
      );
      return;
    }

    session.pendingProduct = {
      name: productName(product),
      price
    };

    session.stage = 'quantity';

    await sendMessage(
      chatId,
      `Selected: ${session.pendingProduct.name}\n` +
        `Unit price: $${money(price)}\n\n` +
        'Now enter the quantity as a whole number.'
    );
    return;
  }

  if (session.stage === 'quantity') {
    const quantity = Number(text);

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10000
    ) {
      await sendMessage(
        chatId,
        'Please enter a whole-number quantity from 1 to 10000.'
      );
      return;
    }

    if (!session.pendingProduct) {
      session.stage = '';

      await sendMessage(
        chatId,
        'Please search for the product again.',
        mainMenu
      );
      return;
    }

    session.cart.push({
      name: session.pendingProduct.name,
      price: session.pendingProduct.price,
      quantity
    });

    session.pendingProduct = null;
    session.stage = '';

    await showCart(chatId);
    return;
  }

  if (session.stage === 'search') {
    session.stage = '';
    await searchProducts(chatId, text);
    return;
  }

  if (text.startsWith('/')) {
    await sendMessage(
      chatId,
      'Use /menu to open the main menu.',
      mainMenu
    );
    return;
  }

  await sendMessage(
    chatId,
    'To search the catalogue, select Search Products from the menu. For direct help, contact @gangasobti.',
    mainMenu
  );
}

// PROCESS TELEGRAM UPDATES

async function processUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
  } else if (update.message) {
    await handleMessage(update.message);
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(value));
}

// RENDER HTTP SERVER

const server = http.createServer((req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end(`${BOT_NAME} is running`);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      botConfigured: Boolean(process.env.BOT_TOKEN),
      adminConfigured: Boolean(ADMIN_GROUP_ID)
    });
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/telegram') {
    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('Not found');
    return;
  }

  if (
    process.env.WEBHOOK_SECRET &&
    req.headers['x-telegram-bot-api-secret-token'] !==
      process.env.WEBHOOK_SECRET
  ) {
    sendJson(res, 403, {
      ok: false,
      error: 'Invalid webhook secret'
    });
    return;
  }

  let body = '';

  req.on('data', chunk => {
    body += chunk;

    if (body.length > 1_000_000) {
      req.destroy();
    }
  });

  req.on('end', async () => {
    let update;

    try {
      update = JSON.parse(body || '{}');
    } catch {
      sendJson(res, 400, {
        ok: false,
        error: 'Invalid JSON'
      });
      return;
    }

    // Acknowledge Telegram promptly.
    sendJson(res, 200, { ok: true });

    try {
      await processUpdate(update);
    } catch (error) {
      console.error(
        'Webhook processing error:',
        error?.stack || error?.message || error
      );
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`${BOT_NAME} listening on port ${PORT}`);
});
