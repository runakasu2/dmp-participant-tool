const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

// 外部データは全件検証してからDBへ保存する。
async function saveEventResults(eventInfo, participants) {
  const seen = new Set();
  const rows = participants.map(participant => {
    const id = String(participant.id ?? "").trim();
    const name = typeof participant.name === "string" ? participant.name.trim() : "";
    if (!id || id.length > 50 || !name || name.length > 100 || seen.has(id)) {
      throw new Error("大会結果の参加者情報が不正、またはDMP IDが重複しています。");
    }
    seen.add(id);
    const raw = participant.rank == null ? null : String(participant.rank).trim();
    const numeric = raw && /^[0-9]+$/.test(raw) ? Number(raw) : null;
    const rank = Number.isInteger(numeric) && numeric > 0 && numeric <= 2147483647 ? numeric : null;
    return { id, name, raw, rank };
  });
  // 未公開・空の結果で既存の大会情報や順位を上書きしない。
  if (!rows.length) return;
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const client = await pool.connect();
  let active = false;
  let releaseError;
  try {
    await client.query("BEGIN");
    active = true;
    // UPSERTで大会行をロックし、同じ大会の保存を直列化する。
    const event = await client.query(`
      INSERT INTO events (shop_id, event_id, seq, event_date, event_name, participant_count)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (shop_id, event_id, seq) DO UPDATE SET
        event_date = EXCLUDED.event_date, event_name = EXCLUDED.event_name,
        participant_count = EXCLUDED.participant_count, updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [String(eventInfo.shopId), String(eventInfo.eventId), String(eventInfo.held),
      eventInfo.eventDate || null, eventInfo.eventName || null, rows.length]);
    for (const row of rows) {
      const player = await client.query(`
        INSERT INTO players (dmp_id, handle_name) VALUES ($1, $2)
        ON CONFLICT (dmp_id) DO UPDATE SET
          handle_name = EXCLUDED.handle_name, updated_at = CURRENT_TIMESTAMP
        RETURNING id
      `, [row.id, row.name]);
      await client.query(`
        INSERT INTO event_results (event_record_id, player_id, rank, rank_raw)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (event_record_id, player_id) DO UPDATE SET
          rank = EXCLUDED.rank, rank_raw = EXCLUDED.rank_raw,
          updated_at = CURRENT_TIMESTAMP
      `, [event.rows[0].id, player.rows[0].id, row.rank, row.raw]);
    }
    await client.query("COMMIT");
    active = false;
  } catch (error) {
    if (active) {
      try { await client.query("ROLLBACK"); }
      catch (rollbackError) { releaseError = rollbackError; }
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/event-results", async (req, res) => {
  const { shopId, eventId, seq } = req.query;
  if (![shopId, eventId, seq].every(value => typeof value === "string" && value.trim())) {
    return res.status(400).json({success: false, error: "ShopID、EventID、Seqを指定してください。"});
  }
  try {
    const result = await pool.query(`
      SELECT e.id, e.shop_id, e.event_id, e.seq, e.event_name, e.event_date,
        r.rank, r.rank_raw, p.dmp_id, p.handle_name, dh.deck_name
      FROM events e
      LEFT JOIN event_results r ON r.event_record_id = e.id
      LEFT JOIN players p ON p.id = r.player_id
      LEFT JOIN LATERAL (
        SELECT h.deck_name FROM deck_history h
        WHERE h.player_id = r.player_id AND h.shop_id = e.shop_id
          AND h.event_id = e.event_id AND h.seq = e.seq
        ORDER BY h.created_at DESC, h.id DESC LIMIT 1
      ) dh ON TRUE
      WHERE e.shop_id = $1 AND e.event_id = $2 AND e.seq = $3
      ORDER BY r.rank ASC NULLS LAST, p.dmp_id
    `, [shopId, eventId, seq]);
    if (!result.rows.length) {
      return res.status(404).json({success: false, error: "大会が見つかりません。"});
    }
    const first = result.rows[0];
    const participants = result.rows.filter(row => row.dmp_id != null).map(row => ({
      id: row.dmp_id, name: row.handle_name, rank: row.rank,
      rankRaw: row.rank_raw, deckName: row.deck_name
    }));
    res.json({success: true, event: {
      shopId: first.shop_id, eventId: first.event_id, seq: first.seq,
      eventName: first.event_name, eventDate: first.event_date
    }, count: participants.length, participants});
  } catch (error) {
    console.error("保存済み大会結果取得エラー:", error);
    res.status(500).json({success: false, error: "保存済み大会結果を取得できませんでした。"});
  }
});

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

  const normalized =
    html
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

    const match =
      normalized.match(
        pattern
      );


    if (match) {

      const year =
        match[1];

      const month =
        match[2].padStart(
          2,
          "0"
        );

      const day =
        match[3].padStart(
          2,
          "0"
        );


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
// 大会詳細HTMLから大会名を取得
// ========================================

function extractEventName(html) {

  const text =
    html
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<[^>]+>/g,
        "\n"
      )
      .replace(
        /&nbsp;/gi,
        " "
      )
      .replace(
        /&amp;/gi,
        "&"
      )
      .replace(
        /&#39;/gi,
        "'"
      )
      .replace(
        /&quot;/gi,
        '"'
      )
      .replace(
        /\r/g,
        ""
      );


  const lines =
    text
      .split("\n")
      .map(
        line =>
          line.trim()
      )
      .filter(Boolean);


  const dateIndex =
    lines.findIndex(
      line =>
        line.includes(
          "開催日"
        )
    );


  if (dateIndex > 0) {

    return lines[
      dateIndex - 1
    ];
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

  const buffer =
  await response.arrayBuffer();

const decoder =
  new TextDecoder(
    "shift_jis"
  );

const html =
  decoder.decode(
    buffer
  );


  const dateInfo =
    extractEventDate(html);

    const eventName =
  extractEventName(
    html
  );

  if (eventName) {
    console.log(
      "取得した大会名:",
      eventName
    );
  }

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

    eventName,
    
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

  

    if (!Array.isArray(data)) {
      throw new Error("大会結果のデータ形式が不正です。");
    }
    if (data.length === 0) break;

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

    if (data.length < 30) {
  break;
}

offset += 30;
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

// ========================================
// 大会情報テーブル
// ShopID + EventID + Seq で大会を識別
// ========================================

await pool.query(`
  CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,

    shop_id VARCHAR(100)
      NOT NULL,

    event_id VARCHAR(100)
      NOT NULL,

    seq VARCHAR(100)
      NOT NULL,

    event_date DATE,

    event_name VARCHAR(255),

    participant_count INTEGER
      DEFAULT 0,

    created_at TIMESTAMP
      DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP
      DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (
      shop_id,
      event_id,
      seq
    )
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

      // 既存のdeck_historyに
// ShopIDとSeqを追加
await pool.query(`
  ALTER TABLE deck_history
  ADD COLUMN IF NOT EXISTS shop_id VARCHAR(100);
`);

await pool.query(`
  ALTER TABLE deck_history
  ADD COLUMN IF NOT EXISTS seq VARCHAR(100);
`);

      await pool.query(require("node:fs").readFileSync(
        require("node:path").join(__dirname, "migrations/001_event_results.sql"), "utf8"
      ));

      // ========================================
// デッキマスターテーブル
// ========================================

await pool.query(`
  CREATE TABLE IF NOT EXISTS decks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);


// ========================================
// デッキ別名テーブル
// ========================================

await pool.query(`
  CREATE TABLE IF NOT EXISTS deck_aliases (
    id SERIAL PRIMARY KEY,
    deck_id INTEGER NOT NULL
      REFERENCES decks(id)
      ON DELETE CASCADE,
    alias VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

      await pool.query(require("node:fs").readFileSync(
        require("node:path").join(__dirname, "migrations/002_event_deck_predictions.sql"), "utf8"
      ));

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


// recentDecks is already ordered by event date, newest first.
function predictDeck(recentDecks, manual, unavailable = false) {
  const names = recentDecks.slice(0, 3).map(history => history.deckName).filter(Boolean);
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) || 0) + 1);
  const autoDeckName = unavailable ? null : names.find(name => counts.get(name) >= 2) || names[0] || null;
  return {
    autoDeckName,
    manualDeckId: manual?.manual_deck_id ?? null,
    manualDeckName: manual?.deck_name ?? null,
    hasManualPrediction: Boolean(manual),
    finalDeckName: manual ? manual.deck_name : autoDeckName,
    source: manual ? "manual" : autoDeckName ? "auto" : "unknown",
    autoStatus: unavailable ? "unavailable" : "ok"
  };
}

async function loadPredictionData(shopId, eventId, seq) {
  const [decks, overrides] = await Promise.all([
    pool.query(`SELECT d.id, d.name,
      COALESCE((SELECT json_agg(a.alias ORDER BY a.alias)
        FROM deck_aliases a WHERE a.deck_id = d.id), '[]') AS aliases
      FROM decks d ORDER BY d.name`),
    pool.query(`
      SELECT p.dmp_id, prediction.manual_deck_id, d.name AS deck_name
      FROM event_deck_predictions prediction
      JOIN events e ON e.id = prediction.event_record_id
      JOIN players p ON p.id = prediction.player_id
      LEFT JOIN decks d ON d.id = prediction.manual_deck_id
      WHERE e.shop_id = $1 AND e.event_id = $2 AND e.seq = $3
    `, [String(shopId), String(eventId), String(seq)])
  ]);
  return {decks: decks.rows, manual: new Map(overrides.rows.map(row => [row.dmp_id, row]))};
}

// mode=manual + deckId=null means explicitly unknown; mode=auto removes the override.
app.put("/api/event-deck-prediction", async (req, res) => {
  const {shopId, eventId, seq, dmpId, mode, deckId} = req.body || {};
  if (![shopId, eventId, seq, dmpId].every(value => typeof value === "string" && value.trim() && value.length <= 100) ||
      !["manual", "auto"].includes(mode) ||
      (mode === "manual" && deckId !== null && (!Number.isInteger(deckId) || deckId <= 0 || deckId > 2147483647))) {
    return res.status(400).json({success: false, error: "大会・プレイヤー・予想デッキの指定が不正です。"});
  }
  let client;
  let active = false;
  let releaseError;
  try {
    // Fetch metadata before holding a transaction open over external network I/O.
    let detail = null;
    if (mode === "manual") {
      const existing = await pool.query("SELECT id FROM events WHERE shop_id = $1 AND event_id = $2 AND seq = $3", [shopId, eventId, seq]);
      if (!existing.rows.length) {
        detail = await fetchEventDetail("https://www.dmp-ranking.com/event.asp?" +
          new URLSearchParams({ShopID: shopId, EventID: eventId, Seq: seq}));
      }
    }
    client = await pool.connect();
    await client.query("BEGIN");
    active = true;
    // Lock the deck first, matching the merge operation's locking order.
    let deck = null;
    if (mode === "manual" && deckId !== null) {
      const selected = await client.query("SELECT id, name FROM decks WHERE id = $1 FOR KEY SHARE", [deckId]);
      if (!selected.rows.length) throw Object.assign(new Error("デッキが見つかりません。参加者一覧を再取得してください。"), {status: 404});
      deck = selected.rows[0];
    }
    const player = await client.query("SELECT id FROM players WHERE dmp_id = $1", [dmpId]);
    if (!player.rows.length) throw Object.assign(new Error("プレイヤーが見つかりません。"), {status: 404});
    if (mode === "manual") {
      await client.query(`
        INSERT INTO events (shop_id, event_id, seq, event_date, event_name)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (shop_id, event_id, seq) DO NOTHING
      `, [shopId, eventId, seq, detail?.eventDate || null, detail?.eventName || null]);
    }
    const event = await client.query("SELECT id FROM events WHERE shop_id = $1 AND event_id = $2 AND seq = $3 FOR UPDATE", [shopId, eventId, seq]);
    if (event.rows.length) {
      if (mode === "auto") {
        await client.query("DELETE FROM event_deck_predictions WHERE event_record_id = $1 AND player_id = $2",
          [event.rows[0].id, player.rows[0].id]);
      } else {
        await client.query(`
          INSERT INTO event_deck_predictions (event_record_id, player_id, manual_deck_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (event_record_id, player_id) DO UPDATE SET
            manual_deck_id = EXCLUDED.manual_deck_id, updated_at = CURRENT_TIMESTAMP
        `, [event.rows[0].id, player.rows[0].id, deckId]);
      }
    }
    await client.query("COMMIT");
    active = false;
    res.json({success: true, hasManualPrediction: mode === "manual",
      manualDeckId: deck?.id ?? null, manualDeckName: deck?.name ?? null});
  } catch (error) {
    if (active) {
      try { await client.query("ROLLBACK"); } catch (rollbackError) { releaseError = rollbackError; }
    }
    console.error("予想デッキ保存エラー:", error);
    res.status(error.status || 500).json({success: false, error: error.status ? error.message : "予想デッキを保存できませんでした。"});
  } finally {
    if (client) client.release(releaseError);
  }
});

// 全参加者の履歴を一度に取得。大会内の重複除去→開催日で順位付け。
async function fetchRecentDecks(dmpIds, {shopId, eventId, seq, eventDate}) {
  const result = await pool.query(`
    WITH latest AS (
      SELECT p.dmp_id, h.*,
        COALESCE(e.event_date, h.event_date) AS held_date,
        e.event_name,
        ROW_NUMBER() OVER (
          PARTITION BY h.player_id, h.shop_id, h.event_id, h.seq
          ORDER BY h.created_at DESC NULLS LAST, h.id DESC
        ) AS duplicate_number
      FROM deck_history h
      JOIN players p ON p.id = h.player_id
      LEFT JOIN events e ON e.shop_id = h.shop_id
        AND e.event_id = h.event_id AND e.seq = h.seq
      WHERE p.dmp_id = ANY($1::text[])
        AND h.shop_id IS NOT NULL AND h.seq IS NOT NULL
        AND NOT (h.shop_id = $2 AND h.event_id = $3 AND h.seq = $4)
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY player_id
        ORDER BY held_date DESC NULLS LAST, shop_id, event_id, seq
      ) AS recent_number
      FROM latest
      WHERE duplicate_number = 1 AND held_date < $5::date
        AND NULLIF(BTRIM(deck_name), '') IS NOT NULL
    )
    SELECT dmp_id, shop_id, event_id, seq, held_date::text AS event_date,
      event_name, deck_name
    FROM ranked WHERE recent_number <= 3
    ORDER BY dmp_id, recent_number
  `, [dmpIds, String(shopId), String(eventId), String(seq), eventDate]);
  const histories = new Map();
  for (const row of result.rows) {
    if (!histories.has(row.dmp_id)) histories.set(row.dmp_id, []);
    histories.get(row.dmp_id).push({shopId: row.shop_id, eventId: row.event_id,
      seq: row.seq, eventDate: row.event_date, eventName: row.event_name, deckName: row.deck_name});
  }
  return histories;
}

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

        }

        if (
          data.length < 32
        ) {
          break;
        }

        offset += 32;
      }

      // 同一IDをまとめ、参加者を一括保存する。
      const players = new Map();
      for (const participant of participants) {
        if (participant.id && participant.name) players.set(String(participant.id), participant.name);
      }
      if (players.size) {
        await pool.query(`
          INSERT INTO players (dmp_id, handle_name)
          SELECT * FROM unnest($1::text[], $2::text[])
          ON CONFLICT (dmp_id) DO UPDATE SET
            handle_name = EXCLUDED.handle_name, updated_at = CURRENT_TIMESTAMP
        `, [Array.from(players.keys()), Array.from(players.values())]);
      }
      let recentDecksStatus = "ok";
      let recentDecksMessage = null;
      let histories = new Map();
      if (participants.length) {
        try {
          const dateResult = await pool.query(`
            SELECT event_date::text AS event_date FROM events
            WHERE shop_id = $1 AND event_id = $2 AND seq = $3
          `, [String(shopId), String(eventId), String(seq)]);
          let eventDate = dateResult.rows[0]?.event_date;
          if (!eventDate) {
            const detail = await fetchEventDetail("https://www.dmp-ranking.com/event.asp?" +
              new URLSearchParams({ShopID: shopId, EventID: eventId, Seq: seq}));
            eventDate = detail.eventDate;
          }
          histories = await fetchRecentDecks(participants.map(p => String(p.id)), {shopId, eventId, seq, eventDate});
        } catch (error) {
          console.error("直近デッキ履歴取得エラー:", error);
          recentDecksStatus = "unavailable";
          recentDecksMessage = "直近の使用デッキを取得できませんでした。再取得してください。";
        }
      }

      const predictionData = await loadPredictionData(shopId, eventId, seq);

      res.json({
        success: true,

        count:
          participants.length,

        decks: predictionData.decks,
        recentDecksStatus,
        recentDecksMessage,
        participants: participants.map(participant => ({
          ...participant,
          recentDecks: histories.get(String(participant.id)) || [],
          prediction: predictDeck(histories.get(String(participant.id)) || [],
            predictionData.manual.get(String(participant.id)), recentDecksStatus !== "ok")
        }))
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

      await saveEventResults(eventInfo, participants);

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
// ShopID + EventID + Seq で大会を識別
// ========================================

app.get(
  "/api/deck-history",
  async (req, res) => {
    try {

      const {
        shopId,
        eventId,
        seq
      } = req.query;

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


      const result =
        await pool.query(
          `
            SELECT
              p.dmp_id,
              p.handle_name,
              dh.shop_id,
              dh.event_id,
              dh.seq,
              dh.event_date,
              dh.deck_name,
              dh.created_at

            FROM deck_history dh

            INNER JOIN players p
              ON dh.player_id = p.id

            WHERE
              dh.shop_id = $1
              AND dh.event_id = $2
              AND dh.seq = $3

            ORDER BY
              dh.created_at DESC;
          `,
          [
            String(shopId),
            String(eventId),
            String(seq)
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
// player + ShopID + EventID + Seq で識別
// ========================================

app.post(
  "/api/deck-history",
  async (req, res) => {
    try {

      const {
        dmpId,
        shopId,
        eventId,
        seq,
        eventDate,
        deckName
      } = req.body;


      if (
        !dmpId ||
        !shopId ||
        !eventId ||
        !seq ||
        !deckName
      ) {
        return res
          .status(400)
          .json({
            success: false,

            error:
              "DMP ID、ShopID、EventID、Seq、またはデッキ名がありません。"
          });
      }


      // ========================================
      // 入力されたデッキ名を正式名称に変換
      // ========================================

      const inputDeckName =
        String(deckName).trim();


      const deckMasterResult =
        await pool.query(
          `
            SELECT
              d.id,
              d.name

            FROM decks d

            LEFT JOIN deck_aliases da
              ON d.id = da.deck_id

            WHERE
              LOWER(d.name) =
                LOWER($1)

              OR LOWER(da.alias) =
                LOWER($1)

            LIMIT 1;
          `,
          [
            inputDeckName
          ]
        );


      let normalizedDeckName =
        inputDeckName;


      // デッキマスターに存在する場合は
      // 正式名称へ変換
      if (
        deckMasterResult.rows.length > 0
      ) {
        normalizedDeckName =
          deckMasterResult.rows[0].name;
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
      // 同じ選手・同じ大会の
      // 既存履歴を確認
      // --------------------------

      const existingResult =
        await pool.query(
          `
            SELECT id

            FROM deck_history

            WHERE
              player_id = $1
              AND shop_id = $2
              AND event_id = $3
              AND seq = $4

            ORDER BY
              created_at DESC

            LIMIT 1;
          `,
          [
            playerId,
            String(shopId),
            String(eventId),
            String(seq)
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
              normalizedDeckName,
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
                shop_id,
                event_id,
                seq,
                event_date,
                deck_name
              )

              VALUES
              (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6
              )

              RETURNING *;
            `,
            [
              playerId,
              String(shopId),
              String(eventId),
              String(seq),
              eventDate || null,
              normalizedDeckName
            ]
          );
      }


      res.json({
        success: true,

        // 実際に保存された正式名称も返す
        normalizedDeckName:
          normalizedDeckName,

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
// 保存済み大会一覧を取得
// ========================================

app.get(
  "/api/events",
  async (req, res) => {
    try {

      const result =
        await pool.query(
          `
            SELECT
              id,
              shop_id,
              event_id,
              seq,
              event_date,
              event_name,
              participant_count,
              created_at,
              updated_at

            FROM events

            ORDER BY
              event_date DESC,
              id DESC;
          `
        );


      res.json({
        success: true,

        count:
          result.rows.length,

        events:
          result.rows
      });

    } catch (error) {

      console.error(
        "大会一覧取得エラー:",
        error
      );


      res.status(500).json({
        success: false,

        error:
          "大会一覧を取得できませんでした。",

        detail:
          error.message
      });
    }
  }
);

// ========================================
// 大会ごとのデッキ母数・使用者を取得
// ========================================

app.get(
  "/api/event-deck-summary",
  async (req, res) => {
    try {

      const {
        shopId,
        eventId,
        seq
      } = req.query;


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


      // --------------------------
      // 大会情報取得
      // --------------------------

      const eventResult =
        await pool.query(
          `
            SELECT
              id,
              shop_id,
              event_id,
              seq,
              event_date,
              event_name,
              participant_count

            FROM events

            WHERE
              shop_id = $1
              AND event_id = $2
              AND seq = $3

            LIMIT 1;
          `,
          [
            String(shopId),
            String(eventId),
            String(seq)
          ]
        );


      if (
        eventResult.rows.length === 0
      ) {
        return res
          .status(404)
          .json({
            success: false,
            error:
              "大会情報が見つかりませんでした。"
          });
      }


      const event =
        eventResult.rows[0];


      // --------------------------
      // この大会のデッキ・使用者取得
      // --------------------------

      const deckResult =
        await pool.query(
          `
            SELECT
              dh.deck_name,
              p.dmp_id,
              p.handle_name

            FROM deck_history dh

            INNER JOIN players p
              ON dh.player_id = p.id

            WHERE
              dh.shop_id = $1
              AND dh.event_id = $2
              AND dh.seq = $3

            ORDER BY
              dh.deck_name ASC,
              p.handle_name ASC;
          `,
          [
            String(shopId),
            String(eventId),
            String(seq)
          ]
        );


      // --------------------------
      // デッキごとにまとめる
      // --------------------------

      const deckMap =
        new Map();


      deckResult.rows.forEach(
        (row) => {

          const deckName =
            row.deck_name;


          if (
            !deckMap.has(
              deckName
            )
          ) {

            deckMap.set(
              deckName,
              {
                deckName:
                  deckName,

                count:
                  0,

                players:
                  []
              }
            );
          }


          const deck =
            deckMap.get(
              deckName
            );


          deck.count +=
            1;


          deck.players.push({
            dmpId:
              row.dmp_id,

            handleName:
              row.handle_name
          });
        }
      );


      const participantCount =
        Number(
          event.participant_count
        ) || 0;


      const registeredCount =
        deckResult.rows.length;


      const unregisteredCount =
        Math.max(
          0,
          participantCount -
          registeredCount
        );


      const decks =
        Array.from(
          deckMap.values()
        )
          .map(
            (deck) => {

              const percentage =
                participantCount > 0
                  ? (
                      deck.count /
                      participantCount *
                      100
                    ).toFixed(1)
                  : "0.0";


              return {
                ...deck,

                percentage:
                  percentage
              };
            }
          )
          .sort(
            (a, b) => {

              if (
                b.count !==
                a.count
              ) {

                return (
                  b.count -
                  a.count
                );
              }


              return (
                a.deckName.localeCompare(
                  b.deckName,
                  "ja"
                )
              );
            }
          );


      res.json({
        success: true,

        event:
          event,

        participantCount:
          participantCount,

        registeredCount:
          registeredCount,

        unregisteredCount:
          unregisteredCount,

        decks:
          decks
      });


    } catch (error) {

      console.error(
        "大会デッキ母数取得エラー:",
        error
      );


      res.status(500).json({
        success: false,

        error:
          "大会のデッキ母数を取得できませんでした。",

        detail:
          error.message
      });
    }
  }
);

// ========================================
// プレイヤー検索
// DMP ID / ハンドルネーム
// ========================================

app.get(
  "/api/player-search",
  async (req, res) => {
    try {

      const query =
        String(
          req.query.q || ""
        ).trim();


      if (!query) {
        return res.status(400).json({
          success: false,
          error:
            "検索キーワードを入力してください。"
        });
      }


      const result =
        await pool.query(
          `
            SELECT
              id,
              dmp_id,
              handle_name

            FROM players

            WHERE
              dmp_id = $1
              OR handle_name ILIKE $2

            ORDER BY
              CASE
                WHEN dmp_id = $1
                  THEN 0
                WHEN LOWER(handle_name) =
                     LOWER($3)
                  THEN 1
                ELSE 2
              END,
              handle_name ASC

            LIMIT 50;
          `,
          [
            query,
            "%" + query + "%",
            query
          ]
        );


      res.json({
        success: true,
        count:
          result.rows.length,
        players:
          result.rows
      });


    } catch (error) {

      console.error(
        "プレイヤー検索エラー:",
        error
      );


      res.status(500).json({
        success: false,
        error:
          "プレイヤーを検索できませんでした。",
        detail:
          error.message
      });
    }
  }
);


// ========================================
// プレイヤー個人情報・デッキ履歴
// ========================================

app.get(
  "/api/player-detail",
  async (req, res) => {
    try {

      const dmpId =
        String(
          req.query.dmpId || ""
        ).trim();


      if (!dmpId) {
        return res.status(400).json({
          success: false,
          error:
            "DMP IDがありません。"
        });
      }


      // --------------------------
      // プレイヤー情報
      // --------------------------

      const playerResult =
        await pool.query(
          `
            SELECT
              id,
              dmp_id,
              handle_name

            FROM players

            WHERE dmp_id = $1

            LIMIT 1;
          `,
          [
            dmpId
          ]
        );


      if (
        playerResult.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "プレイヤーが見つかりませんでした。"
        });
      }


      const player =
        playerResult.rows[0];


      // --------------------------
      // 大会・デッキ履歴
      // --------------------------

      const historyResult =
        await pool.query(
          `
            SELECT
              dh.shop_id,
              dh.event_id,
              dh.seq,
              dh.event_date,
              dh.deck_name,
              e.event_name,
              e.participant_count

            FROM deck_history dh

            LEFT JOIN events e
              ON e.shop_id = dh.shop_id
              AND e.event_id = dh.event_id
              AND e.seq = dh.seq

            WHERE
              dh.player_id = $1

            ORDER BY
              dh.event_date DESC NULLS LAST,
              dh.created_at DESC;
          `,
          [
            player.id
          ]
        );


      // --------------------------
      // 使用デッキ集計
      // --------------------------

      const deckSummaryResult =
        await pool.query(
          `
            SELECT
              deck_name,
              COUNT(*)::int AS count

            FROM deck_history

            WHERE
              player_id = $1

            GROUP BY
              deck_name

            ORDER BY
              COUNT(*) DESC,
              deck_name ASC;
          `,
          [
            player.id
          ]
        );


      const deckSummary =
        deckSummaryResult.rows.map(
          (deck) => ({
            deckName:
              deck.deck_name,

            count:
              Number(deck.count)
          })
        );


      const history =
        historyResult.rows.map(
          (item) => ({
            shopId:
              item.shop_id,

            eventId:
              item.event_id,

            seq:
              item.seq,

            eventDate:
              item.event_date,

            eventName:
              item.event_name,

            participantCount:
              Number(
                item.participant_count
              ) || 0,

            deckName:
              item.deck_name
          })
        );


      res.json({
        success: true,

        player: {
          dmpId:
            player.dmp_id,

          handleName:
            player.handle_name
        },

        historyCount:
          history.length,

        deckSummary:
          deckSummary,

        history:
          history
      });


    } catch (error) {

      console.error(
        "プレイヤー詳細取得エラー:",
        error
      );


      res.status(500).json({
        success: false,
        error:
          "プレイヤー情報を取得できませんでした。",
        detail:
          error.message
      });
    }
  }
);

// ========================================
// デッキ管理
// ========================================


// ----------------------------------------
// デッキ一覧取得
// ----------------------------------------

app.get(
  "/api/decks",
  async (req, res) => {
    try {
      const result =
        await pool.query(`
          SELECT
            d.id,
            d.name,
            COALESCE(
              json_agg(
                da.alias
                ORDER BY da.alias
              )
              FILTER (
                WHERE da.id IS NOT NULL
              ),
              '[]'
            ) AS aliases
          FROM decks d
          LEFT JOIN deck_aliases da
            ON d.id = da.deck_id
          GROUP BY
            d.id,
            d.name
          ORDER BY
            d.name ASC;
        `);

      res.json({
        success: true,
        decks: result.rows
      });

    } catch (error) {
      console.error(
        "デッキ一覧取得エラー:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "デッキ一覧を取得できませんでした。",
        detail: error.message
      });
    }
  }
);


// ----------------------------------------
// 正式デッキ名を追加
// ----------------------------------------

app.post(
  "/api/decks",
  async (req, res) => {
    try {
      const name =
        String(
          req.body.name || ""
        ).trim();

      if (!name) {
        return res.status(400).json({
          success: false,
          error:
            "デッキ名を入力してください。"
        });
      }


      const result =
        await pool.query(
          `
            INSERT INTO decks (
              name
            )
            VALUES ($1)
            RETURNING
              id,
              name;
          `,
          [name]
        );


      res.json({
        success: true,
        deck: result.rows[0]
      });

    } catch (error) {

      // UNIQUE違反
      if (error.code === "23505") {
        return res.status(400).json({
          success: false,
          error:
            "そのデッキ名はすでに登録されています。"
        });
      }


      console.error(
        "デッキ追加エラー:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "デッキを追加できませんでした。",
        detail: error.message
      });
    }
  }
);


// ----------------------------------------
// 別名を追加
// ----------------------------------------

app.post(
  "/api/deck-aliases",
  async (req, res) => {
    try {
      const deckId =
        Number(req.body.deckId);

      const alias =
        String(
          req.body.alias || ""
        ).trim();


      if (
        !deckId ||
        !alias
      ) {
        return res.status(400).json({
          success: false,
          error:
            "デッキと別名を指定してください。"
        });
      }


      const deckResult =
        await pool.query(
          `
            SELECT
              id,
              name
            FROM decks
            WHERE id = $1;
          `,
          [deckId]
        );


      if (
        deckResult.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "デッキが見つかりません。"
        });
      }


      const result =
        await pool.query(
          `
            INSERT INTO deck_aliases (
              deck_id,
              alias
            )
            VALUES ($1, $2)
            RETURNING
              id,
              deck_id,
              alias;
          `,
          [
            deckId,
            alias
          ]
        );


      res.json({
        success: true,
        alias: result.rows[0]
      });

    } catch (error) {

      if (error.code === "23505") {
        return res.status(400).json({
          success: false,
          error:
            "その別名はすでに登録されています。"
        });
      }


      console.error(
        "別名追加エラー:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "別名を追加できませんでした。",
        detail: error.message
      });
    }
  }
);

// ========================================
// 正式デッキ名を編集
// ========================================

app.put(
  "/api/decks/:id",
  async (req, res) => {
    try {

      const deckId =
        Number(req.params.id);

      const name =
        String(
          req.body.name || ""
        ).trim();


      if (
        !deckId ||
        !name
      ) {
        return res.status(400).json({
          success: false,
          error:
            "デッキIDとデッキ名が必要です。"
        });
      }


      // 対象デッキが存在するか確認
      const deckResult =
        await pool.query(
          `
            SELECT
              id,
              name
            FROM decks
            WHERE id = $1;
          `,
          [deckId]
        );


      if (
        deckResult.rows.length === 0
      ) {
        return res.status(404).json({
          success: false,
          error:
            "デッキが見つかりません。"
        });
      }


      const oldName =
        deckResult.rows[0].name;


      // 正式名称を更新
      const result =
        await pool.query(
          `
            UPDATE decks

            SET
              name = $1,
              updated_at =
                CURRENT_TIMESTAMP

            WHERE id = $2

            RETURNING
              id,
              name;
          `,
          [
            name,
            deckId
          ]
        );


      // --------------------------------
      // 過去のdeck_historyも統一
      // --------------------------------

      await pool.query(
        `
          UPDATE deck_history

          SET
            deck_name = $1

          WHERE
            LOWER(deck_name) =
              LOWER($2);
        `,
        [
          name,
          oldName
        ]
      );


      res.json({
        success: true,
        oldName:
          oldName,
        deck:
          result.rows[0]
      });


    } catch (error) {

      if (error.code === "23505") {
        return res.status(400).json({
          success: false,
          error:
            "その正式デッキ名はすでに登録されています。"
        });
      }


      console.error(
        "デッキ名編集エラー:",
        error
      );


      res.status(500).json({
        success: false,
        error:
          "デッキ名を編集できませんでした。",
        detail:
          error.message
      });
    }
  }
);

// ========================================
// デッキ統合（同じ接続で全処理を確定・取り消しする）
// ========================================

app.post("/api/decks/:id/merge", async (req, res) => {
  const sourceId = Number(req.params.id);
  const targetId = Number(req.body?.targetDeckId);
  if (!["string", "number"].includes(typeof req.body?.targetDeckId) ||
      !/^[1-9]\d*$/.test(String(req.params.id)) ||
      !/^[1-9]\d*$/.test(String(req.body?.targetDeckId)) ||
      !Number.isSafeInteger(sourceId) || sourceId > 2147483647 ||
      !Number.isSafeInteger(targetId) || targetId > 2147483647 ||
      sourceId === targetId) {
    return res.status(400).json({
      success: false,
      error: "統合元と統合先には異なる有効なデッキIDを指定してください。"
    });
  }

  let client;
  let inTransaction = false;
  let releaseError;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    inTransaction = true;
    // 逆方向の同時統合でも同じ順番でロックする。
    const result = await client.query(
      "SELECT id, name FROM decks WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE",
      [[sourceId, targetId]]
    );
    const source = result.rows.find(deck => deck.id === sourceId);
    const target = result.rows.find(deck => deck.id === targetId);
    if (!source || !target) {
      await client.query("ROLLBACK");
      inTransaction = false;
      return res.status(404).json({
        success: false,
        error: "統合元または統合先が見つかりません。一覧を更新してください。"
      });
    }

    const history = await client.query(
      "UPDATE deck_history SET deck_name = $1 WHERE deck_name = $2",
      [target.name, source.name]
    );
    // alias は全体で UNIQUE。行を移動するので同じ別名を追加しない。
    const aliases = await client.query(
      "UPDATE deck_aliases SET deck_id = $1 WHERE deck_id = $2",
      [targetId, sourceId]
    );
    await client.query(
      "UPDATE event_deck_predictions SET manual_deck_id = $1, updated_at = CURRENT_TIMESTAMP WHERE manual_deck_id = $2",
      [targetId, sourceId]
    );
    await client.query("UPDATE decks SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", [targetId]);
    await client.query("DELETE FROM decks WHERE id = $1", [sourceId]);
    await client.query("COMMIT");
    inTransaction = false;
    res.json({
      success: true,
      sourceDeck: source,
      deck: target,
      updatedHistoryCount: history.rowCount,
      movedAliasCount: aliases.rowCount
    });
  } catch (error) {
    if (client && inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        releaseError = rollbackError;
        console.error("デッキ統合の取り消しエラー:", rollbackError);
      }
    }
    console.error("デッキ統合エラー:", error);
    res.status(500).json({success: false, error: "デッキを統合できませんでした。"});
  } finally {
    if (client) client.release(releaseError);
  }
});

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
