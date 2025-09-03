// いまの bot.js / index.js の handle 部分だけ置き換えでOK
app.post("/webhook", async (req, res) => {
  res.status(200).send("OK");
  const ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
  const events = req.body?.events || [];

  const reply = (replyToken, messages) =>
    fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ replyToken, messages }),
    });

  for (const ev of events) {
    if (ev.type !== "message") continue;

    // 非テキスト対応
    if (ev.message.type !== "text") {
      await reply(ev.replyToken, [
        { type: "text", text: "今はテキストだけ返せるよ📝" },
      ]);
      continue;
    }

    const t = ev.message.text.trim();

    // 簡単コマンド
    if (/^help$/i.test(t)) {
      await reply(ev.replyToken, [
        { type: "text", text: "使い方：テキストを送ってね。/profile で挨拶を変えるよ！" },
      ]);
      continue;
    }
    if (/^\/profile/i.test(t)) {
      await reply(ev.replyToken, [
        { type: "text", text: "了解！今日は“やさしい年下彼氏モード💙”でいくね。" },
      ]);
      continue;
    }

    // ちょい人格
    let ans = "";
    if (/こんにち|こんば|はろ|ﾊﾛ|hello/i.test(t)) {
      ans = "Kai: こんにちは！今日もお疲れさま☺️";
    } else if (/疲|つかれ/i.test(t)) {
      ans = "Kai: えらい！よく頑張ったね。少し休んで水分とってね🫶";
    } else {
      ans = `Kai: 「${t}」って送ってくれた？うん、僕もそう思うよ！`;
    }

    // ほんの少し間を置いて返す（打ってる感）
    setTimeout(() => {
      reply(ev.replyToken, [{ type: "text", text: ans }]);
    }, 800);
  }
});
