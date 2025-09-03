import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

app.get("/", (_req, res) => res.send("Kai bot running"));

// まず200を即返す→その後、LINEに返信（タイムアウト防止）
app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");

  try {
    const events = req.body?.events || [];
    for (const ev of events) {
      if (ev.type === "message" && ev.message?.type === "text") {
        const text = ev.message.text;
        const reply = `接続OKだよ！「${text}」って送ってくれた？😊`;
        await replyToLine(ev.replyToken, reply);
      }
    }
  } catch (e) {
    console.error("webhook error:", e);
  }
});

async function replyToLine(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }]
    })
  });
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on " + port));
