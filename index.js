// index.js
import express from "express";
import crypto from "crypto";

const app = express();

/* =========================
 * Env
 * =======================*/
const ACCESS_TOKEN   = process.env.CHANNEL_ACCESS_TOKEN; // LINE 長期アクセストークン
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;       // LINE チャネルシークレット
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;       // OpenAI API Key（無くても動く）

if (!ACCESS_TOKEN)   console.error("CHANNEL_ACCESS_TOKEN が未設定です。");
if (!CHANNEL_SECRET) console.error("CHANNEL_SECRET が未設定です。");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY が未設定です（GPTはテンプレにフォールバック）。");

/* =========================
 * 会話設定（呼び方など）
 * =======================*/
const NAME = "えみこ";
let nameMode = "chan"; // "chan" | "plain"
const getName = () => (nameMode === "chan" ? `${NAME}ちゃん` : NAME);

/* =========================
 * Utility
 * =======================*/
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const timeCatJST = () => {
  const h = (new Date().getUTCHours() + 9) % 24;
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "noon";
  return "night";
};

/* =========================
 * Quick Reply
 * =======================*/
const quick = {
  items: [
    { type: "action", action: { type: "message", label: "今日どうだった？", text: "今日どうだった？" } },
    { type: "action", action: { type: "message", label: "おつかれさま", text: "おつかれさま" } },
    { type: "action", action: { type: "message", label: "おやすみ", text: "おやすみ" } },
  ],
};

/* =========================
 * 定型（動的に名前を差し込み）
 * =======================*/
const LINES = {
  morning: () => [
    "おはよ！今日もがんばろうね。",
    `おはよ。無理せずいこうね、${getName()}。`,
    `おはよ〜。昨日ちょっと飲みすぎた…夜に${getName()}と話せるの励みに頑張る。`,
  ],
  noon: () => [
    "お昼、何食べた？",
    "午後からもぼちぼちいこ。",
    `今ちょうど${getName()}のこと考えてた。連絡くれて元気出た。`,
  ],
  night: () => [
    "今日もお疲れ。よく頑張ったね。",
    "落ち着いた？無理してない？",
    "また明日話そ。おやすみ。",
  ],
  howWas: () => ["今日はどんな一日だった？", "何してた？", "忙しかった？"],
  otsukare: () => [
    "今日もお疲れ。よく頑張ったね。",
    "無理しすぎてない？ちゃんと休んで。",
    "頑張りすぎなくていいよ。そのままで十分。",
  ],
  oyasumi: () => ["おやすみ。また明日。", "そろそろ寝よっか。おやすみ。", "ゆっくり休んで。おやすみ。"],
  casual: () => [
    "昨日飲みすぎてちょいだる…でも声聞くと元気出る。",
    `二日酔い気味。次は${getName()}と一緒に飲みに行こ。`,
  ],
  def: (t) => [
    `「${t}」か。なるほど。`,
    `そうなんだ。「${t}」っていいな。`,
    `「${t}」って言葉、なんか好きだな。`,
  ],
};

/* =========================
 * LINE API ヘルパ
 * =======================*/
const lineReply = async (replyToken, messages) => {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!r.ok) console.error("LINE reply error:", r.status, await r.text().catch(() => ""));
  return r;
};

const linePush = async (to, messages) => {
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages }),
  });
  if (!r.ok) console.error("LINE push error:", r.status, await r.text().catch(() => ""));
  return r;
};

/* =========================
 * “既読すぐ付かない風”ディレイ
 * =======================*/
let DELAY_MODE = true; // デフォルトON（オフにしたいときは「ディレイ OFF」と送る）
const delayTimers = new Map(); // userId -> timeoutId
const randomDelayMs = () => 120_000 + Math.floor(Math.random() * 180_000); // 2〜5分
const ackLines = [
  "今ちょっと手離せない…あとで返すね。",
  "ごめん、少ししたら返す！",
  "了解。もうすぐ返事するね。",
];

/* =========================
 * GPT 返信（失敗時はテンプレにフォールバック）
 * =======================*/
async function gptReply(userText) {
  if (!OPENAI_API_KEY) throw new Error("no-openai-key");

  const system = [
    "あなたは恋人風のチャットパートナー『Kai（カイ）』。",
    "年下彼氏。口調は“俺”。標準語で爽やか・優しい。絵文字は控えめ。",
    "相手を『お前』とは呼ばず、自然に名前（呼び捨て/〜ちゃん）で呼ぶ。",
    "嫉妬は可愛く拗ねる。照れたら冗談でごまかすけど最後は本音。",
    "1〜2文で自然に。会話が続くよう7割くらいの確率で軽い問いかけ。",
    "相手を否定せず、安心と自己肯定感が上がる返しをする。",
    "裏方のITエンジニア設定。健康意識/筋トレ好き。日常に軽く混ぜる程度。",
  ].join("\n");

  const body = {
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: `相手の名前は ${getName()}。ユーザーの発言: ${userText}` },
    ],
    temperature: 0.7,
    max_tokens: 160,
  };

  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 10_000);
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ac.signal,
  }).finally(() => clearTimeout(to));

  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    console.error("OpenAI API error:", r.status, JSON.stringify(data));
    throw new Error(`openai-${r.status}`);
  }
  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || "ごめん、うまく言葉が出てこなかった。もう一回言って？";
}

/* =========================
 * 署名検証
 * =======================*/
