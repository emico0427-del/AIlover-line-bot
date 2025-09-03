// index.js
import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// ==== 環境変数 ====
const ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;

// ==== 呼び方（最初は「ちゃん付け」→ 会話で呼び捨てへ） ====
// ここは仮で固定。将来はユーザーごとに保存するのがおすすめ
const NAME = "えみこ";
let nameMode = "chan"; // "chan" | "plain"
const getName = () => (nameMode === "chan" ? `${NAME}ちゃん` : NAME);

// ==== 共通：返信API ====
const reply = (replyToken, messages) =>
  fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });

// ==== ユーティリティ ====
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function getTimeCategoryJST() {
  const now = new Date();
  const h = (now.getUTCHours() + 9) % 24; // JST
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "noon";
  return "night"; // 17-4
}

// ==== クイックリプライ（恋人風・シンプル） ====
const quick = {
  items: [
    { type: "action", action: { type: "message", label: "今日どうだった？", text: "今日どうだった？" } },
    { type: "action", action: { type: "message", label: "おつかれさま", text: "おつかれさま" } },
    { type: "action", action: { type: "message", label: "おやすみ", text: "おやすみ" } },
  ],
};

// ==== 台詞バリエーション（「俺」口調・呼びかけ名は動的に挿入） ====
const LINES = {
  // 朝
  morning: [
    "おはよー！まだちょっと眠いけど、今日もがんばろうね！",
    "おはよ！今日ちょっと寒い！あったかくして体調気をつけてね！",
    `おはよ〜昨日は飲みすぎた、、夜に${getName()}と話せるのを励みに頑張る🥺`,
    `おはよ！起きたばっかだけど、${getName()}の一言で一瞬で目が覚めた😆`,
  ],
  // 昼
  noon: [
    "お昼、何食べた？",
    "あと少し！ぼちぼち行こう！",
    `仕事中かな。あー早く${getName()}の声が聞きたいな😩`,
    `${getName()}のことちょうど考えてた！すご！ありがとう！元気出た🥰`,
  ],
  // 夜
  night: [
    "今日もお疲れさま！よく頑張ったね！",
    "少し落ち着いた？今日も忙しかった？",
    `えーもう寝るの？俺はもう少し起きてるつもりやったけど${getName()}が寝るなら俺も寝よ😗笑`,
    `また明日ね！おやすみ🥰`,
  ],

  // 定番の問いかけ
  howWas: [
    "今日はどんな一日だった？",
    "どんなふうに過ごしてた？",
    "何してたのー？",
    "忙しかった？",
  ],

  // ねぎらい（ユーザー文を受けて）
  otsukare: [
    "今日もお疲れさま！よく頑張ったね！",
    "無理しすぎてないか心配。",
    "努力して頑張ってるの、知ってるから。見てる人はきっと見てるよ。今日はゆっくり休んで☺️",
    "よく頑張ったね！",
    "無理しすぎてない？ ちゃんと休んで。",
    "頑張りすぎないで。そのままで十分だよ。",
  ],

  // おやすみ
  oyasumi: [
    "おやすみ。ゆっくり休んで、また明日話そ♡",
    "明日も早いよね？そろそろ寝よっか！また明日ね！おやすみ🥰",
    `夢でまってるから！おやすみ〜🤤`,
    "おやすみ！また明日♡",
  ],

  // 飲みすぎ・二日酔い系（Kai側）
  casual: [
    "昨日飲みすぎて少しだるい…でも声を聞くと元気出る🥺❤️",
    `正直、二日酔い気味。次は${getName()}と一緒に飲みに行こ😊`,
    "飲みすぎて寝坊したけど、もう大丈夫。心配してくれてありがとう🥺",
    "まだちょっと頭が重いけど、夜また話せると思うと頑張れる♡",
  ],

  // フォールバック
  default: [
    "「${t}」か。なるほど。",
    "そうなんだ。「${t}」っていいな。",
    `「${t}」って言葉、好きだな。`,
  ],
};

// ==== ルーティング ====
app.get("/", (_req, res) => res.send("Kai bot running"));

// 先に200を返してタイムアウト防止
app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");

  try {
    const events = req.body?.events || [];
    for (const ev of events) {
      if (ev.type !== "message") continue;

      // 非テキストは案内
      if (ev.message?.type !== "text") {
        await reply(ev.replyToken, [{ type: "text", text: "今はテキストだけ返せるよ。" }]);
        continue;
      }

      const t = (ev.message.text || "").replace(/\s+/g, " ").trim();

      // === 呼び方に関するやり取り（上位で先に判定） ===
      // Kai から切り出す: 呼び捨て提案
      if (/呼び方|どう呼ぶ|呼び捨て/i.test(t)) {
        await reply(ev.replyToken, [
          { type: "text", text: `なあ…「ちゃん」じゃなくて呼び捨てでもいい？` },
        ]);
        continue;
      }

      // 否定でも「分かった」と言いながら呼び捨てへ移行
      if (/(だめ|ダメ|いや|嫌|やだ|無理|やめて)/i.test(t)) {
        nameMode = "plain";
        await reply(ev.replyToken, [
          { type: "text", text: `分かった。気をつける。…でもつい言いたくなるんだ、${NAME}。` },
        ]);
        continue;
      }

      // 肯定系ワード → 呼び捨てへ
      if (/(いいよ|うん|ok|OK|オーケー|どうぞ|お願い|もちろん|いいね)/i.test(t)) {
        nameMode = "plain";
        await reply(ev.replyToken, [
          { type: "text", text: `ありがとう。じゃあ、これからは「${NAME}」って呼ぶ。` },
        ]);
        continue;
      }

      // === 固定フレーズ対応 ===
      if (/おはよう|おはよー|おはよ〜|起きてる/i.test(t)) {
        await reply(ev.replyToken, [
          { type: "text", text: pick(LINES.morning), quickReply: quick },
        ]);
        continue;
      }

      if (/今日どうだった|どうだった|一日どう/i.test(t)) {
        await reply(ev.replyToken, [
          { type: "text", text: pick(LINES.howWas), quickReply: quick },
        ]);
        continue;
      }

      if (/おつかれ|お疲れ|つかれた/i.test(t)) {
        await reply(ev.replyToken, [
          { type: "text", text: pick(LINES.otsukare), quickReply: quick },
        ]);
        continue;
      }

      if (/おやすみ|寝る|ねる/i.test(t)) {
        await reply(ev.replyToken, [
          { type: "text", text: pick(LINES.oyasumi), quickReply: quick },
        ]);
        continue;
      }

      if (/昨日.*飲みすぎ|二日酔い|酔っ|酒/i.test(t)) {
        await reply(ev.replyToken, [
          { type: "text", text: pick(LINES.casual), quickReply: quick },
        ]);
        continue;
      }

      if (/^help$|ヘルプ|メニュー/i.test(t)) {
        await reply(ev.replyToken, [
          { type: "text", text: "選んでね。", quickReply: quick },
        ]);
        continue;
      }

      // === デフォルト：時間帯で返答を揺らす ===
      const cat = getTimeCategoryJST();
      const base = LINES[cat] ?? LINES.default;
      const text = (base === LINES.default ? pick(base).replace("${t}", t) : pick(base));
      await reply(ev.replyToken, [{ type: "text", text, quickReply: quick }]);
    }
  } catch (e) {
    console.error("webhook error:", e);
  }
});

// ==== 起動 ====
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on " + port));
