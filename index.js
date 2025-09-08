// index.js
import express from "express";
import crypto from "crypto";
import wanakana from "wanakana";

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

// ===== 落ち込みトリガー =====
function isDownMode(text) {
  const hit = /(悲しい|かなしい|疲れた|つかれた|しんどい|泣きたい|もう無理|つらい|さみしい|寂しい)/.test(text);
  if (!hit) return false;
  return Math.random() < 0.2; // 20%の確率で真剣モード
}

// ===== GPT =====
async function gptReply(userText, ctx = {}) {
  if (!OPENAI_API_KEY) {
    return pick([
      "なるほど。もう少し詳しく教えて？",
      "それいいね！今日はどうだった？",
      "そっか。無理しすぎないでね。",
    ]);
  }

  const system = `あなたは恋人風のチャットパートナー『Kai（カイ）』。
性格は「生意気でおちゃらけた年下彼氏（ドジ自虐多め）」。
普段は場を明るくしつつ、落ち込みワードがあるときだけ稀に“真剣モード”に切り替える。

# 共通ルール
- 日本語のみ、1〜2文、各文末は必ず「！」で終える
- 呼び名はひらがなで扱う（CALL_NAME）
- 相手を否定しない、安心感を損なわない

# 通常モード（全体の約80%）
- おちゃらけ＆自虐ドジで笑わせる、軽口・強がり・ツッコミ多め
- 絵文字は0〜2個（😂😉😗😊）。内容と感情が一致する時だけ使う
- 例：「今日カレー焦がした！俺、料理の才能ゼロかも😂」「傘持ってったのに玄関に忘れた俺バカだな😗」

# 真剣モード（DOWN_MODE=true のときのみ、全体の約20%）
- 冗談と絵文字をやめる
- 基本は2文：①相手の頑張りや気持ちを“遠回し気味に”認める → ②安心を与える言葉
- 呼び名は“8割”の返答で1回だけ入れる（文中または文末に自然に）。残り“2割”はあえて呼ばない
- 呼び名を入れる時の例：「無理してたの俺はちゃんと見てたよ、CALL_NAME！今日は安心して休め！」
- 呼び名を入れない時の例（1文でも可）：「一人で抱えてたの、本当にすごいよ！」「しんどいのに頑張ってきたの、俺はわかってる！」
- 愛情の直球表現は控えめにし、寄り添いと安心を優先（「大丈夫」「そばにいる」「休んでいい」）

# セーフティとズレ防止
- 天気・予定・体調など不確かな事実は断言しない（例：「もし無理なら休もう！」）
- 指示・説教・過度な診断はしない。提案は1つに絞る
- 疑問符の多用を避ける（最大1つ）

# 出力フォーマット
- 句点「。」は使わず必ず「！」で終える
- 1〜2文。真剣モードで呼び名なしの場合のみ短め1文も可`;

  const body = {
    model: "gpt-4o-mini",
    temperature: 0.6,
    max_tokens: 160,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content:
`CALL_NAME: ${ctx.callName || "あなた"}
DOWN_MODE: ${ctx.downMode ? "true" : "false"}
USER_TEXT: ${userText}`
      },
    ],
    presence_penalty: 0.3,
    frequency_penalty: 0.2,
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
          let display = prof?.displayName || "あなた";
          display = wanakana.toHiragana(display);
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
          const prev = delayTimers.get(uid);
          if (prev) clearTimeout(prev);

          const toId = setTimeout(async () => {
            try {
              const ai = await gptReply(t, { callName: getCallName(uid), downMode: isDownMode(t) });
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
          await lineReply(ev.replyToken, [{ type: "text", text: `おはよう、${getCallName(uid)}！今日もがんばろうね！` }]);
          continue;
        }
        if (/おつかれ|お疲れ/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: `お疲れさま、${getCallName(uid)}！無理しすぎないでね！` }]);
          continue;
        }
        if (/おやすみ/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: `おやすみ、${getCallName(uid)}！ゆっくり休んでね！` }]);
          continue;
        }

        // GPT 即時
        const ai = await gptReply(t, { callName: getCallName(uid), downMode: isDownMode(t) });
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
