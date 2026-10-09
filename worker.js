
const BOT_NAME = "One Stop Wellness Hub";
const WHEEL_URL = "https://sobtiganga5-png.github.io/one-stop-wheel/";
const CONTACT_EMAIL = "sales@bridgepointtraders.com";

async function telegram(token, method, data) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }
  );

  return response.json();
}

async function sendMessage(token, chatId, text, keyboard) {
  const data = { chat_id: chatId, text };
  if (keyboard) data.reply_markup = keyboard;
  return telegram(token, "sendMessage", data);
}

async function sendWelcome(token, chatId) {
  return sendMessage(
    token,
    chatId,
    `👋 Welcome to ${BOT_NAME}!\n\nYour pharmaceutical and dermatology product supply contact.\n\nChoose an option below:`,
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

async function handleMessage(token, message) {
  if (!message.chat || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();

  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] || "";

    if (payload.startsWith("claim_")) {
      await sendMessage(
        token,
        chatId,
        "🎉 OFFER CLAIM REQUEST\n\nReference: " +
          payload.slice(6) +
          "\n\nPlease contact our team to verify your offer.\n" +
          CONTACT_EMAIL
      );
      return;
    }

    await sendWelcome(token, chatId);
    return;
  }

  if (text === "/menu") {
    await sendWelcome(token, chatId);
    return;
  }

  await sendMessage(token, chatId, "Please send /start to open the main menu.");
}

async function handleCallback(token, callback) {
  await telegram(token, "answerCallbackQuery", {
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
      "📩 CONTACT US\n\nEmail: " + CONTACT_EMAIL +
      "\n\nPlease include your product requirements and destination country.",
    about:
      "ℹ️ ABOUT US\n\nOne Stop Wellness Hub provides pharmaceutical and dermatology product supply support.\n\n" +
      "Contact: " + CONTACT_EMAIL
  };

  if (callback.data === "menu") {
    await sendWelcome(token, chatId);
  } else if (replies[callback.data]) {
    await sendMessage(token, chatId, replies[callback.data], {
      inline_keyboard: [[
        { text: "⬅️ Main Menu", callback_data: "menu" }
      ]]
    });
  }
}

export default {
  async fetch(request, env) {
    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN is missing in Cloudflare Settings.", {
        status: 500
      });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/setup") {
      const result = await telegram(env.BOT_TOKEN, "setWebhook", {
        url: url.origin + "/",
        allowed_updates: ["message", "callback_query"]
      });

      return Response.json(result);
    }

    if (request.method === "GET") {
      return new Response(BOT_NAME + " Bot is running!");
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let update;

    try {
      update = await request.json();
    } catch {
      return new Response("Invalid Telegram update JSON.", { status: 400 });
    }

    try {
      if (update.message) {
        const result = await handleMessage(env.BOT_TOKEN, update.message);
        if (result && result.ok === false) {
          console.error("Telegram sendMessage failed:", result);
        }
      }

      if (update.callback_query) {
        await handleCallback(env.BOT_TOKEN, update.callback_query);
      }
    } catch (error) {
      console.error("Telegram update processing failed:", error);
    }

    return new Response("OK");
  }
};
