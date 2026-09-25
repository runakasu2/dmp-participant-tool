const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});


// ========================================
// 大会詳細URLを解析
// ========================================

function parseEventDetailUrl(detailUrl) {
  const url = new URL(detailUrl);

  if (!/^(www\.)?dmp-ranking\.com$/i.test(url.hostname)) {
    throw new Error(
      "DMPランキングの大会詳細URLを入力してください。"
    );
  }

  const shopId =
    url.searchParams.get("ShopID") ||
    url.searchParams.get("shop");

  const eventId =
    url.searchParams.get("EventID") ||
    url.searchParams.get("event");

  const seq =
    url.searchParams.get("Seq") ||
    url.searchParams.get("held");

  if (!shopId || !eventId || !seq) {
    throw new Error(
      "大会詳細URLからShopID、EventID、Seqを取得できませんでした。"
    );
  }

  return {
    shopId,
    eventId,
    seq
  };
}


// ========================================
// 大会詳細HTMLから開催日を取得
// ========================================

function extractEventDate(html) {
  const normalized = html
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");

  const patterns = [
    /開催日\s*[：:]\s*(\d{4})\s*[\/\-年]\s*(\d{1,2})\s*[\/\-月]\s*(\d{1,2})\s*日?/,

    /開催日.{0,80}?(\d{4})\s*[\/\-年]\s*(\d{1,2})\s*[\/\-月]\s*(\d{1,2})\s*日?/,

    /(\d{4})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match) {
      const year =
        match[1];

      const month =
        match[2].padStart(2, "0");

      const day =
        match[3].padStart(2, "0");

      return {
        year,
        eventDate:
          `${year}-${month}-${day}`
      };
    }
  }

  return null;
}


// ========================================
// 大会詳細URLから大会情報取得
// ========================================

async function fetchEventDetail(detailUrl) {
  const {
    shopId,
    eventId,
    seq
  } = parseEventDetailUrl(detailUrl);

  const canonicalDetailUrl =
    "https://www.dmp-ranking.com/event.asp" +
    "?ShopID=" +
    encodeURIComponent(shopId) +
    "&EventID=" +
    encodeURIComponent(eventId) +
    "&Seq=" +
    encodeURIComponent(seq);

  const response =
    await fetch(
      canonicalDetailUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0",

          "Accept":
            "text/html,application/xhtml+xml"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      `大会詳細ページ取得エラー: HTTP ${response.status}`
    );
  }

  const html =
    await response.text();

  const dateInfo =
    extractEventDate(html);

  if (!dateInfo) {
    throw new Error(
      "大会詳細ページから開催日を取得できませんでした。"
    );
  }

  const resultUrl =
    "https://www.dmp-ranking.com/Deckbuild/Event/EventResult" +
    "?year=" +
    encodeURIComponent(dateInfo.year) +
    "&shop=" +
    encodeURIComponent(shopId) +
    "&event=" +
    encodeURIComponent(eventId) +
    "&held=" +
    encodeURIComponent(seq);

  return {
    year:
      dateInfo.year,

    shopId:
      shopId,

    eventId:
      eventId,

    held:
      seq,

    eventDate:
      dateInfo.eventDate,

    detailUrl:
      canonicalDetailUrl,

    resultUrl:
      resultUrl
  };
}


// ========================================
// 大会結果参加者取得
// ========================================

async function fetchResultParticipants({
  year,
  shopId,
  eventId,
  held
}) {
  const participants = [];

  let offset = 0;

  while (true) {
    const response =
      await fetch(
        "https://www.dmp-ranking.com/Deckbuild/Event/EventResult.aspx/GetResultRanking",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json; charset=UTF-8",

            "User-Agent":
              "Mozilla/5.0"
          },

          body: JSON.stringify({
            year:
              String(year),

            shopID:
              String(shopId),

            eventID:
              String(eventId),

            heldID:
              String(held),

            offset:
              offset
          })
        }
      );

    if (!response.ok) {
      throw new Error(
        `DMPランキング取得エラー: HTTP ${response.status}`
      );
    }

    const result =
      await response.json();

    let data =
      result.d;

    if (typeof data === "string") {
      data =
        JSON.parse(data);
    }

    console.log(
      "大会結果取得:",
      data
    );

    if (
      !Array.isArray(data) ||
      data.length === 0
    ) {
      break;
    }

    for (const participant of data) {
      participants.push({
        id:
          participant["会員ID"],

        name:
          participant["ハンドルネーム"],

        rank:
          participant["順位"]
      });
    }

    if (data.length < 32) {
      break;
    }

    offset += 32;
  }

  return participants;
}


