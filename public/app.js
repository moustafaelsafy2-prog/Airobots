/*! @file public/app.js
 *  @version 1.0.0
 *  @updated 2025-09-23
 *  @owner Mustafa
 *  @notes: منطق الواجهة — إرسال الرسائل واستقبال ردود Gemini عبر /api/chat
 */

const chatBox = document.getElementById("chat-box");
const chatForm = document.getElementById("chat-form");
const userInput = document.getElementById("user-input");

/**
 * إضافة رسالة إلى واجهة المحادثة
 * @param {string} sender - "user" أو "ai"
 * @param {string} text - نص الرسالة
 */
function addMessage(sender, text) {
  const wrapper = document.createElement("div");
  wrapper.className = sender === "user" ? "text-right mb-2" : "text-left mb-2";

  const bubble = document.createElement("div");
  bubble.className =
    sender === "user"
      ? "inline-block bg-blue-600 text-white px-3 py-2 rounded-lg shadow"
      : "inline-block bg-gray-200 text-gray-800 px-3 py-2 rounded-lg shadow";

  bubble.textContent = text;
  wrapper.appendChild(bubble);
  chatBox.appendChild(wrapper);

  // تمرير تلقائي لآخر رسالة
  chatBox.scrollTop = chatBox.scrollHeight;
}

/**
 * إرسال رسالة إلى خادم Netlify Functions (/api/chat)
 * والحصول على رد من Gemini
 */
async function sendMessage(message) {
  addMessage("user", message);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", text: message }],
        persona: "default"
      })
    });

    if (!response.ok) throw new Error("فشل الاتصال بالخادم");

    const data = await response.json();
    if (data && data.text) {
      addMessage("ai", data.text);
    } else {
      addMessage("ai", "⚠️ لم أستطع فهم الرد.");
    }
  } catch (err) {
    console.error(err);
    addMessage("ai", "⚠️ حدث خطأ أثناء الاتصال بالخادم.");
  }
}

// التعامل مع إرسال النموذج
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = userInput.value.trim();
  if (!message) return;
  userInput.value = "";
  sendMessage(message);
});
