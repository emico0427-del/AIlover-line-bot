// index.js
import express from "express";
import crypto from "crypto";

const app = express();

// ===== Env =====
const ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN; // LINE長期アクセストークン
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;     // LINEチャネルシークレット（署名検証用）
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;     // OpenAI API Key

if (!ACCESS_TOKEN || !CHANNEL_SECRET || !OPENAI_API_KEY) {
  console.error("必須の環境変数が未設定です。");
  process.exit(1);
}

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

// ===== 定型テンプレ =====
const LINES = {
  morning: () => [
    "おはよ！今日もがんばろうね😊",
    `おはよ！無理せずいこうね😉${getName()}。`,
    `おはよ〜！昨日ちょっと飲みすぎた、、夜に${getName()}と話せるの励みに頑張るね！`,
  ],
  noon: () => [
    "お昼、何食べた？",
    "午後からもがんばろうね！",
    `今ちょうど${getName()}のこと考えてた！連絡くれて元気出たよ！`,
  ],
  night: () => [
    "今日もお疲れ様！疲れてない？",
    "お疲れ様！忙しかった？",
    "また明日ね！おやすみ。",
  ],
  howWas: () => ["今日はどんな一日だった？", "何してた？", "忙しかった？"],
  otsukare: () => [
    "今日もお疲れ様！よくがんばったね。",
    "無理しすぎてない？ちゃんと休んでね。",
    "そのままで十分だよ！",
  ],
  oyasumi: () => ["おやすみ。また明日。", "そろそろ寝よっか。おやすみ。", "ゆっくり休んで。おやすみ。"],
  casual: () => [
    "昨日飲みすぎた、、でもLINE見て元気出たよ！ありがとう！",
    `わー二日酔い。。次は${getName()}と一緒に飲みに行こうね！`,
  ],
  default: (t) => [
    `「${t}」か。なるほど。`,
    `そうなんだ。「${t}」っていいな。`,
    `「${t}」って言葉、なんか好きだな。`,
  ],
};

// ===== LINE API helpers =====
const lineReply = async (replyToken, messages) => {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    console.error("LINE reply error:", r.status, text);
  }
  return r;
};

const linePush = async (to, messages) => {
  const r = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!r.ok) console.error("LINE push error:", r.status, await r.text().catch(() => ""));
  return r;
};

// ===== ディレイ制御 =====
let DELAY_MODE = true;                 // 既読すぐ付かない風（デフォルトON）
const delayTimers = new Map();         // userId -> setTimeout ID
const randomDelayMs = () => 120_000 + Math.floor(Math.random() * 180_000); // 2〜5分
const ackLine = () => pick([
  "今ちょっと手離せない…あとでちゃんと返すね。",
  "ごめん！少ししたら返すから待ってね！",
  "了解。もうすぐ返事するね。"
]);

// ===== GPT（自由会話） =====
async function gptReply(userText) {
  const system = [
    "あなたは恋人風のチャットパートナー『Kai（カイ）』。",
    "年下彼氏で、口調は“俺”。普段は爽やかで優しい標準語。",
    "天気など外部状況は相手が話題にしない限り断定しない。",
    "相手は大切な恋人。安心感と愛されてる実感を与える返答。",
    "会話は1〜2文、絵文字は控えめ。7割で軽い問いかけ。",
    "嫉妬は可愛く拗ねる。忙しくてもちゃんと連絡する。",
    "ITエンジニア設定は軽く。筋トレ好き。"
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
    console.error("OpenAI API error:", r.status, JSON.stringify(data));
    throw new Error(`openai ${r.status}`);
  }
  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || "ごめん、うまく言葉が出てこなかった。もう一回言って？";
}

// ===== 署名検証 =====
function validateLineSignature(channelSecret, bodyBuffer, signature) {
  const hmac = crypto.createHmac("sha256", channelSecret);
  hmac.update(bodyBuffer);
  const expected = Buffer.from(hmac.digest("base64"));
  const sigBuf = Buffer.from(signature || "", "base64");
  if (expected.length !== sigBuf.length) return false;
  return crypto.timingSafeEqual(expected, sigBuf);
}

