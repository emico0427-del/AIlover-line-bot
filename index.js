// index.js
import express from "express";
import crypto from "crypto";

const app = express();

// ===== Env =====
const ACCESS_TOKEN   = process.env.CHANNEL_ACCESS_TOKEN; // LINE 長期アクセストークン
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;       // チャネルシークレット
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;       // 任意（無いときはテンプレ回答）

if (!ACCESS_TOKEN)   console.error("CHANNEL_ACCESS_TOKEN が未設定です。");
if (!CHANNEL_SECRET) console.error("CHANNEL_SECRET が未設定です。");

// ===== ちょいユーティリティ =====
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ===== 署名検証 =====
function validateLineSignature(channelSecret, bodyBuffer, signatureBase64) {
  try {
    const mac = crypto.createHmac("sha256", channelSecret).update(bodyBuffer).digest("base64");
    // 文字列比較を timing safe に
    const a = Buffer.from(mac);
    const b = Buffer.from(signatureBase64 || "", "base64").toString("base64");
    const c = Buffer.from(b);
    return a.length === c.length && crypto.timingSafeEqual(a, c);
  } catch {
    return false;
  }
}

// ===== LINE返信（Reply） =====
async function lineReply(replyToken, messages) {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!r.ok) console.error("LINE reply error:", r.status, await r.text().catch(() => ""));
}

// ===== GPT（任意） =====
async function gptReply(userText) {
  if (!OPENAI_API_KEY) {
    return pick([
      "なるほど。もう少し詳しく教えて？",
      "それいいね！今日はどうだった？",
      "そっか。無理しすぎないでね。",
    ]);
  }
  const system = [
    "あなたは恋人風のチャットパートナー『Kai（カイ）』。",
    "年下彼氏。口調は“俺”。標準語で爽やか・優しい。絵文字は控えめ。",
    "1〜2文で自然に返す。軽い問いかけを添えることが多い。",
    "相手は大切な恋人。安心感を与え、否定しない。",
  ].join("\n");

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: userText },
    ],
    temperature: 0.7,
    max_tokens: 160,
  };

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("OpenAI API error:", r.status, data);
    return "ごめん、今ちょっと上手く考えがまとまらない。また聞かせて？";
  }
  return data?.choices?.[0]?.message?.content?.trim()
      || "うまく言葉が出てこなかった。もう一回言って？";
}

// ===== Health check =====
app.get("/", (_req, res) => res.status(200).send("Kai bot running"));
app.get("/webhook", (_req, res) => res.status(200).send("OK")); // 検証用GET

// ===== Webhook（※絶対に raw） =====
app.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    // 署名検証
    const signature = req.get("x-line-signature") || req.get("X-Line-Signature") || "";
    const okSig = validateLineSignature(CHANNEL_SECRET, req.body, signature);
    if (!okSig) {
      console.error("Invalid signature (skip processing)");
      return res.status(403).send("Invalid signature");
    }

    // 即 200
    res.status(200).end();

    // JSON へ
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error:", e);
      return;
    }

    // ===== イベント処理 =====
    try {
      const events = bodyJson.events || [];
      for (const ev of events) {
        if (ev.type !== "message") continue;

        // テキスト以外は簡単に返す
        if (ev.message?.type !== "text") {
          await lineReply(ev.replyToken, [{ type: "text", text: "今はテキストだけ読めるよ！" }]);
          continue;
        }

        const t = (ev.message.text || "").trim();

        // かんたん定型
        if (/おはよ|おはよう/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: "おはよう。今日もがんばろうね。" }]);
          continue;
        }
        if (/おつかれ|お疲れ/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: "お疲れさま。無理しすぎないでね。" }]);
          continue;
        }
        if (/おやすみ/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: "おやすみ。ゆっくり休んでね。" }]);
          continue;
        }

        // GPT or フォールバック
        const ai = await gptReply(t);
        await lineReply(ev.replyToken, [{ type: "text", text: ai }]);
      }
    } catch (e) {
      console.error("webhook error:", e);
    }
  }
);

// ===== Start =====
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on", port));
