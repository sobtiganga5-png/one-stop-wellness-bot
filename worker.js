const BOT_NAME = "One Stop Wellness Hub";
const WHEEL_URL = "https://sobtiganga5-png.github.io/one-stop-wheel/";
const CONTACT_EMAIL = "sales@bridgepointtraders.com";

const BOT_TOKEN = process.env.BOT_TOKEN;

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

async function sendMessage(chatId, text, keyboard) {
  const data = { chat_id: chatId, text };

  if (keyboard) {
    data.reply_markup = keyboard;
  }

  return telegram("sendMessage", data);
}

async function sendWelcome(chatId) {
  return sendMessage(
    chatId,
    `👋 Welcome to ${BOT_NAME}!\n\n` +
      "Your pharmaceutical and dermatology product supply contact.\n\n" +
      "Choose an option below:",
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

  await sendMessage(
    chatId,
    "Please send /start to open the main menu."
  );
}

async function handleCallback(callback) {
  await telegram("answerCallbackQuery", {
    callback_query_id: callback.id
  });

  if (!callback.message) return;

  const chatId = callback.message.chat.id;

  const replies = {
    products:
      "🛍️ PRODUCT CATALOGUE\n\n" +
      "Tablets, capsules, injections, dermatology and skincare products.\n\n" +
      "Send your product requirements, quantity and destination country for a quotation.",

    contact:
      "📩 CONTACT US\n\n" +
      "Email: " + CONTACT_EMAIL +
      "\n\nPlease include your product requirements and destination country.",

    about:
      "ℹ️ ABOUT US\n\n" +
      "One Stop Wellness Hub provides pharmaceutical and dermatology product supply support.\n\n" +
      "Contact: " + CONTACT_EMAIL
  };

  if (callback.data === "menu") {
    await sendWelcome(chatId);
  } else if (replies[callback.data]) {
    await sendMessage(chatId, replies[callback.data], {
      inline_keyboard: [
        [{ text: "⬅️ Main Menu", callback_data: "menu" }]
      ]
    });
  }
}

async function pollTelegram() {
  let offset = 0;

  console.log(`${BOT_NAME} is starting...`);

  // Polling and webhook cannot be used at the same time.
  const webhook = await telegram("deleteWebhook", {
    drop_pending_updates: false
  });

  if (!webhook.ok) {
    throw new Error("Could not remove Telegram webhook.");
  }

  const me = await telegram("getMe");

  if (!me.ok) {
    throw new Error("Telegram bot token is invalid.");
  }

  console.log(`Connected to @${me.result.username}`);

  while (true) {
    try {
      const result = await telegram("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"]
      });

      if (!result.ok) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }

      for (const update of result.result) {
        offset = update.update_id + 1;

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
    } catch (error) {
      console.error("Polling error:", error);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

pollTelegram().catch(error => {
  console.error("Bot startup failed:", error);
  process.exit(1);
});
