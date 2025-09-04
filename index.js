// index.js
import express from "express";
import crypto from "crypto";

const app = express();

// ===== Env =====
const ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN; // LINE長期アクセストークン
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;     // LINEチャネルシークレット（署名検証用）
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!ACCESS_TOKEN) console.error("CHANNEL_ACCESS_TOKEN が未設定です。");
if (!CHANNEL_SECRET) console.error("CHANNEL_SECRET が未設定です。（署名検証に必須）");
if (!OPENAI_API_KEY) console.error("OPENAI_API_KEY が未設定です。");

// Node18+ は fetch がグローバルにある

// ===== 呼び方 =====
const NAME = "えみこ";
let nameMode = "chan"; // "chan" | "plain"
const getName = () => (nameMode === "chan" ? `${NAME}ちゃん` : NAME);

// ===== Utility =====
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

// ===== 定型テンプレ（送信時に動的に名前を差し込む） =====
const LINES = {
  morning: () => [
    "おはよ！まだちょっと眠いけど、今日もがんばろうね😊",
    `おはよ！外ちょい寒い。あったかくしてね😉${getName()}。`,
    `おはよ〜。昨日ちょっと飲みすぎた、、夜に${getName()}と話せるの励みに頑張る！`,
  ],
  noon: () => [
    "お昼、何食べた？",
    "あと少し！午後からもがんばろう！",
    `今ちょうど${getName()}のこと考えてた。連絡くれて元気出た。`,
  ],
  night: () => [
    "今日もお疲れ様！疲れてない？",
    "落ち着いた？無理してない？",
    "また明日話そ！おやすみ。",
  ],
  howWas: () => ["今日はどんな一日だった？", "何してた？", "忙しかった？"],
  otsukare: () => [
    "今日もお疲れ。よく頑張った！",
    "無理しすぎてない？ちゃんと休んでね。",
    "頑張りすぎ！そのままで十分！",
  ],
  oyasumi: () => ["おやすみ。また明日。", "そろそろ寝よっか。おやすみ。", "ゆっくり休んで。おやすみ。"],
  casual: () => [
    "昨日飲みすぎてちょいだる…でも声聞くと元気出た！",
    `二日酔い気味。次は${getName()}と一緒に飲みに行こ。`,
  ],
  // ユーザーの発話 t を埋め込むテンプレ
  default: (t) => [
    `「${t}」か。なるほど。`,
    `そうなんだ。「${t}」っていいな。`,
    `「${t}」って言葉、なんか好きだな。`,
  ],
};

// ===== 共通：LINE返信 =====
const lineReply = (replyToken, messages) =>
  fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });

