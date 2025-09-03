import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// Render の環境変数（あなたは CHANNEL_ACCESS_TOKEN を使っている想定）
const ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// 共通：返信API
const reply = (replyToken, messages) =>
  fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });

// クイックリプライ（恋人風：3つ）
const loveQuickReply = {
  items: [
    {
      type: "action",
      action: { type: "message", label: "今日どうだった？ 💌", text: "今日どうだった？" }
    },
    {
      type: "action",
      action: { type: "message", label: "おつかれさま ☕", text: "おつかれさま" }
    },
    {
      type: "action",
      action: { type: "message", label: "おやすみ 🌙", text: "おやすみ" }
    }
  ]
};

app.get("/", (_req, res) => res.send("Kai bot running"));

// Webhook：先に200返してから処理（タイムアウト防止）
app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");

  try {
    const events = req.body?.events || [];
    for (const ev of events) {
      if (ev.type !== "message") continue;

      // 非テキストは案内メッセージ
      if (ev.message?.type !== "text") {
        await reply(ev.replyToken, [
          { type: "text", text: "今はテキストだけ返せるよ📝" }
        ]);
        continue;
      }

      const t = (ev.message.text || "").trim();

      // —— 恋人風 固定フレーズ対応 ——
      if (/今日どうだった？/.test(t)) {
        await reply(ev.replyToken, [
          {
            type: "text",
            text: "君のことずっと気になってた。今日はどんな一日だったの？💌",
            quickReply: loveQuickReply
          }
        ]);
        continue;
      }

      if (/おつかれさま/.test(t)) {
        await reply(ev.replyToken, [
          {
            type: "text",
            text: "ありがとう😊 君もほんとによく頑張ったね。えらいよ🫶",
            quickReply: loveQuickReply
          }
        ]);
        continue;
      }

      if (/おやすみ/.test(t)) {
        await reply(ev.replyToken, [
          {
            type: "text",
            text: "おやすみ…いい夢見てね。明日もカイがそばにいるよ🌙",
            quickReply: loveQuickReply
          }
        ]);
        continue;
      }

      // —— ヘルプ/メニュー ——
      if (/^help$|^ヘルプ$|^メニュー$/.test(t)) {
        await reply(ev.replyToken, [
          {
            type: "text",
            text: "選んでね💙",
            quickReply: loveQuickReply
          }
        ]);
        continue;
      }

      // —— デフォルト（受け取った内容をやさしく返す + クイックリプライ表示） ——
      await reply(ev.replyToken, [
        {
          type: "text",
          text: `Kai: 「${t}」って送ってくれたんだね。今日も話せて嬉しいよ☺️`,
          quickReply: loveQuickReply
        }
      ]);
    }
  } catch (e) {
    console.error("webhook error:", e);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on " + port));
