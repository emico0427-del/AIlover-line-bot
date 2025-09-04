// index.js
import express from "express";
import bodyParser from "body-parser";
import OpenAI from "openai";

const app = express();
app.use(bodyParser.json());

// ====== ENV ======
const ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ====== OpenAI client ======
const oai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ====== 呼び方（簡易メモリ版：将来はユーザーごと永続化推奨） ======
const BASE_NAME = "えみこ";
let nameMode = "chan"; // "chan" | "plain"
const getName = () => (nameMode === "chan" ? `${BASE_NAME}ちゃん` : BASE_NAME);

// ====== LINE返信API ======
const reply = (replyToken, messages) =>
  fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });

// ====== ユーティリティ ======
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const jstHour = () => (new Date().getUTCHours() + 9) % 24;
const timeCat = () => {
  const h = jstHour();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "noon";
  return "night";
};
const render = (line, t = "") =>
  line.replaceAll("${NAME}", getName()).replaceAll("${t}", t);

// ====== 簡易コンテキスト（直近6往復） ======
const convo = new Map(); // userId -> [{role, content}, ...]
function pushTurn(userId, role, content) {
  const a = convo.get(userId) || [];
  a.push({ role, content });
  while (a.length > 12) a.shift();
  convo.set(userId, a);
}

// ====== クイックリプライ ======
const quick = {
  items: [
    { type: "action", action: { type: "message", label: "今日どうだった？", text: "今日どうだった？" } },
    { type: "action", action: { type: "message", label: "おつかれさま", text: "おつかれさま" } },
    { type: "action", action: { type: "message", label: "おやすみ", text: "おやすみ" } },
  ],
};

// ====== 定型文（プレースホルダ ${NAME}/${t}） ======
const LINES = {
  morning: [
    "おはよー！まだちょっと眠いけど、今日もがんばろうね！",
    "おはよ！今日ちょっと寒い！あったかくして体調気をつけてね！",
    "おはよ〜昨日は飲みすぎた、、夜に${NAME}と話せるのを励みに頑張る。",
    "おはよ！起きたばっかだけど、${NAME}の一言で目が覚めた。"
  ],
  noon: [
    "お昼、何食べた？",
    "あと少し！ぼちぼち行こう。",
    "仕事中かな。早く${NAME}の声が聞きたいな。",
    "${NAME}のことちょうど考えてた。元気出た。"
  ],
  night: [
    "今日もお疲れさま。よく頑張ったね。",
    "少し落ち着いた？今日も忙しかった？",
    "もう寝る？俺はもう少し起きてるけど、${NAME}が寝るなら俺も寝よ。",
    "また明日ね。おやすみ。"
  ],
  howWas: [
    "今日はどんな一日だった？",
    "どんなふうに過ごしてた？",
    "何してたの？",
    "忙しかった？"
  ],
  otsukare: [
    "今日もお疲れさま。よく頑張ったね。",
    "無理しすぎてないか心配。少し休めよ。",
    "ちゃんと頑張ってるの分かってる。今日はゆっくり休んで。",
    "頑張りすぎないで。そのままで十分だよ。"
  ],
  oyasumi: [
    "おやすみ。ゆっくり休んで、また明日話そ。",
    "明日も早いよね？そろそろ寝よっか。おやすみ。",
    "いい夢見て。俺もそばにいるつもりでいる。",
    "おやすみ。また明日。"
  ],
  casual: [
    "昨日飲みすぎて少しだるい…でも声を聞くと元気出る。",
    "正直、二日酔い気味。次は${NAME}と一緒に飲みに行こ。",
    "飲みすぎて寝坊したけど、もう大丈夫。心配させたな。",
    "まだ頭が重いけど、夜また話せると思うと頑張れる。"
  ],
  fallback: [
    "「${t}」か。なるほど。",
    "そうなんだ。「${t}」っていいな。",
    "「${t}」って言葉、好きだな。"
  ],
};

// ====== GPTフォールバック ======
async function gptReply(userId, userText) {
  const hints = {
    morning: "（今は朝。起床・体調・今日の予定の話題が自然）",
    noon: "（今は昼。休憩・お昼・午後の過ごし方の話題が自然）",
    night: "（今は夜。労い・振り返り・睡眠の話題が自然）",
  };
  const system = [
    "あなたは年下の彼氏『Kai』。一人称は「俺」。",
    "語尾は自然体。絵文字は相手に合わせて控えめ（多くても2つ）。",
    `相手は「${getName()}」。呼ぶときはそのまま呼び捨て。`,
    "相手の自己肯定感を上げる。否定や説教はしない。",
    "返答は1〜2文（最長3文）。必要なら2行でOK。",
    "最後に軽い質問を1つ添えて会話をつなぐ（毎回ではなく7割程度）。",
    hints[timeCat()] || ""
  ].join("\n");

  const history = convo.get(userId) || [];
  const messages = [
    { role: "system", content: system },
    ...history,
    { role: "user", content: userText }
  ];

  const res = await oai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 120,
    messages
  });

  const text = (res.choices?.[0]?.message?.content || "うん、分かった。").trim();
  pushTurn(userId, "user", userText);
  pushTurn(userId, "assistant", text);
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

