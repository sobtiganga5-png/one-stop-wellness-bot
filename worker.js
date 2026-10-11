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
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

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
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: keyboard
  });
}

const mainMenu = {
  inline_keyboard: [
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
        text: "🎁 Spin the Wheel",
        url: WHEEL_URL
      }
    ],
    [
      {
        text: "📩 Contact Us",
        callback_data: "contact"
      },
      {
        text: "ℹ️ About Us",
        callback_data: "about"
      }
    ]
  ]
};

async function searchProducts(chatId, query) {
  try {
    const url =
      `${CATALOGUE_FEED_URL}?q=${encodeURIComponent(query)}`;

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

    if (data.products.length === 0) {
      await sendMessage(
        chatId,
        `No matching products found for "${query}".\n\n` +
        "Try the brand name, product name, salt or strength, " +
        "or open the live catalogue below.",
        mainMenu
      );
      return;
    }

    const products = data.products.slice(0, 10);

    const lines = products.map((p, i) => {
      return [
        `${i + 1}. ${p.product || "Product"}`,
        p.salt ? `Salt: ${p.salt}` : "",
        p.packing ? `Packing: ${p.packing}` : "",
        p.brand ? `Brand: ${p.brand}` : "",
        p.priceText ? `Price: ${p.priceText}` : "",
        p.category ? `Category: ${p.category}` : ""
      ].filter(Boolean).join("\n");
    });

    const message =
      `🔎 Search results for "${query}"\n\n` +
      lines.join("\n\n") +
      (data.products.length > 10
        ? "\n\nShowing the first 10 results."
        : "");

    await sendMessage(chatId, message, mainMenu);

  } catch (error) {
    console.error("Product search error:", error.message);

    await sendMessage(
      chatId,
      "Sorry, the live product search is temporarily unavailable. " +
      "Please open our live catalogue directly.",
      mainMenu
    );
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    const callback = update.callback_query;
    const chatId = callback.message?.chat?.id;

    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id
    });

    if (!chatId) return;

    if (callback.data === "search") {
      await sendMessage(
        chatId,
        "🔎 Enter the product name, brand, salt or strength you want to find.\n\n" +
        "Example: EXTRA SUPER AVANA",
        {
          inline_keyboard: [
            [
              {
                text: "🛍️ Open Live Catalogue",
                url: CATALOGUE_URL
              }
            ],
            [
              {
                text: "🏠 Main Menu",
                callback_data: "home"
              }
            ]
          ]
        }
      );
      return;
    }

    if (callback.data === "contact") {
      await sendMessage(
        chatId,
                `📩 Contact Us\n\nContact us directly on Telegram: @gangasobti`,
        {
          inline_keyboard: [
            [
              {
                text: "📩 Message Us on Telegram",
                url: "https://t.me/gangasobti"
              }
            ],
            [
              {
                text: "🏠 Main Menu",
                callback_data: "home"
              }
            ]
          ]
               }
      );
      return;
    }

    if (callback.data === "about") {
      await sendMessage(
        chatId,
        "ℹ️ One Stop Wellness Hub\n\n" +
        "Explore our public product catalogue, search products " +
        "and contact our team for enquiries.",
        mainMenu
      );
      return;
    }

    if (callback.data === "home") {
      await sendMessage(
        chatId,
        `Welcome to ${BOT_NAME}! 👋\n\nChoose an option below:`,
        mainMenu
      );
    }

    return;
  }

  if (!update.message || !update.message.chat) return;

  const chatId = update.message.chat.id;
  const text = (update.message.text || "").trim();

  if (!text) return;

  if (text === "/start" || text === "/start@OneStopWellnessBot") {
    await sendMessage(
      chatId,
      `Welcome to ${BOT_NAME}! 👋\n\n` +
      "Your one-stop hub to browse our live product catalogue, " +
      "search products and contact our team.\n\n" +
      "Please select an option below:",
      mainMenu
    );
    return;
  }

  if (text === "/help") {
    await sendMessage(
      chatId,
      "Use /start to open the main menu, or send a product name " +
      "to search the live catalogue.",
      mainMenu
    );
    return;
  }

  if (text.startsWith("/")) {
    await sendMessage(chatId, "Please choose an option:", mainMenu);
    return;
  }

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

    if (body.length > 1000000) {
      req.destroy();
    }
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
    const webhookUrl = `${baseUrl}/telegram`;

    const result = await telegram("setWebhook", {
      url: webhookUrl
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
