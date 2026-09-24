const express = require("express");

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static("."));

app.post("/api/participants", async (req, res) => {
  try {
    const { shopId, eventId } = req.body;

    if (!shopId || !eventId) {
      return res.status(400).json({
        error: "ShopIDまたはEventIDがありません。"
      });
    }

    console.log("ShopID:", shopId);
    console.log("EventID:", eventId);

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
            heldID: "1",
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
    console.error(error);

    res.status(500).json({
      error: "参加者データの取得中にエラーが発生しました。",
      detail: error.message
    });
  }
});

const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(
    `サーバー起動: http://localhost:${PORT}`
  );
});