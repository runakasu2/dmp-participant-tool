const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

// ==============================
// DB接続テスト
// ==============================
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
      detail: error.message,
      code: error.code || null,
      name: error.name || null
    });
  }
});

// ==============================
// DBテーブル作成
// ==============================
app.get("/api/setup-db", async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS players (
        id SERIAL PRIMARY KEY,
        dmp_id VARCHAR(50) NOT NULL UNIQUE,
        handle_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS deck_history (
        id SERIAL PRIMARY KEY,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        event_id VARCHAR(100) NOT NULL,
        event_date DATE,
        deck_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    res.json({
      success: true,
      message: "DBテーブルを作成しました。"
    });
  } catch (error) {
    console.error("DBテーブル作成エラー:", error);

    res.status(500).json({
      success: false,
      error: "DBテーブルを作成できませんでした。",
      detail: error.message,
      code: error.code || null,
      name: error.name || null
    });
  }
});

// ==============================
// プレイヤー登録
// ==============================
app.post("/api/players", async (req, res) => {
  try {
    const { dmpId, handleName } = req.body;

    if (!dmpId || !handleName) {
      return res.status(400).json({
        success: false,
        error: "DMP IDまたはハンドルネームがありません。"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO players
        (dmp_id, handle_name)
      VALUES
        ($1, $2)
      ON CONFLICT (dmp_id)
      DO UPDATE SET
        handle_name = EXCLUDED.handle_name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
      `,
      [String(dmpId), handleName]
    );

    res.json({
      success: true,
      player: result.rows[0]
    });
  } catch (error) {
    console.error("プレイヤー登録エラー:", error);

    res.status(500).json({
      success: false,
      error: "プレイヤーを登録できませんでした。",
      detail: error.message,
      code: error.code || null,
      name: error.name || null
    });
  }
});

// ==============================
// DMPランキング参加者取得
// ==============================
app.post("/api/participants", async (req, res) => {
  try {
    const { shopId, eventId, seq } = req.body;

    if (!shopId || !eventId || !seq) {
      return res.status(400).json({
        success: false,
        error: "ShopID、EventID、またはSeqがありません。"
      });
    }

    const participants = [];
    let offset = 0;

    while (true) {
      const response = await fetch(
        "https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList.aspx/GetResultRanking",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8"
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
          `DMPランキング取得エラー: HTTP ${response.status}`
        );
      }

      const result = await response.json();

      let data = result.d;

      if (typeof data === "string") {
        data = JSON.parse(data);
      }

      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      for (const participant of data) {
  const dmpId = participant["会員ID"];
  const handleName = participant["ハンドルネーム"];

  participants.push({
    id: dmpId,
    name: handleName
  });

  // 参加者をDBに登録
  await pool.query(
    `
    INSERT INTO players
      (dmp_id, handle_name)
    VALUES
      ($1, $2)
    ON CONFLICT (dmp_id)
    DO UPDATE SET
      handle_name = EXCLUDED.handle_name,
      updated_at = CURRENT_TIMESTAMP;
    `,
    [
      String(dmpId),
      handleName
    ]
  );
}


      if (data.length < 32) {
        break;
      }

      offset += 32;
    }

    res.json({
      success: true,
      count: participants.length,
      participants: participants
    });
  } catch (error) {
    console.error("参加者取得エラー:", error);

    res.status(500).json({
      success: false,
      error: "参加者一覧を取得できませんでした。",
      detail: error.message,
      code: error.code || null,
      name: error.name || null
    });
  }
});

// ==============================
// 参加者をDBへ登録
// ==============================
app.post("/api/participants/import", async (req, res) => {
  try {
    const { shopId, eventId, seq } = req.body;

    if (!shopId || !eventId || !seq) {
      return res.status(400).json({
        success: false,
        error: "ShopID、EventID、またはSeqがありません。"
      });
    }

    const participants = [];
    let offset = 0;

    while (true) {
      const response = await fetch(
        "https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList.aspx/GetResultRanking",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8"
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
          `DMPランキング取得エラー: HTTP ${response.status}`
        );
      }

      const result = await response.json();

      let data = result.d;

      if (typeof data === "string") {
        data = JSON.parse(data);
      }

      if (!Array.isArray(data) || data.length === 0) {
        break;
      }

      for (const participant of data) {
  const dmpId = participant["会員ID"];
  const handleName = participant["ハンドルネーム"];

  participants.push({
    id: dmpId,
    name: handleName
  });

  // 参加者をDBに登録
  await pool.query(
    `
    INSERT INTO players
      (dmp_id, handle_name)
    VALUES
      ($1, $2)
    ON CONFLICT (dmp_id)
    DO UPDATE SET
      handle_name = EXCLUDED.handle_name,
      updated_at = CURRENT_TIMESTAMP;
    `,
    [
      String(dmpId),
      handleName
    ]
  );
}

      if (data.length < 32) {
        break;
      }

      offset += 32;
    }

    for (const participant of participants) {
      await pool.query(
        `
        INSERT INTO players
          (dmp_id, handle_name)
        VALUES
          ($1, $2)
        ON CONFLICT (dmp_id)
        DO UPDATE SET
          handle_name = EXCLUDED.handle_name,
          updated_at = CURRENT_TIMESTAMP;
        `,
        [
          String(participant.id),
          participant.name
        ]
      );
    }

    res.json({
      success: true,
      count: participants.length,
      participants: participants
    });
  } catch (error) {
    console.error("参加者DB登録エラー:", error);

    res.status(500).json({
      success: false,
      error: "参加者をDBに登録できませんでした。",
      detail: error.message,
      code: error.code || null,
      name: error.name || null
    });
  }
});

// ==============================
// 保存済みデッキを取得
// ==============================
app.get("/api/deck-history", async (req, res) => {
  try {
    const { eventId } = req.query;

    if (!eventId) {
      return res.status(400).json({
        success: false,
        error: "Event IDがありません。"
      });
    }

    const result = await pool.query(
      `
      SELECT
        p.dmp_id,
        p.handle_name,
        dh.event_id,
        dh.event_date,
        dh.deck_name,
        dh.created_at
      FROM deck_history dh
      INNER JOIN players p
        ON dh.player_id = p.id
      WHERE dh.event_id = $1
      ORDER BY dh.created_at DESC;
      `,
      [String(eventId)]
    );

    res.json({
      success: true,
      decks: result.rows
    });

  } catch (error) {
    console.error("保存済みデッキ取得エラー:", error);

    res.status(500).json({
      success: false,
      error: "保存済みデッキを取得できませんでした。",
      detail: error.message,
      code: error.code || null,
      name: error.name || null
    });
  }
});

// ==============================
// デッキ履歴を保存
// ==============================
app.post("/api/deck-history", async (req, res) => {
  try {
    const {
      dmpId,
      eventId,
      eventDate,
      deckName
    } = req.body;

    if (!dmpId || !eventId || !deckName) {
      return res.status(400).json({
        success: false,
        error: "DMP ID、Event ID、またはデッキ名がありません。"
      });
    }

    const playerResult = await pool.query(
      `
      SELECT id
      FROM players
      WHERE dmp_id = $1
      `,
      [String(dmpId)]
    );

    if (playerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "参加者がDBに登録されていません。"
      });
    }

    const playerId = playerResult.rows[0].id;

    const result = await pool.query(
      `
      INSERT INTO deck_history
        (player_id, event_id, event_date, deck_name)
      VALUES
        ($1, $2, $3, $4)
      RETURNING *;
      `,
      [
        playerId,
        String(eventId),
        eventDate || null,
        deckName
      ]
    );

    res.json({
      success: true,
      deckHistory: result.rows[0]
    });
  } catch (error) {
    console.error("デッキ履歴保存エラー:", error);

    res.status(500).json({
      success: false,
      error: "デッキ履歴を保存できませんでした。",
      detail: error.message,
      code: error.code || null,
      name: error.name || null
    });
  }
});

// ==============================
// サーバー起動
// ==============================
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(
    `サーバー起動: http://localhost:${PORT}`
  );
});