// ====== ルーティング ======
app.get("/", (_req, res) => res.send("Kai bot running"));

app.post("/webhook", async (req, res) => {
  res.status(200).send("OK"); // LINEのタイムアウト回避

  try {
    const events = req.body?.events || [];
    for (const ev of events) {
      if (ev.type !== "message") continue;

      const userId = ev.source?.userId || "anon";

      // 非テキスト → 案内
      if (ev.message?.type !== "text") {
        await reply(ev.replyToken, [{ type: "text", text: "今はテキストだけ返せるよ。" }]);
        continue;
      }

      const t = (ev.message.text || "").replace(/\s+/g, " ").trim();

      // ===== 呼び方の流れ =====
      if (/呼び方|どう呼ぶ|呼び捨て/i.test(t)) {
        await reply(ev.replyToken, [{ type: "text", text: "なあ…「ちゃん」じゃなくて呼び捨てでもいい？" }]);
        continue;
      }
      // 否定でも呼び捨てに移行（仕様どおり）
      if (/(だめ|ダメ|いや|嫌|やだ|無理|やめて)/i.test(t)) {
        nameMode = "plain";
        await reply(ev.replyToken, [
          { type: "text", text: `分かった。気をつける。…でもつい言いたくなるんだ、${BASE_NAME}。` }
        ]);
        continue;
      }
      // 肯定 → 呼び捨てへ
      if (/(いいよ|うん|ok|OK|オーケー|どうぞ|お願い|もちろん|いいね)/i.test(t)) {
        nameMode = "plain";
        await reply(ev.replyToken, [
          { type: "text", text: `ありがとう。じゃあ、これからは「${BASE_NAME}」って呼ぶ。` }
        ]);
        continue;
      }

      // ===== 定型（高速・安価） =====
      if (/おはよう|おはよー|おはよ〜|起きてる/i.test(t)) {
        await reply(ev.replyToken, [{ type: "text", text: render(pick(LINES.morning)), quickReply: quick }]);
        pushTurn(userId, "user", t);
        pushTurn(userId, "assistant", "（朝の定型）");
        continue;
      }
      if (/今日どうだった|どうだった|一日どう/i.test(t)) {
        await reply(ev.replyToken, [{ type: "text", text: render(pick(LINES.howWas)), quickReply: quick }]);
        pushTurn(userId, "user", t);
        pushTurn(userId, "assistant", "（どうだった定型）");
        continue;
      }
      if (/おつかれ|お疲れ|つかれた/i.test(t)) {
        await reply(ev.replyToken, [{ type: "text", text: render(pick(LINES.otsukare)), quickReply: quick }]);
        pushTurn(userId, "user", t);
        pushTurn(userId, "assistant", "（おつかれ定型）");
        continue;
      }
      if (/おやすみ|寝る|ねる/i.test(t)) {
        await reply(ev.replyToken, [{ type: "text", text: render(pick(LINES.oyasumi)), quickReply: quick }]);
        pushTurn(userId, "user", t);
        pushTurn(userId, "assistant", "（おやすみ定型）");
        continue;
      }
      if (/昨日.*飲みすぎ|二日酔い|酔っ|酒/i.test(t)) {
        await reply(ev.replyToken, [{ type: "text", text: render(pick(LINES.casual)), quickReply: quick }]);
        pushTurn(userId, "user", t);
        pushTurn(userId, "assistant", "（飲みすぎ定型）");
        continue;
      }
      if (/^help$|ヘルプ|メニュー/i.test(t)) {
        await reply(ev.replyToken, [{ type: "text", text: "選んでね。", quickReply: quick }]);
        continue;
      }

      // ===== ヒットなし → GPTフォールバック =====
      try {
        const text = await gptReply(userId, t);
        await reply(ev.replyToken, [{ type: "text", text, quickReply: quick }]);
      } catch (e) {
        console.error("gpt error:", e);
        // GPT失敗時の最終フォールバック（時間帯の短文）
        const cat = timeCat();
        const base = LINES[cat] ?? LINES.fallback;
        const text = base === LINES.fallback ? render(pick(base), t) : render(pick(base));
        await reply(ev.replyToken, [{ type: "text", text, quickReply: quick }]);
      }
    }
  } catch (e) {
    console.error("webhook error:", e);
  }
});

// ====== 起動 ======
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on " + port));