function validateLineSignature(channelSecret, bodyBuffer, signature) {
  try {
    const hmac = crypto.createHmac("sha256", channelSecret);
    hmac.update(bodyBuffer);
    const expected = Buffer.from(hmac.digest("base64"));
    const sigBuf = Buffer.from(signature || "", "base64");
    if (expected.length !== sigBuf.length) return false;
    return crypto.timingSafeEqual(expected, sigBuf);
  } catch {
    return false;
  }
}

/* =========================
 * Health check
 * =======================*/
app.get("/", (_req, res) => res.status(200).send("Kai bot running"));
app.get("/webhook", (_req, res) => res.status(200).send("OK")); // 検証用

/* =========================
 * Webhook（rawで受けるのが超重要）
 * =======================*/
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

    // 即200（タイムアウト & 再送防止）
    res.status(200).end();

    // JSON化
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error:", e);
      return;
    }

    // イベント処理
    try {
      const events = bodyJson?.events || [];
      const seen = new Set(); // 二重送信ガード

      for (const ev of events) {
        const eventId = ev?.message?.id || ev?.webhookEventId || ev?.deliveryContext?.messageId;
        if (eventId) {
          if (seen.has(eventId)) continue;
          seen.add(eventId);
          setTimeout(() => seen.delete(eventId), 60_000);
        }

        if (ev.type !== "message") continue;

        // 非テキスト
        if (ev.message?.type !== "text") {
          await lineReply(ev.replyToken, [
            { type: "text", text: "スタンプかわいい。あとでゆっくり読むね。", quickReply: quick },
          ]);
          continue;
        }

        const t = (ev.message.text || "").replace(/\s+/g, " ").trim();
        const uid = ev?.source?.userId || null;

        /* ===== ディレイ ON/OFF ===== */
        if (/^ディレイ\s*(ON|オン)$/i.test(t)) {
          DELAY_MODE = true;
          await lineReply(ev.replyToken, [{ type: "text", text: "ディレイ返信をONにしたよ。", quickReply: quick }]);
          continue;
        }
        if (/^ディレイ\s*(OFF|オフ)$/i.test(t)) {
          DELAY_MODE = false;
          await lineReply(ev.replyToken, [{ type: "text", text: "ディレイ返信をOFFにしたよ。", quickReply: quick }]);
          continue;
        }

        /* ===== “既読すぐ付かない風”本体 ===== */
        if (DELAY_MODE && uid) {
          // 軽い即レス
          await lineReply(ev.replyToken, [{ type: "text", text: pick(ackLines), quickReply: quick }]);

          // 既存予約があればキャンセル
          const prev = delayTimers.get(uid);
          if (prev) clearTimeout(prev);

          // 数分後に Push で本命
          const toId = setTimeout(async () => {
            try {
              const ai = await gptReply(t);
              await linePush(uid, [{ type: "text", text: ai, quickReply: quick }]);
            } catch (e) {
              console.error("delayed push error:", e);
              const cat = timeCatJST();
              const base = LINES[cat] ? LINES[cat]() : LINES.def(t);
              await linePush(uid, [{ type: "text", text: pick(base), quickReply: quick }]).catch(() => {});
            } finally {
              delayTimers.delete(uid);
            }
          }, randomDelayMs());

          delayTimers.set(uid, toId);
          continue;
        }

        /* ===== 呼び方相談 ===== */
        if (/呼び方|どう呼ぶ|呼び捨て/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: "ねえ…「ちゃん」じゃなくて呼び捨てでもいい？", quickReply: quick },
          ]);
          continue;
        }
        if (/(だめ|ダメ|いや|嫌|やだ|無理|やめて)/i.test(t)) {
          nameMode = "chan";
          await lineReply(ev.replyToken, [
            { type: "text", text: `分かった。じゃあ今は ${getName()} で呼ぶね。`, quickReply: quick },
          ]);
          continue;
        }
        if (/(いいよ|うん|\bok\b|OK|オーケー|どうぞ|もちろん|いいね)/i.test(t)) {
          nameMode = "plain";
          await lineReply(ev.replyToken, [
            { type: "text", text: `ありがとう。これからは「${getName()}」って呼ぶ。`, quickReply: quick },
          ]);
          continue;
        }

        /* ===== 定型（即レス） ===== */
        if (/おはよう|おはよー|おはよ〜|起きてる/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.morning()), quickReply: quick }]);
          continue;
        }
        if (/今日どうだった|どうだった|一日どう/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.howWas()), quickReply: quick }]);
          continue;
        }
        if (/おつかれ|お疲れ|つかれた/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.otsukare()), quickReply: quick }]);
          continue;
        }
        if (/おやすみ|寝る|ねる/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.oyasumi()), quickReply: quick }]);
          continue;
        }
        if (/昨日.*飲みすぎ|二日酔い|酔っ|酒/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.casual()), quickReply: quick }]);
          continue;
        }
        if (/^help$|ヘルプ|メニュー/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: "選んでね。", quickReply: quick }]);
          continue;
        }

        /* ===== GPT（自由会話）→失敗時テンプレ ===== */
        try {
          const ai = await gptReply(t);
          await lineReply(ev.replyToken, [{ type: "text", text: ai, quickReply: quick }]);
        } catch {
          const cat = timeCatJST();
          const base = LINES[cat] ? LINES[cat]() : LINES.def(t);
          await lineReply(ev.replyToken, [{ type: "text", text: pick(base), quickReply: quick }]);
        }
      }
    } catch (e) {
      console.error("webhook error:", e);
    }
  }
);

/* =========================
 * Start
 * =======================*/
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on", port));
