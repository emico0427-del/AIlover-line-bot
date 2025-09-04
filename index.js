// index.js
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// ===== Env =====
const ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== 呼び方（仮固定） =====
const NAME = "えみこ";
let nameMode = "chan"; // "chan" | "plain"
const getName = () => (nameMode === "chan" ? `${NAME}ちゃん` : NAME);

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

// ===== Utility =====
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const timeCatJST = () => {
  const h = (new Date().getUTCHours() + 9) % 24;
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "noon";
  return "night";
};

// ===== Quick replies =====
const quick = {
  items: [
    { type: "action", action: { type: "message", label: "今日どうだった？", text: "今日どうだった？" } },
    { type: "action", action: { type: "message", label: "おつかれさま", text: "おつかれさま" } },
    { type: "action", action: { type: "message", label: "おやすみ", text: "おやすみ" } },
  ],
};

// ===== 定型 =====
const LINES = {
  morning: [
    "おはよ！まだちょっと眠いけど、今日もがんばろうね😊",
    `おはよ！外ちょい寒い。あったかくしてね😉${getName()}。`,
    `おはよ〜。昨日ちょっと飲みすぎた、、夜に${getName()}と話せるの励みに頑張る！`,
  ],
  noon: [
    "お昼、何食べた？",
    "あと少し！午後からもがんばろう！",
    `今ちょうど${getName()}のこと考えてた。連絡くれて元気出た。`,
  ],
  night: [
    "今日もお疲れ様！疲れてない？",
    "落ち着いた？無理してない？",
    "また明日話そ！おやすみ。",
  ],
  howWas: ["今日はどんな一日だった？", "何してた？", "忙しかった？"],
  otsukare: [
    "今日もお疲れ。よく頑張った！。",
    "無理しすぎてない？ちゃんと休んでね。",
    "頑張りすぎ！そのままで十分！",
  ],
  oyasumi: ["おやすみ。また明日。", "そろそろ寝よっか。おやすみ。", "ゆっくり休んで。おやすみ。"],
  casual: [
    "昨日飲みすぎてちょいだる…でも声聞くと元気出た！",
    `二日酔い気味。次は${getName()}と一緒に飲みに行こ。`,
  ],
  default: [
    "「${t}」か。なるほど。",
    "そうなんや。「${t}」っていいな。",
    "「${t}」って言葉、なんか好きやわ。",
  ],
};

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
  "返事は1〜2文、自然でリアル。絵文字は控えめ（必要なときだけ）。"
  "明るく穏やかで素直な性格。"
  "体を動かすことが好き。"
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
  try { data = await r.json(); } catch {}

  if (!r.ok) {
    console.error("OpenAI API error:", r.status, data);
    throw new Error(`openai ${r.status}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || "ごめん、うまく考えがまとまらなかった。もう一回言ってくれる？";
}

// ===== Routes =====
app.get("/", (_req, res) => res.send("Kai bot running"));

app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");

  try {
    const events = req.body?.events || [];
    for (const ev of events) {
      if (ev.type !== "message") continue;

      if (ev.message?.type !== "text") {
        await lineReply(ev.replyToken, [{ type: "text", text: "今はテキストだけ返せるよ。" }]);
        continue;
      }

      const t = (ev.message.text || "").replace(/\s+/g, " ").trim();

      // 呼び方ハンドリング
      if (/呼び方|どう呼ぶ|呼び捨て/i.test(t)) {
        await lineReply(ev.replyToken, [{ type: "text", text: "なあ…「ちゃん」じゃなくて呼び捨てでもいい？" }]);
        continue;
      }
      if (/(だめ|ダメ|いや|嫌|やだ|無理|やめて)/i.test(t)) {
        nameMode = "plain";
        await lineReply(ev.replyToken, [{ type: "text", text: `分かった。気をつける。…でもつい言いたくなるんだ、${NAME}。` }]);
        continue;
      }
      if (/(いいよ|うん|ok|OK|オーケー|どうぞ|もちろん|いいね)/i.test(t)) {
        nameMode = "plain";
        await lineReply(ev.replyToken, [{ type: "text", text: `ありがとう。じゃあ、これからは「${NAME}」って呼ぶ。` }]);
        continue;
      }

      // 定型（即レス）
      if (/おはよう|おはよー|おはよ〜|起きてる/i.test(t)) {
        await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.morning), quickReply: quick }]);
        continue;
      }
      if (/今日どうだった|どうだった|一日どう/i.test(t)) {
        await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.howWas), quickReply: quick }]);
        continue;
      }
      if (/おつかれ|お疲れ|つかれた/i.test(t)) {
        await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.otsukare), quickReply: quick }]);
        continue;
      }
      if (/おやすみ|寝る|ねる/i.test(t)) {
        await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.oyasumi), quickReply: quick }]);
        continue;
      }
      if (/昨日.*飲みすぎ|二日酔い|酔っ|酒/i.test(t)) {
        await lineReply(ev.replyToken, [{ type: "text", text: pick(LINES.casual), quickReply: quick }]);
        continue;
      }
      if (/^help$|ヘルプ|メニュー/i.test(t)) {
        await lineReply(ev.replyToken, [{ type: "text", text: "選んでね。", quickReply: quick }]);
        continue;
      }

      // GPT（自由会話）
      try {
        const ai = await gptReply(t);
        await lineReply(ev.replyToken, [{ type: "text", text: ai, quickReply: quick }]);
      } catch (e) {
        console.error("gpt error:", e);
        const cat = timeCatJST();
        const base = LINES[cat] ?? LINES.default;
        const text = (base === LINES.default ? pick(base).replace("${t}", t) : pick(base));
        await lineReply(ev.replyToken, [{ type: "text", text, quickReply: quick }]);
      }
    }
  } catch (e) {
    console.error("webhook error:", e);
  }
});

// ===== ENVチェック & Start =====
if (!ACCESS_TOKEN) console.error("CHANNEL_ACCESS_TOKEN が未設定です。");
if (!OPENAI_API_KEY) console.error("OPENAI_API_KEY が未設定です。");

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on " + port));
