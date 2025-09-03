import express from "express";
import bodyParser from "body-parser";
import line from "@line/bot-sdk";

const app = express();
app.use(bodyParser.json());

// LINEチャネルの設定（環境変数から読み込む）
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// Webhookを受け取る部分
app.post("/webhook", (req, res) => {
  Promise
    .all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
});

// イベント処理
function handleEvent(event) {
  if (event.type !== "message" || event.message.type !== "text") {
    // テキスト以外は無視
    return Promise.resolve(null);
  }

  // オウム返し
  return client.replyMessage(event.replyToken, {
    type: "text",
    text: `Kaiから: ${event.message.text} 😊`,
  });
}

// Renderで動かすときのポート設定
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on ${port}`));