// ===== GPT（自由会話） =====
async function gptReply(userText) {
  const system = [
    "あなたは恋人風のチャットパートナー『Kai（カイ）』。",
    "年下彼氏で、口調は“俺”。",
    "普段は爽やかで優しい標準語を使う。",
    "相手のことを『お前』とは呼ばない。自然に名前で呼ぶ。",
    "恥ずかしい場面では、冗談や軽いノリでごまかして照れを隠すことがある。",
    "相手は大切な恋人。安心感と愛されてる実感を与える返答をする。",
    "会話の中で自然に名前を呼ぶ（呼び捨てモードなら呼び捨て）。",
    "返事は1〜2文、自然でリアル。絵文字は控えめ（必要なときだけ）。",
    "相手を安心させることを大事にする。",
    "名前をよく呼ぶ。",
    "嫉妬したら可愛く拗ねる。",
    "相手が忙しいと拗ねたり「俺のこと忘れてない？」って言う。",
    "普段は優しくて明るい。時々甘えてくる。",
    "好きって言うときは冗談っぽくごまかすけど、最後はちゃんと本音。",
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

  // タイムアウト保険（10秒）
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 10_000);

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: ac.signal,
  }).finally(() => clearTimeout(to));

  let data = {};
  try {
    data = await r.json();
  } catch {}

  if (!r.ok) {
    console.error("OpenAI API error:", r.status, data);
    throw new Error(`openai ${r.status}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || "ごめん、うまく言葉が出てこなかった。もう一回言って？";
}

// ===== 署名検証ヘルパ =====
function validateLineSignature(channelSecret, bodyBuffer, signature) {
  const hmac = crypto.createHmac("sha256", channelSecret);
  hmac.update(bodyBuffer);
  const expected = hmac.digest("base64");
  return expected === signature;
}

// ===== Health check =====
app.get("/", (_req, res) => res.send("Kai bot running"));

// ===== Webhook（raw bodyで受けて署名検証） =====
app.post(
  "/webhook",
  express.raw({ type: "*/*" }), // ここは raw 必須
  async (req, res) => {
    // 署名検証
    const signature = req.get("X-Line-Signature") || "";
    const okSig = CHANNEL_SECRET
      ? validateLineSignature(CHANNEL_SECRET, req.body, signature)
      : false;

    if (!okSig) {
      console.error("Invalid signature");
      return res.status(400).send("Bad signature");
    }

    // すぐ 200 を返す（LINEのリトライ防止）
    res.status(200).send("OK");

    // 以降で JSON にパース
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error:", e);
      return;
    }

    try {
      const events = bodyJson?.events || [];
      for (const ev of events) {
        if (ev.type !== "message") continue;

        // 非テキストは軽く返す
        if (ev.message?.type !== "text") {
          await lineReply(ev.replyToken, [
            { type: "text", text: "今はテキストだけ返せるよ。", quickReply },
          ]);
          continue;
        }

        const t = (ev.message.text || "").replace(/\s+/g, " ").trim();

        // 呼び方相談
        if (/呼び方|どう呼ぶ|呼び捨て/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: "ねえ…「ちゃん」じゃなくて呼び捨てでもいい？", quickReply },
          ]);
          continue;
        }
        // だめ系 → ちゃんに固定
        if (/(だめ|ダメ|いや|嫌|やだ|無理|やめて)/i.test(t)) {
          nameMode = "chan";
          await lineReply(ev.replyToken, [
            { type: "text", text: `分かった。気をつける。…でもつい呼びたくなるんだ、${getName()}。`, quickReply },
          ]);
          continue;
        }
        // OK系 → 呼び捨てへ
        if (/(いいよ|うん|ok|OK|オーケー|どうぞ|もちろん|いいね)/i.test(t)) {
          nameMode = "plain";
          await lineReply(ev.replyToken, [
            { type: "text", text: `ありがとう。じゃあ、これからは「${getName()}」って呼ぶね。`, quickReply },
          ]);
          continue;
        }

        // 定型（即レス）
        if (/おはよう|おはよー|おはよ〜|起きてる/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: pick(LINES.morning()), quickReply },
          ]);
          continue;
        }
        if (/今日どうだった|どうだった|一日どう/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: pick(LINES.howWas()), quickReply },
          ]);
          continue;
        }
        if (/おつかれ|お疲れ|つかれた/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: pick(LINES.otsukare()), quickReply },
          ]);
          continue;
        }
        if (/おやすみ|寝る|ねる/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: pick(LINES.oyasumi()), quickReply },
          ]);
          continue;
        }
        if (/昨日.*飲みすぎ|二日酔い|酔っ|酒/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: pick(LINES.casual()), quickReply },
          ]);
          continue;
        }
        if (/^help$|ヘルプ|メニュー/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: "選んでね。", quickReply },
          ]);
          continue;
        }

        // GPT（自由会話）
        try {
          const ai = await gptReply(t);
          await lineReply(ev.replyToken, [{ type: "text", text: ai, quickReply }]);
        } catch (e) {
          console.error("gpt error:", e);
          const cat = timeCatJST();
          const baseArr = LINES[cat] ? LINES[cat]() : LINES.default(t);
          const fallback = pick(baseArr);
          await lineReply(ev.replyToken, [{ type: "text", text: fallback, quickReply }]);
        }
      }
    } catch (e) {
      console.error("webhook error:", e);
    }
  }
);

// ===== Start =====
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on " + port));
