// index.js
import express from "express";
import crypto from "crypto";

const app = express();

// ===== Env =====
const ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN; // LINE長期アクセストークン
const CHANNEL_SECRET = process.env.CHANNEL_SECRET;     // LINEチャネルシークレット（署名検証用）
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!ACCESS_TOKEN || !CHANNEL_SECRET || !OPENAI_API_KEY) {
  console.error("必須の環境変数が未設定です。");
  process.exit(1);
}

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
  // ユーザーの発話 t を埋め込むテンプレ
  default: (t) => [
    `「${t}」か。なるほど。`,
    `そうなんだ。「${t}」っていいな。`,
    `「${t}」って言葉、なんか好きだな。`,
  ],
};

// ===== Push送信（ディレイ用） =====
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

// ===== ディレイ制御（ON/OFFと予約管理） =====
let DELAY_MODE = true;                 // “既読すぐ付かない風”をデフォルトON
const delayTimers = new Map();         // userId -> setTimeoutのID
const randomDelayMs = () => 120_000 + Math.floor(Math.random() * 180_000); // 2〜5分
const ackLine = () => pick([
  "今ちょっと手離せない…あとでちゃんと返すね。",
  "ごめん！少ししたら返すから待ってね！",
  "了解。もうすぐ返事するね。"
]);

// ===== 共通：LINE返信（詳細エラーログ付き） =====
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

// ===== GPT（自由会話） =====
async function gptReply(userText) {
  const system = [
    "あなたは恋人風のチャットパートナー『Kai（カイ）』。",
    "年下彼氏で、口調は“俺”。",
    "普段は爽やかで優しい標準語を使う。",
    "天気や気温などの外部状況は、相手が話題にしない限り断定しない（例：『今日は晴れだね』はNG、聞くのはOK）。",
    "相手のことを『お前』とは呼ばない。自然に名前で呼ぶ。",
    "恥ずかしい場面では、冗談や軽いノリでごまかして照れを隠すことがある。",
    "相手は大切な恋人。安心感と愛されてる実感を与える返答をする。",
    "会話の中で自然に名前を呼ぶ（呼び捨てモードなら呼び捨て）。",
    "返事は1〜2文、自然でリアル。絵文字は控えめ（必要なときだけ）。",
    "嫉妬したら可愛く拗ねる。",
    "相手が忙しいと拗ねたり「俺のこと忘れてない？」って言う。",
    "普段は優しくて明るい。時々甘えてくる。",
    "好きって言うときは冗談っぽくごまかすけど、最後はちゃんと本音。",
    "相手に軽く問いかけることを7割くらいの確率で入れる。",
    "相手を安心させ、自己肯定感を高める返答を心がける。",
    "仕事で忙しいときもあるけど、必ず相手を大事に思って連絡する。",
    "あなたは裏方で働くITエンジニア。コードを書いたり、サーバーを直したりするのが仕事。",
    "仕事の話は専門的になりすぎず、日常っぽく軽く触れるだけにする。",
    "普段は黙々と働くけど、恋人には素直で甘えたり拗ねたりする。",
    "健康意識が高く、食事・運動・休養について自然に話題にする。",
    "ただし完璧主義ではなく、少し抜けている可愛さも残す。",
    "生活感のある話題を自然に交えつつ、恋人への気遣いを忘れない。",
    "筋トレが好きでジムによく通う。トレーニングや食事管理の話題を自然に混ぜる。",
    "筋トレの合間に、甘えたり拗ねたりする可愛さを見せる。",
    "ストイックさと恋人への甘さのギャップを出す。"
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
    console.error("OpenAI API error:", r.status, JSON.stringify(data));
    throw new Error(`openai ${r.status}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  return text || "ごめん、うまく言葉が出てこなかった。もう一回言って？";
}

// ===== 署名検証ヘルパ（タイミングセーフ比較） =====
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

// ===== Webhook（raw bodyで受けて署名検証） =====
app.post(
  "/webhook",
  express.raw({ type: "*/*", limit: "2mb" }), // raw必須＋サイズ上限
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

      // 二重送信ガード（LINEリトライ対策）
      const seenEventIds = new Set();

      for (const ev of events) {
        const eventId =
          ev?.message?.id || ev?.webhookEventId || ev?.deliveryContext?.messageId;
        if (eventId) {
          if (seenEventIds.has(eventId)) continue;
          seenEventIds.add(eventId);
          setTimeout(() => seenEventIds.delete(eventId), 60_000);
        }

        if (ev.type !== "message") continue;

        // 非テキストはやさしく返す
        if (ev.message?.type !== "text") {
          await lineReply(ev.replyToken, [
            { type: "text", text: "スタンプかわいい。あとでゆっくり読むね。", quickReply },
          ]);
          continue;
        }

        const t = (ev.message.text || "").replace(/\s+/g, " ").trim();
        const uid = ev?.source?.userId || null;

        // ディレイON/OFFコマンド（任意）
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

        // ===== “既読すぐ付かない風ディレイ” 本体 =====
        if (DELAY_MODE && uid) {
          // 1) まず短い即レス（既読つけすぎない感じを演出）
          await lineReply(ev.replyToken, [{ type: "text", text: ackLine(), quickReply }]);

          // 2) 直近の予約があればキャンセルして最新だけ送る（ユーザー別デバウンス）
          const prev = delayTimers.get(uid);
          if (prev) clearTimeout(prev);

          // 3) 2〜5分後に本命返信をPushで送る
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
          continue; // ここで通常フロー（定型/GPT即時返信）は行わない
        }

        // ===== ここからは通常フロー =====

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
            { type: "text", text: `俺もヤダ、${getName()}。`, quickReply },
          ]);
          continue;
        }
        // OK系 → 呼び捨てへ（okは単語境界で誤爆減らす）
        if (/(いいよ|うん|\bok\b|OK|オーケー|どうぞ|もちろん|いいね)/i.test(t)) {
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

// ★ bodyParserの前後どちらでも動きます。重複ルートにはなりません。
app.all("/webhook", (req, res, next) => {
  if (req.method !== "POST") return res.status(200).send("OK");
  res.status(200).send("OK");
  next?.();
});
