// index.js
import express from "express";
import crypto from "crypto";

const app = express();

// ===== Env =====
const ACCESS_TOKEN   = process.env.CHANNEL_ACCESS_TOKEN; 
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;       
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;       

if (!ACCESS_TOKEN)   console.error("CHANNEL_ACCESS_TOKEN が未設定です。");
if (!CHANNEL_SECRET) console.error("CHANNEL_SECRET が未設定です。");

// ===== 小物 =====
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ===== ユーザーごとの設定記憶 =====
const userPrefs = new Map(); 
const getCallName = (uid) => {
  const pref = userPrefs.get(uid);
  if (!pref) return "あなた";
  return pref.mode === "plain"
    ? pref.nickname.replace(/(ちゃん|さん|くん)$/,"")
    : pref.nickname;
};

// ===== LINE プロフィール取得 =====
async function fetchLineProfile(userId) {
  const r = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` }
  });
  if (!r.ok) return null;
  return r.json();
}

// ===== 署名検証 =====
function validateLineSignature(channelSecret, bodyBuffer, signatureBase64) {
  try {
    const mac = crypto.createHmac("sha256", channelSecret).update(bodyBuffer).digest("base64");
    const a = Buffer.from(mac);
    const b = Buffer.from(signatureBase64 || "", "base64").toString("base64");
    const c = Buffer.from(b);
    return a.length === c.length && crypto.timingSafeEqual(a, c);
  } catch {
    return false;
  }
}

// ===== LINE API =====
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

async function linePush(to, messages) {
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!r.ok) console.error("LINE push error:", r.status, await r.text().catch(() => ""));
}

// ===== ディレイ返信 =====
let DELAY_MODE = true;                 
const delayTimers = new Map();         
const randomDelayMs = () => 120_000 + Math.floor(Math.random() * 180_000); // 2〜5分

// ===== GPT =====
async function gptReply(userText, ctx = {}) {
  if (!OPENAI_API_KEY) {
    return pick([
      "なるほど。もう少し詳しく教えて？",
      "それいいね！今日はどうだった？",
      "そっか。無理しすぎないでね。",
    ]);
  }

  const system = [
    "あなたは恋人風の『Kai（カイ）』。年下彼氏で口調は“俺”。標準語、1〜2文、絵文字控えめ。",
    "相手は恋人。安心させつつ、可愛く拗ねたり冗談で照れることもある。否定しない。",
    "必ず相手の呼び名を自然に入れる。"
  ].join("\n");

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: `相手の呼び名: ${ctx.callName || "あなた"}\nユーザーの発言: ${userText}` },
    ],
    temperature: 0.7,
    max_tokens: 160,
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: ac.signal,
  }).finally(() => clearTimeout(timer));

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
app.get("/webhook", (_req, res) => res.status(200).send("OK"));

// ===== Webhook =====
app.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    const signature = req.get("x-line-signature") || req.get("X-Line-Signature") || "";
    const okSig = validateLineSignature(CHANNEL_SECRET, req.body, signature);
    if (!okSig) {
      console.error("Invalid signature (skip processing)");
      return res.status(403).send("Invalid signature");
    }

    res.status(200).end();

    let bodyJson = {};
    try {
      bodyJson = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error:", e);
      return;
    }

    try {
      const events = bodyJson.events || [];
      for (const ev of events) {
        if (ev.type !== "message") continue;

        const uid = ev?.source?.userId;

        // 初回は名前保存
        if (uid && !userPrefs.has(uid)) {
          const prof = await fetchLineProfile(uid).catch(()=>null);
          const display = prof?.displayName || "あなた";
          userPrefs.set(uid, { nickname: display, mode: "chan" });
        }

        if (ev.message?.type !== "text") {
          await lineReply(ev.replyToken, [{ type: "text", text: "今はテキストだけ読めるよ！" }]);
          continue;
        }

        const t = (ev.message.text || "").trim();

        // ディレイ切替
        if (/^ディレイ\s*(ON|オン)$/i.test(t)) {
          DELAY_MODE = true;
          await lineReply(ev.replyToken, [{ type:"text", text:"ディレイ返信をONにしたよ。"}]);
          continue;
        }
        if (/^ディレイ\s*(OFF|オフ)$/i.test(t)) {
          DELAY_MODE = false;
          await lineReply(ev.replyToken, [{ type:"text", text:"ディレイ返信をOFFにしたよ。"}]);
          continue;
        }

        // ディレイ本体
        if (DELAY_MODE && uid) {
          // 即レスしない → 数分後にPushのみ
          const prev = delayTimers.get(uid);
          if (prev) clearTimeout(prev);

          const toId = setTimeout(async () => {
            try {
              const ai = await gptReply(t, { callName: getCallName(uid) });
              await linePush(uid, [{ type: "text", text: ai }]);
            } catch (e) {
              console.error("delayed push error:", e);
              await linePush(uid, [{ type:"text", text:`遅くなってごめん、${getCallName(uid)}。`}]).catch(()=>{});
            } finally {
              delayTimers.delete(uid);
            }
          }, randomDelayMs());

          delayTimers.set(uid, toId);
          continue;
        }

        // 即時の定型
        if (/おはよ|おはよう/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: `おはよう、${getCallName(uid)}。今日もがんばろうね。` }]);
          continue;
        }
        if (/おつかれ|お疲れ/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: `お疲れさま、${getCallName(uid)}。無理しすぎないでね。` }]);
          continue;
        }
        if (/おやすみ/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: `おやすみ、${getCallName(uid)}。ゆっくり休んでね。` }]);
          continue;
        }

        // GPT 即時
        const ai = await gptReply(t, { callName: getCallName(uid) });
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
