
const http = require("node:http");

const BOT_NAME = "One Stop Wellness Hub";
const WHEEL_URL = "https://sobtiganga5-png.github.io/one-stop-wheel/";
const CATALOGUE_URL =
  "https://docs.google.com/spreadsheets/d/1lDyik6O8-A4or25wWKdZPYIkzIQP8IcC_iGO_riBh5w/edit?gid=972572136#gid=972572136";
const CONTACT_EMAIL = "sales@bridgepointtraders.com";

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.RENDER_EXTERNAL_URL;

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN environment variable.");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

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
  return sendMessage(
    chatId,
    `👋 Welcome to ${BOT_NAME}!\n\n` +
      "Your pharmaceutical and dermatology product supply contact.\n\n" +
      "Please choose an option below:",
    {
      inline_keyboard: [
        [{ text: "🎁 Spin the Wheel", web_app: { url: WHEEL_URL } }],
        [{ text: "🛍️ Browse Products", callback_data: "products" }],
        [{ text: "📩 Contact Us", callback_data: "contact" }],
        [{ text: "ℹ️ About Us", callback_data: "about" }]
      ]
    }
  );
}

async function handleMessage(message) {
  if (!message.chat || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] || "";

    if (payload.startsWith("claim_")) {
      await sendMessage(
        chatId,
        "🎉 OFFER CLAIM REQUEST\n\n" +
          "Reference: " + payload.slice(6) +
          "\n\nPlease contact our team to verify your offer.\n" +
          CONTACT_EMAIL
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

  await sendMessage(chatId, "Please send /start to open the main menu.");
}

async function handleCallback(callback) {
  await telegram("answerCallbackQuery", {
    callback_query_id: callback.id
  });

  if (!callback.message) return;

  const chatId = callback.message.chat.id;

  if (callback.data === "menu") {
    await sendWelcome(chatId);
    return;
  }

  if (callback.data === "products") {
    await sendMessage(
      chatId,
      "🛍️ LIVE PRODUCT CATALOGUE\n\n" +
        "Browse our live Google Sheets catalogue using the button below.\n\n" +
        "For a quotation, share your product requirements, quantity and destination country.",
      {
        inline_keyboard: [
          [{ text: "📊 Open Live Catalogue", url: CATALOGUE_URL }],
          [{ text: "📩 Request a Quotation", callback_data: "contact" }],
          [{ text: "⬅️ Main Menu", callback_data: "menu" }]
        ]
      }
    );
    return;
  }

  if (callback.data === "contact") {
    await sendMessage(
      chatId,
      "📩 CONTACT US\n\n" +
        "Email: " + CONTACT_EMAIL +
        "\n\nPlease include your product requirements, quantities and destination country.",
      {
        inline_keyboard: [
          [{ text: "⬅️ Main Menu", callback_data: "menu" }]
        ]
      }
    );
    return;
  }

  if (callback.data === "about") {
    await sendMessage(
      chatId,
      "ℹ️ ABOUT US\n\n" +
        "One Stop Wellness Hub connects customers with pharmaceutical and dermatology product supply enquiries.\n\n" +
        "For product availability and quotations, contact:\n" +
        CONTACT_EMAIL,
      {
        inline_keyboard: [
          [{ text: "📊 Browse Catalogue", callback_data: "products" }],
          [{ text: "⬅️ Main Menu", callback_data: "menu" }]
        ]
      }
    );
  }
}

async function processUpdate(update) {
  try {
    if (update.message) {
      await handleMessage(update.message);
    }

    if (update.callback_query) {
      await handleCallback(update.callback_query);
    }
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