// ========================================
// DB接続テスト
// ========================================

app.get(
  "/api/db-test",
  async (req, res) => {
    try {
      const result =
        await pool.query(
          "SELECT NOW()"
        );

      res.json({
        success: true,

        message:
          "データベースに接続できました。",

        time:
          result.rows[0].now
      });

    } catch (error) {
      console.error(
        "DB接続エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "データベースに接続できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// DBテーブル作成
// ========================================

app.get(
  "/api/setup-db",
  async (req, res) => {
    try {

      await pool.query(`
        CREATE TABLE IF NOT EXISTS players (
          id SERIAL PRIMARY KEY,

          dmp_id VARCHAR(50)
            NOT NULL
            UNIQUE,

          handle_name VARCHAR(100)
            NOT NULL,

          created_at TIMESTAMP
            DEFAULT CURRENT_TIMESTAMP,

          updated_at TIMESTAMP
            DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS deck_history (
          id SERIAL PRIMARY KEY,

          player_id INTEGER
            NOT NULL
            REFERENCES players(id)
            ON DELETE CASCADE,

          event_id VARCHAR(100)
            NOT NULL,

          event_date DATE,

          deck_name VARCHAR(100)
            NOT NULL,

          created_at TIMESTAMP
            DEFAULT CURRENT_TIMESTAMP
        );
      `);

      res.json({
        success: true,

        message:
          "DBテーブルを作成しました。"
      });

    } catch (error) {
      console.error(
        "DBテーブル作成エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "DBテーブルを作成できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// プレイヤー登録
// ========================================

app.post(
  "/api/players",
  async (req, res) => {
    try {

      const {
        dmpId,
        handleName
      } = req.body;

      if (
        !dmpId ||
        !handleName
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "DMP IDまたはハンドルネームがありません。"
          });
      }

      const result =
        await pool.query(
          `
          INSERT INTO players
            (
              dmp_id,
              handle_name
            )
          VALUES
            (
              $1,
              $2
            )

          ON CONFLICT (dmp_id)

          DO UPDATE SET
            handle_name =
              EXCLUDED.handle_name,

            updated_at =
              CURRENT_TIMESTAMP

          RETURNING *;
          `,
          [
            String(dmpId),
            handleName
          ]
        );

      res.json({
        success: true,

        player:
          result.rows[0]
      });

    } catch (error) {
      console.error(
        "プレイヤー登録エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "プレイヤーを登録できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// DMPランキング参加表明者取得
// ========================================

app.post(
  "/api/participants",
  async (req, res) => {
    try {

      const {
        shopId,
        eventId,
        seq
      } = req.body;

      if (
        !shopId ||
        !eventId ||
        !seq
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "ShopID、EventID、またはSeqがありません。"
          });
      }

      const participants = [];

      let offset = 0;

      while (true) {

        const response =
          await fetch(
            "https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList.aspx/GetResultRanking",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json; charset=UTF-8"
              },

              body: JSON.stringify({
                shopID:
                  String(shopId),

                eventID:
                  String(eventId),

                heldID:
                  String(seq),

                offset:
                  offset
              })
            }
          );

        if (!response.ok) {
          throw new Error(
            `DMPランキング取得エラー: HTTP ${response.status}`
          );
        }

        const result =
          await response.json();

        let data =
          result.d;

        if (
          typeof data === "string"
        ) {
          data =
            JSON.parse(data);
        }

        if (
          !Array.isArray(data) ||
          data.length === 0
        ) {
          break;
        }

        for (
          const participant of data
        ) {
          const dmpId =
            participant["会員ID"];

          const handleName =
            participant[
              "ハンドルネーム"
            ];

          participants.push({
            id:
              dmpId,

            name:
              handleName
          });

          if (
            dmpId &&
            handleName
          ) {
            await pool.query(
              `
              INSERT INTO players
                (
                  dmp_id,
                  handle_name
                )

              VALUES
                (
                  $1,
                  $2
                )

              ON CONFLICT (dmp_id)

              DO UPDATE SET
                handle_name =
                  EXCLUDED.handle_name,

                updated_at =
                  CURRENT_TIMESTAMP;
              `,
              [
                String(dmpId),
                handleName
              ]
            );
          }
        }

        if (
          data.length < 32
        ) {
          break;
        }

        offset += 32;
      }

      res.json({
        success: true,

        count:
          participants.length,

        participants:
          participants
      });

    } catch (error) {
      console.error(
        "参加者取得エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "参加者一覧を取得できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// 参加者をDBへ登録
// ========================================

app.post(
  "/api/participants/import",
  async (req, res) => {
    try {

      const {
        shopId,
        eventId,
        seq
      } = req.body;

      if (
        !shopId ||
        !eventId ||
        !seq
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "ShopID、EventID、またはSeqがありません。"
          });
      }

      const participants = [];

      let offset = 0;

      while (true) {

        const response =
          await fetch(
            "https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList.aspx/GetResultRanking",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json; charset=UTF-8"
              },

              body: JSON.stringify({
                shopID:
                  String(shopId),

                eventID:
                  String(eventId),

                heldID:
                  String(seq),

                offset:
                  offset
              })
            }
          );

        if (!response.ok) {
          throw new Error(
            `DMPランキング取得エラー: HTTP ${response.status}`
          );
        }

        const result =
          await response.json();

        let data =
          result.d;

        if (
          typeof data === "string"
        ) {
          data =
            JSON.parse(data);
        }

        if (
          !Array.isArray(data) ||
          data.length === 0
        ) {
          break;
        }

        for (
          const participant of data
        ) {
          participants.push({
            id:
              participant[
                "会員ID"
              ],

            name:
              participant[
                "ハンドルネーム"
              ]
          });
        }

        if (
          data.length < 32
        ) {
          break;
        }

        offset += 32;
      }

      for (
        const participant
        of participants
      ) {
        await pool.query(
          `
          INSERT INTO players
            (
              dmp_id,
              handle_name
            )

          VALUES
            (
              $1,
              $2
            )

          ON CONFLICT (dmp_id)

          DO UPDATE SET
            handle_name =
              EXCLUDED.handle_name,

            updated_at =
              CURRENT_TIMESTAMP;
          `,
          [
            String(
              participant.id
            ),

            participant.name
          ]
        );
      }

      res.json({
        success: true,

        count:
          participants.length,

        participants:
          participants
      });

    } catch (error) {
      console.error(
        "参加者DB登録エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "参加者をDBに登録できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// 大会詳細URL
// ↓
// ShopID / EventID / Seq
// ↓
// 開催日
// ↓
// 大会結果URL生成
// ========================================

app.post(
  "/api/event-detail",
  async (req, res) => {
    try {

      const {
        detailUrl
      } = req.body;

      if (!detailUrl) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "大会詳細URLがありません。"
          });
      }

      const eventInfo =
        await fetchEventDetail(
          detailUrl
        );

      res.json({
        success: true,
        ...eventInfo
      });

    } catch (error) {
      console.error(
        "大会詳細取得エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "大会詳細ページから必要な情報を取得できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// 大会詳細URLから大会結果まで一括取得
// ========================================

app.post(
  "/api/event-result-from-detail",
  async (req, res) => {
    try {

      const {
        detailUrl
      } = req.body;

      if (!detailUrl) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "大会詳細URLがありません。"
          });
      }

      // --------------------------
      // 大会詳細取得
      // --------------------------

      const eventInfo =
        await fetchEventDetail(
          detailUrl
        );

      console.log(
        "大会情報:",
        eventInfo
      );

      console.log(
        "生成した大会結果URL:",
        eventInfo.resultUrl
      );


      // --------------------------
      // 大会結果取得
      // --------------------------

      const participants =
        await fetchResultParticipants(
          eventInfo
        );


      // --------------------------
      // 結果参加者をDB登録
      // --------------------------

      for (
        const participant
        of participants
      ) {

        if (
          !participant.id ||
          !participant.name
        ) {
          continue;
        }

        await pool.query(
          `
          INSERT INTO players
            (
              dmp_id,
              handle_name
            )

          VALUES
            (
              $1,
              $2
            )

          ON CONFLICT (dmp_id)

          DO UPDATE SET
            handle_name =
              EXCLUDED.handle_name,

            updated_at =
              CURRENT_TIMESTAMP;
          `,
          [
            String(
              participant.id
            ),

            participant.name
          ]
        );
      }


      // --------------------------
      // ブラウザへ返す
      // --------------------------

      res.json({
        success: true,

        ...eventInfo,

        count:
          participants.length,

        participants:
          participants
      });

    } catch (error) {
      console.error(
        "大会結果一括取得エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "大会結果を取得できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// 従来の大会結果取得API
// ========================================

app.post(
  "/api/event-result",
  async (req, res) => {
    try {

      const {
        year,
        shopId,
        eventId,
        held
      } = req.body;

      if (
        !year ||
        !shopId ||
        !eventId ||
        !held
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Year、ShopID、EventID、または開催回がありません。"
          });
      }

      const participants =
        await fetchResultParticipants({
          year,
          shopId,
          eventId,
          held
        });

      res.json({
        success: true,

        count:
          participants.length,

        participants:
          participants
      });

    } catch (error) {
      console.error(
        "大会結果取得エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "大会結果を取得できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// 保存済みデッキを取得
// ========================================

app.get(
  "/api/deck-history",
  async (req, res) => {
    try {

      const {
        eventId
      } = req.query;

      if (!eventId) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "Event IDがありません。"
          });
      }

      const result =
        await pool.query(
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
            ON dh.player_id =
               p.id

          WHERE dh.event_id = $1

          ORDER BY
            dh.created_at DESC;
          `,
          [
            String(eventId)
          ]
        );

      res.json({
        success: true,

        decks:
          result.rows
      });

    } catch (error) {
      console.error(
        "保存済みデッキ取得エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "保存済みデッキを取得できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// デッキ履歴を保存
// ========================================

app.post(
  "/api/deck-history",
  async (req, res) => {
    try {

      const {
        dmpId,
        eventId,
        eventDate,
        deckName
      } = req.body;

      if (
        !dmpId ||
        !eventId ||
        !deckName
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "DMP ID、Event ID、またはデッキ名がありません。"
          });
      }


      // --------------------------
      // プレイヤー検索
      // --------------------------

      const playerResult =
        await pool.query(
          `
          SELECT id
          FROM players
          WHERE dmp_id = $1;
          `,
          [
            String(dmpId)
          ]
        );

      if (
        playerResult.rows.length === 0
      ) {
        return res
          .status(404)
          .json({
            success: false,

            error:
              "参加者がDBに登録されていません。"
          });
      }

      const playerId =
        playerResult.rows[0].id;


      // --------------------------
      // 既存履歴確認
      // --------------------------

      const existingResult =
        await pool.query(
          `
          SELECT id

          FROM deck_history

          WHERE
            player_id = $1
            AND event_id = $2

          ORDER BY
            created_at DESC

          LIMIT 1;
          `,
          [
            playerId,
            String(eventId)
          ]
        );

      let result;


      // --------------------------
      // 既存なら更新
      // --------------------------

      if (
        existingResult.rows.length > 0
      ) {

        result =
          await pool.query(
            `
            UPDATE deck_history

            SET
              event_date = $1,
              deck_name = $2,
              created_at =
                CURRENT_TIMESTAMP

            WHERE id = $3

            RETURNING *;
            `,
            [
              eventDate || null,
              deckName,
              existingResult.rows[0].id
            ]
          );

      } else {

        // --------------------------
        // 新規なら追加
        // --------------------------

        result =
          await pool.query(
            `
            INSERT INTO deck_history
              (
                player_id,
                event_id,
                event_date,
                deck_name
              )

            VALUES
              (
                $1,
                $2,
                $3,
                $4
              )

            RETURNING *;
            `,
            [
              playerId,
              String(eventId),
              eventDate || null,
              deckName
            ]
          );
      }

      res.json({
        success: true,

        deckHistory:
          result.rows[0]
      });

    } catch (error) {
      console.error(
        "デッキ履歴保存エラー:",
        error
      );

      res.status(500).json({
        success: false,

        error:
          "デッキ履歴を保存できませんでした。",

        detail:
          error.message
      });
    }
  }
);


// ========================================
// サーバー起動
// ========================================

app.listen(
  PORT,
  HOST,
  () => {
    console.log(
      `サーバー起動: http://localhost:${PORT}`
    );
  }
);