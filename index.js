import express from "express";
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

// LINEからのWebhookを受け取る部分（テスト用）
app.post("/webhook", (req, res) => {
  console.log("Webhook受信:", JSON.stringify(req.body, null, 2));
  res.status(200).send("OK");
});

// Renderで動かすときのポート設定
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on ${port}`));
