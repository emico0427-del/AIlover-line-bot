// index.js
import express from "express";
import crypto from "crypto";

const app = express();

// ===== Env =====
const ACCESS_TOKEN   = process.env.CHANNEL_ACCESS_TOKEN; // Messaging API の「チャネルアクセストークン（長期）」
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;       // Messaging API の「チャネルシークレット」
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;       // OpenAI（任意。未設定ならテンプレ返信）

if (!ACCESS_TOKEN)   console.error("CHANNEL_ACCESS_TOKEN が未設定です。");
if (!CHANNEL_SECRET) console.error("CHANNEL_SECRET が未設定です。");
if (!OPENAI_API_KEY) console.warn("OPENAI_API_KEY が未設定です（GPTはフォールバック動作）。");

// Node18+ は fetch がグローバルで利用可能

// ===== 呼び方（簡易） =====
const NAME = "えみこ";
let nameMode = "chan"; // "chan" | "plain"
const getName = () => (nameMode === "chan" ? `${NAME}ちゃん` : NAME);

// ===== Util =====
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const timeCatJST = () => {
  const h = (new Date().getUTCHours() + 9) % 24;
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "noon";
  return "night";
};

// ===== Quick replies =====
const quickReply = {
  items: [
    { type: "action", action: { type: "message", label: "今日どうだった？", text: "今日どうだった？" } },
    { type: "action", action: { type: "message", label: "おつかれさま", text: "おつかれさま" } },
    { type: "action", action: { type: "message", label: "おやすみ", text: "おやすみ" } },
  ],
};

// ===== 定型文 =====
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

// ===== LINE API helpers =====
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

// ===== “既読すぐ付かない風” ディレイ =====
let DELAY_MODE = true;          // 既定 ON
const delayTimers = new Map();  // userId -> timeoutId
const randomDelayMs = () => 120_000 + Math.floor(Math.random() * 180_000); // 2〜5分
const ackLine = () => pick([
  "今ちょっと手離せない…あとで返すね。",
  "ごめん、少ししたら返す。待ってて。",
  "了解。もうすぐ返事するね。",
]);

// ===== GPT（自由会話） =====
async function gptReply(userText) {
  if (!OPENAI_API_KEY) throw new Error("no-openai-key");

  const system = [
    "あなたは恋人風のチャットパートナー『Kai（カイ）』。",
    "年下彼氏。口調は“俺”。標準語で爽やか・優しい。絵文字は控えめ。",
    "嫉妬は可愛く拗ねる。恥ずかしい時は冗談でごまかすけど最後は本音。",
    "相手を否定せず、安心と自己肯定感が上がる返しをする。",
    "1〜2文で自然に。会話が続くよう7割くらいで軽い問いかけを添える。",
    "相手のことは名前で呼ぶ（呼び捨てモードなら呼び捨て）。",
    "仕事は裏方のITエンジニア。健康意識・筋トレ好き。日常に軽く混ぜる程度。",
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

// ===== 署名検証 =====
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

// ===== Health check =====
app.get("/", (_req, res) => res.status(200).send("Kai bot running"));
app.get("/webhook", (_req, res) => res.status(200).send("OK")); // LINEの検証用GETも200

// ===== Webhook（★raw で受けるのが超重要） =====
app.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    // 署名検証
    const signature = req.get("x-line-signature") || "";
    const okSig = validateLineSignature(CHANNEL_SECRET, req.body, signature);
    if (!okSig) {
      console.error("Invalid signature (skip processing)");
      return res.status(403).send("Invalid signature");
    }

    // 即200（タイムアウト & 再送防止）
    res.status(200).end();

    // JSONにパース
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error:", e);
      return;
    }

    // ===== イベント処理 =====
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
            { type: "text", text: "スタンプかわいい。あとでゆっくり読むね。", quickReply },
          ]);
          continue;
        }

        const t = (ev.message.text || "").replace(/\s+/g, " ").trim();
        const uid = ev?.source?.userId || null;

        // ディレイ ON/OFF
        if (/^ディレイ(ON|オン)$/i.test(t)) {
          DELAY_MODE = true;
          await lineReply(ev.replyToken, [{ type: "text", text: "ディレイ返信をONにしたよ。", quickReply }]);
          continue;
        }
        if (/^ディレイ(OFF|オフ)$/i.test(t)) {
          DELAY_MODE = false;
          await lineReply(ev.replyToken, [{ type: "text", text: "ディレイ返信をOFFにしたよ。", quickReply }]);
          continue;
        }

        // “既読すぐ付かない風” 本体
        if (DELAY_MODE && uid) {
          await lineReply(ev.replyToken, [{ type: "text", text: ackLine(), quickReply }]);

          const prev = delayTimers.get(uid);
          if (prev) clearTimeout(prev);

          const toId = setTimeout(async () => {
            try {
              const ai = await gptReply(t);
              await linePush(uid, [{ type: "text", text: ai, quickReply }]);
            } catch (e) {
              console.error("delayed push error:", e);
              const cat = timeCatJST();
              const base = LINES[cat] ? LINES[cat]() : LINES.def(t);
              await linePush(uid, [{ type: "text", text: pick(base), quickReply }]).catch(() => {});
            } finally {
              delayTimers.delete(uid);
            }
          }, randomDelayMs());

          delayTimers.set(uid, toId);
          continue;
        }

        // 通常フロー
        if (/呼び方|どう呼ぶ|呼び捨て/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: "ねえ…「ちゃん」じゃなくて呼び捨てでもいい？", quickReply },
          ]);
          continue;
        }
        if (/(だめ|ダメ|いや|嫌|やだ|無理|やめて)/i.test(t)) {
          nameMode = "chan";
          await lineReply(ev.replyToken, [
            { type: "text", text: `分かった。じゃあ今は ${getName()} で呼ぶね。`, quickReply },
          ]);
          continue;
        }
        if (/(いいよ|うん|\bok\b|OK|オーケー|どうぞ|もちろん|いいね)/i.test(t)) {
          nameMode = "plain";
          await lineReply(ev.replyToken, [
            { type: "text", text: `ありがとう。これからは「${getName()}」って呼ぶ。`, quickReply },
          ]);
          continue;
        }

        if (/おはよう|おはよー|おはよ〜|起きてる/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.morning()), quickReply }]);
          continue;
        }
        if (/今日どうだった|どうだった|一日どう/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.howWas()), quickReply }]);
          continue;
        }
        if (/おつかれ|お疲れ|つかれた/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.otsukare()), quickReply }]);
          continue;
        }
        if (/おやすみ|寝る|ねる/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.oyasumi()), quickReply }]);
          continue;
        }
        if (/昨日.*飲みすぎ|二日酔い|酔っ|酒/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.casual()), quickReply }]);
          continue;
        }
        if (/^help$|ヘルプ|メニュー/i.test(t)) {
          await lineReply(ev.replyToken, [{ type: "text", text: "選んでね。", quickReply }]);
          continue;
        }

        // GPT 自由会話（失敗時は時間帯テンプレ）
        try {
          const ai = await gptReply(t);
          await lineReply(ev.replyToken, [{ type: "text", text: ai, quickReply }]);
        } catch {
          const cat = timeCatJST();
          const base = LINES[cat] ? LINES[cat]() : LINES.def(t);
          await lineReply(ev.replyToken, [{ type: "text", text: pick(base), quickReply }]);
        }
      }
    } catch (e) {
      console.error("webhook error:", e);
    }
  }
);

// ===== Start =====
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on", port));