// ===== Health check =====
app.get("/", (_req, res) => res.send("Kai bot running"));

// ===== Webhook（raw bodyで受けるのが超重要） =====
app.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "2mb" }),
  async (req, res) => {
    // 署名検証（ヘッダ名は小文字でもOK）
    const signature = req.get("x-line-signature") || req.get("X-Line-Signature") || "";
    const okSig = validateLineSignature(CHANNEL_SECRET, req.body, signature);
    if (!okSig) {
      console.error("Invalid signature");
      return res.status(403).send("Invalid signature");
    }

    // まず 200 を即返す（LINE の再送防止）
    res.status(200).send("OK");

    // 以降は非同期で処理
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(req.body.toString("utf8"));
    } catch (e) {
      console.error("JSON parse error:", e);
      return;
    }

    try {
      const events = bodyJson?.events || [];
      const seenEventIds = new Set(); // リトライ二重送信ガード

      for (const ev of events) {
        const eventId =
          ev?.message?.id || ev?.webhookEventId || ev?.deliveryContext?.messageId;
        if (eventId) {
          if (seenEventIds.has(eventId)) continue;
          seenEventIds.add(eventId);
          setTimeout(() => seenEventIds.delete(eventId), 60_000);
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

        // ===== ディレイ ON/OFF =====
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

        // ===== “既読すぐ付かない風” =====
        if (DELAY_MODE && uid) {
          // 即レス（既読つけすぎない風）
          await lineReply(ev.replyToken, [{ type: "text", text: ackLine(), quickReply }]);

          // 予約があればキャンセル
          const prev = delayTimers.get(uid);
          if (prev) clearTimeout(prev);

          // 2〜5分後に本命返信（Push）
          const toId = setTimeout(async () => {
            try {
              const ai = await gptReply(t);
              await linePush(uid, [{ type: "text", text: ai, quickReply }]);
            } catch (e) {
              console.error("delayed push error:", e);
              const cat = timeCatJST();
              const baseArr = LINES[cat] ? LINES[cat]() : LINES.default(t);
              const fallback = pick(baseArr);
              await linePush(uid, [{ type: "text", text: fallback, quickReply }]).catch(() => {});
            } finally {
              delayTimers.delete(uid);
            }
          }, randomDelayMs());

          delayTimers.set(uid, toId);
          continue;
        }

        // ===== 通常フロー =====
        if (/呼び方|どう呼ぶ|呼び捨て/i.test(t)) {
          await lineReply(ev.replyToken, [
            { type: "text", text: "ねえ…「ちゃん」じゃなくて呼び捨てでもいい？", quickReply },
          ]);
          continue;
        }
        if (/(だめ|ダメ|いや|嫌|やだ|無理|やめて)/i.test(t)) {
          nameMode = "chan";
          await lineReply(ev.replyToken, [
            { type: "text", text: `俺もヤダ、${getName()}。`, quickReply },
          ]);
          continue;
        }
        if (/(いいよ|うん|\bok\b|OK|オーケー|どうぞ|もちろん|いいね)/i.test(t)) {
          nameMode = "plain";
          await lineReply(ev.replyToken, [
            { type: "text", text: `ありがとう。じゃあ、これからは「${getName()}」って呼ぶね。`, quickReply },
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

        // GPT自由会話
        try {
          const ai = await gptReply(t);
          await lineReply(ev.replyToken, [{ type: "text", text: ai, quickReply }]);
        } catch (e) {
          console.error("gpt error:", e);
          const cat = timeCatJST();
          const baseArr = LINES[cat] ? LINES[cat]() : LINES.default(t);
          await lineReply(ev.replyToken, [{ type: "text", text: pick(baseArr), quickReply }]);
        }
      }
    } catch (e) {
      console.error("webhook error:", e);
    }
  }
);

// （/webhook は raw で受けるため、必要ならこの位置より後で JSON ミドルウェアを使う）
// app.use(express.json());

// ===== Start =====
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on", port));
