// index.js
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// ===== Env =====
const ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ===== 呼び方（まずは固定。将来はユーザーごとに保存推奨） =====
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

function timeCatJST() {
  const h = (new Date().getUTCHours() + 9) % 24;
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "noon";
  return "night";
}

// ===== Quick replies =====
const quick = {
  items: [
    { type: "action", action: { type: "message", label: "今日どうだった？", text: "今日どうだった？" } },
    { type: "action", action: { type: "message", label: "おつかれさま", text: "おつかれさま" } },
    { type: "action", action: { type: "message", label: "おやすみ", text: "おやすみ" } },
  ],
};

// ===== 定型（まずはここで即レス。その後はGPT） =====
const LINES = {
  morning: [
    "おはよー！まだちょっと眠いけど、今日もいこ。",
    `おはよ！外ちょい寒い。あったかくしてな、${getName()}。`,
    `おはよ〜。昨日ちょっと飲みすぎた…夜に${getName()}と話せるの励みに頑張る。`,
  ],
  noon: [
    "お昼、何食べた？",
    "あと少し。ぼちぼちいこ。",
    `今ちょうど${getName()}のこと考えてた。連絡くれて元気出た。`,
  ],
  night: [
    "今日もお疲れ。よく頑張ったな。",
    "落ち着いた？無理してない？",
    "また明日話そ。おやすみ。",
  ],
  howWas: ["今日はどんな一日やった？", "何してた？", "忙しかった？"],
  otsukare: [
    "今日もお疲れ。よく頑張ったな。",
    "無理しすぎてない？ちゃんと休めよ。",
    "頑張りすぎんでいい。そのままで十分やで。",
  ],
  oyasumi: ["おやすみ。また明日。", "そろそろ寝よっか。おやすみ。", "ゆっくり休んで。おやすみ。"],
  casual: [
    "昨日飲みすぎてちょいだる…でも声聞くと元気出る。",
    `二日酔い気味。次は${getName()}と一緒に飲みに行こ。`,
  ],
  default: [
    "「${t}」か。なるほど。",
    "そうなんや。「${t}」っていいな。",
    "「${t}」って言葉、なんか好きやわ。",
  ],
};

// ===== GPT（fallback/自由会話） =====
// Node18+ なら fetch はグローバルでOK。モデルは軽めで十分自然: gpt-4o-mini
async function gptReply(userText) {
  const system = [
    "あなたは恋人風のチャットパートナー『Kai（カイ）』。",
    "口調は“俺”。落ち着いて優しい。絵文字は多用しない（使っても少なめ）。",
    `相手の名前は「${NAME}」。現在の呼び方は「${getName()}」。`,
    "短め〜中くらいの自然な日本語で返す。1通は1〜2文程度が基本。",
    "過度に質問攻めにしないが、会話が続くよう軽く問い返すのはOK。",
    "相手を否定しない。安心と自己肯定感が上がる返しを心がける。",
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
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || "ごめん、ちょっと上手く考えがまとまらなかった。もう一回言ってくれる？";
}

// ===== Routes =====
app.get("/", (_req, res) => res.send("Kai bot running"));

// まず200返してタイムアウト防止
app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");

  try {
    const events = req.body?.events || [];
    for (const ev of events) {
      if (ev.type !== "message") continue;

      // テキスト以外は案内
      if (ev.message?.type !== "text") {
        await lineReply(ev.replyToken, [
          { type: "text", text: "今はテキストだけ返せるよ。" },
        ]);
        continue;
      }

      const t = (ev.message.text || "").replace(/\s+/g, " ").trim();

      // --- 呼び捨て提案/切替（先に判定） ---
      if (/呼び方|どう呼ぶ|呼び捨て/i.test(t)) {
        await lineReply(ev.replyToken, [
          { type: "text", text: `なあ…「ちゃん」じゃなくて呼び捨てでもいい？` },
        ]);
        continue;
      }
      // 否定でも「分かった」と言いながら呼び捨てへ移行
      if (/(だめ|ダメ|いや|嫌|やだ|無理|やめて)/i.test(t)) {
        nameMode = "plain";
        await lineReply(ev.replyToken, [
          { type: "text", text: `分かった。気をつける。…でもつい言いたくなるんだ、${NAME}。` },
        ]);
        continue;
      }
      // 肯定 → 呼び捨てへ
      if (/(いいよ|うん|ok|OK|オーケー|どうぞ|もちろん|いいね)/i.test(t)) {
        nameMode = "plain";
        await lineReply(ev.replyToken, [
          { type: "text", text: `ありがとう。じゃあ、これからは「${NAME}」って呼ぶ。` },
        ]);
        continue;
      }

      // --- 定型（即レス） ---
      if (/おはよう|おはよー|おはよ〜|起きてる/i.test(t)) {
        await lineReply(ev.replyToken, [
          { type: "text", text: pick(LINES.morning), quickReply: quick },
        ]);
        continue;
      }
      if (/今日どうだった|どうだった|一日どう/i.test(t)) {
        await lineReply(ev.replyToken, [
          { type: "text", text: pick(LINES.howWas), quickReply: quick },
        ]);
        continue;
      }
      if (/おつかれ|お疲れ|つかれた/i.test(t)) {
        await lineReply(ev.replyToken, [
          { type: "text", text: pick(LINES.otsukare), quickReply: quick },
        ]);
        continue;
      }
      if (/おやすみ|寝る|ねる/i.test(t)) {
        await lineReply(ev.replyToken, [
          { type: "text", text: pick(LINES.oyasumi), quickReply: quick },
        ]);
        continue;
      }
      if (/昨日.*飲みすぎ|二日酔い|酔っ|酒/i.test(t)) {
        await lineReply(ev.replyToken, [
          { type: "text", text: pick(LINES.casual), quickReply: quick },
        ]);
        continue;
      }
      if (/^help$|ヘルプ|メニュー/i.test(t)) {
        await lineReply(ev.replyToken, [
          { type: "text", text: "選んでね。", quickReply: quick },
        ]);
        continue;
      }

      // --- ここから GPT（自由会話） ---
      try {
        const ai = await gptReply(t);
        await lineReply(ev.replyToken, [
          { type: "text", text: ai, quickReply: quick },
        ]);
      } catch (e) {
        console.error("gpt error:", e);
        // GPT失敗時は時間帯テンプレでフォールバック
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

// ===== Start =====
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on " + port));
