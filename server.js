const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("."));

app.get("/api/env-test", (req, res) => {
  res.json({
    databaseUrlExists: !!process.env.DATABASE_URL,
    databaseUrlLength: process.env.DATABASE_URL
      ? process.env.DATABASE_URL.length
      : 0
  });
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

// DB接続テスト
app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");

    res.json({
      success: true,
      message: "データベースに接続できました。",
      time: result.rows[0].now
    });
  } catch (error) {
    console.error("DB接続エラー:", error);

    res.status(500).json({
      success: false,
      error: "データベースに接続できませんでした。",
      detail: error.message
    });
  }
});

app.post("/api/participants", async (req, res) => {
  try {
    const { shopId, eventId, seq } = req.body;

    if (!shopId || !eventId || !seq) {
      return res.status(400).json({
        error: "ShopID、EventID、またはSeqがありません。"
      });
    }

    console.log("ShopID:", shopId);
    console.log("EventID:", eventId);
    console.log("Seq:", seq);

    const participants = [];
    let offset = 0;

    while (true) {
      console.log("取得中 offset:", offset);

      const response = await fetch(
        "https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList.aspx/GetResultRanking",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            shopID: String(shopId),
            eventID: String(eventId),
            heldID: String(seq),
            offset: offset
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          `参加者データ取得失敗 HTTP ${response.status}`
        );
      }

      const result = await response.json();

      const datas = JSON.parse(result.d);

      console.log("今回取得:", datas.length, "人");

      if (datas.length === 0) {
        break;
      }

      datas.forEach((data) => {
        participants.push({
          id: data["会員ID"],
          name: data["ハンドルネーム"]
        });
      });

      offset += datas.length;

      if (datas.length < 32) {
        break;
      }
    }

    console.log(
      "最終取得人数:",
      participants.length
    );

    res.json({
      count: participants.length,
      participants: participants
    });

  } catch (error) {
  console.error("DB接続エラー:", error);

  res.status(500).json({
    success: false,
    error: "データベースに接続できませんでした。",
    detail: error.message || "エラーメッセージがありません",
    code: error.code || null,
    name: error.name || null
  });
}

});

const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(
    `サーバー起動: http://localhost:${PORT}`
  );
});

