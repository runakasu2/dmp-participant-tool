let predictionParticipants = [];
let predictionDecks = [];

function renderPredictionSummary() {
  const summary = buildPredictionSummary(predictionParticipants, predictionDecks);
  const status = document.getElementById("prediction-summary-status");
  const list = document.getElementById("prediction-summary-list");
  list.replaceChildren();
  status.textContent = summary.participantCount
    ? `参加表明者：${summary.participantCount}人 ／ 予想済み：${summary.predictedCount}人 ／ 不明：${summary.unknownCount}人 ／ 予想カバー率：${summary.coverage}%`
    : "参加表明者：0人。予想母数を表示するには参加者を取得してください。";
  for (const deck of summary.decks) {
    const row = document.createElement("tr");
    for (const value of [deck.deckName, deck.count + "人", deck.percentage + "%"]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }
    list.appendChild(row);
  }
}

function createPredictionCell(participant, decks, event, onPredictionChanged = () => {}) {
  const cell = document.createElement("td");
  cell.className = "prediction-cell";
  cell.addEventListener("click", event => event.stopPropagation());
  let prediction = participant.prediction;
  const label = document.createElement("div");
  const select = document.createElement("select");
  select.setAttribute("aria-label", participant.name + "の手動予想デッキ");
  const unknown = document.createElement("option");
  unknown.value = "";
  unknown.textContent = "不明";
  select.appendChild(unknown);
  for (const deck of decks) {
    const option = document.createElement("option");
    option.value = String(deck.id);
    option.textContent = deck.name;
    select.appendChild(option);
  }
  const save = document.createElement("button");
  save.textContent = "手動で保存";
  const reset = document.createElement("button");
  reset.textContent = "自動予想に戻す";
  const status = document.createElement("small");
  status.setAttribute("role", "status");
  const render = () => {
    label.textContent = (prediction.finalDeckName || "不明") +
      (prediction.source === "manual" ? "（手動）" : prediction.autoStatus === "unavailable" ? "（履歴取得失敗）" : "（自動）");
    const current = prediction.hasManualPrediction ? prediction.manualDeckId : decks.find(d => d.name === prediction.autoDeckName)?.id;
    select.value = current == null ? "" : String(current);
    reset.disabled = !prediction.hasManualPrediction;
  };
  const update = async mode => {
    select.disabled = save.disabled = reset.disabled = true;
    status.textContent = "保存中...";
    try {
      const response = await fetch("/api/event-deck-prediction", {
        method: "PUT", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({...event, dmpId: String(participant.id), mode,
          deckId: select.value ? Number(select.value) : null})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存できませんでした。");
      prediction = {...prediction,
        hasManualPrediction: data.hasManualPrediction,
        manualDeckId: data.manualDeckId, manualDeckName: data.manualDeckName,
        finalDeckName: data.hasManualPrediction ? data.manualDeckName : prediction.autoDeckName,
        source: data.hasManualPrediction ? "manual" : prediction.autoDeckName ? "auto" : "unknown"};
      participant.prediction = prediction;
      onPredictionChanged();
      render();
      status.textContent = mode === "auto" ? "自動予想に戻しました。" : "保存しました。";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      select.disabled = save.disabled = false;
      reset.disabled = !prediction.hasManualPrediction;
    }
  };
  save.addEventListener("click", () => update("manual"));
  reset.addEventListener("click", () => update("auto"));
  cell.append(label, select, save, reset, status);
  render();
  return cell;
}

console.log(
  "新しいscript.jsが読み込まれています"
);


// ========================================
// メニュー・ページ取得
// ========================================

const menuParticipants =
  document.getElementById(
    "menu-participants"
  );

const menuResults =
  document.getElementById(
    "menu-results"
  );

const menuEvents =
  document.getElementById(
    "menu-events"
  );

const menuPlayers =
  document.getElementById(
    "menu-players"
  );

  const menuDecks =
  document.getElementById(
    "menu-decks"
  );


const pageParticipants =
  document.getElementById(
    "page-participants"
  );

const pageResults =
  document.getElementById(
    "page-results"
  );

const pageEvents =
  document.getElementById(
    "page-events"
  );

const pageEventDetail =
  document.getElementById(
    "page-event-detail"
  );

const pagePlayers =
  document.getElementById(
    "page-players"
  );

const pagePlayerDetail =
  document.getElementById(
    "page-player-detail"
  );

  const pageDecks =
  document.getElementById(
    "page-decks"
  );

// ========================================
// 全ページを非表示
// ========================================

function hideAllPages() {
  document.getElementById("page-deck-memo").style.display = "none";

  pageParticipants.style.display =
    "none";

  pageResults.style.display =
    "none";

  pageEvents.style.display =
    "none";

  pageEventDetail.style.display =
    "none";

  pagePlayers.style.display =
    "none";

  pagePlayerDetail.style.display =
    "none";

    pageDecks.style.display =
  "none";
}


// ========================================
// 全メニューのactiveを解除
// ========================================

function clearActiveMenus() {
  document.getElementById("menu-deck-memo").classList.remove("active");

  menuParticipants.classList.remove(
    "active"
  );

  menuResults.classList.remove(
    "active"
  );

  menuEvents.classList.remove(
    "active"
  );

  menuPlayers.classList.remove(
    "active"
  );
  menuDecks.classList.remove(
  "active"
);
}


// ========================================
// 参加表明
// ========================================

menuParticipants.addEventListener(
  "click",
  () => {

    hideAllPages();
    clearActiveMenus();

    pageParticipants.style.display =
      "block";

    menuParticipants.classList.add(
      "active"
    );
  }
);


// ========================================
// 大会結果
// ========================================

menuResults.addEventListener(
  "click",
  () => {

    hideAllPages();
    clearActiveMenus();

    pageResults.style.display =
      "block";

    menuResults.classList.add(
      "active"
    );
  }
);


// ========================================
// 大会一覧
// ========================================

menuEvents.addEventListener(
  "click",
  async () => {

    hideAllPages();
    clearActiveMenus();

    pageEvents.style.display =
      "block";

    menuEvents.classList.add(
      "active"
    );

    await loadEvents();
  }
);


// ========================================
// プレイヤー
// ========================================

menuPlayers.addEventListener(
  "click",
  () => {

    hideAllPages();
    clearActiveMenus();

    pagePlayers.style.display =
      "block";

    menuPlayers.classList.add(
      "active"
    );
  }
);

// ========================================
// デッキ管理ページ
// ========================================

menuDecks.addEventListener(
  "click",
  () => {

    hideAllPages();
    clearActiveMenus();

    pageDecks.style.display =
      "block";

    menuDecks.classList.add(
      "active"
    );

    loadDecks();
  }
);


// ========================================
// 参加表明者取得
// ========================================

const button =
  document.getElementById(
    "get-event"
  );


button.addEventListener(
  "click",
  async () => {

    const input =
      document.getElementById(
        "event-url"
      ).value.trim();


    try {

      const url =
        new URL(input);


      const shopId =
        url.searchParams.get(
          "ShopID"
        );

      const eventId =
        url.searchParams.get(
          "EventID"
        );

      const seq =
        url.searchParams.get(
          "Seq"
        );


      if (
        !shopId ||
        !eventId ||
        !seq
      ) {

        alert(
          "ShopID、EventID、またはSeqを取得できませんでした。"
        );

        return;
      }


      // --------------------------
      // 情報表示
      // --------------------------

      document.getElementById(
        "shop-id"
      ).textContent =
        shopId;

      document.getElementById(
        "event-id"
      ).textContent =
        eventId;

      document.getElementById(
        "seq"
      ).textContent =
        seq;


      // --------------------------
      // 参加者ページURL生成
      // --------------------------

      const participantUrl =
        "https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList" +
        "?shop=" +
        encodeURIComponent(
          shopId
        ) +
        "&event=" +
        encodeURIComponent(
          eventId
        ) +
        "&held=" +
        encodeURIComponent(
          seq
        ) +
        "&official=false";


      const link =
        document.getElementById(
          "participant-url"
        );

      link.href =
        participantUrl;

      link.textContent =
        participantUrl;


      // --------------------------
      // 参加者取得
      // --------------------------

      const response =
        await fetch(
          "/api/participants",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                shopId:
                  shopId,

                eventId:
                  eventId,

                seq:
                  seq
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        throw new Error(
          data.detail ||
          data.error ||
          "参加者データを取得できませんでした。"
        );
      }


      // --------------------------
      // 参加者一覧表示
      // --------------------------

      const list =
        document.getElementById(
          "participant-list"
        );


      list.innerHTML =
        "";


      predictionParticipants = data.participants;
      predictionDecks = data.decks;
      renderPredictionSummary();
      const displayedParticipants = data.participants;

      data.participants.forEach(
        (participant) => {

          const row =
            document.createElement(
              "tr"
            );


          const idCell =
            document.createElement(
              "td"
            );

          idCell.textContent =
            participant.id;


          const nameCell =
            document.createElement(
              "td"
            );

          nameCell.textContent =
            participant.name;


          const deckCell =
            document.createElement(
              "td"
            );


          if (data.recentDecksStatus === "unavailable") {
            deckCell.textContent = "履歴取得失敗";
          } else if (!participant.recentDecks?.length) {
            deckCell.textContent = "履歴なし";
          } else {
            const histories = document.createElement("ul");
            histories.className = "recent-decks";
            for (const history of participant.recentDecks) {
              const item = document.createElement("li");
              const date = document.createElement("small");
              date.textContent = history.eventDate;
              item.appendChild(document.createTextNode(history.deckName));
              item.appendChild(date);
              item.title = history.eventName || "大会名未登録";
              histories.appendChild(item);
            }
            deckCell.appendChild(histories);
          }
          const playerButton = document.createElement("button");
          playerButton.className = "player-detail-link";
          playerButton.textContent = participant.name;
          playerButton.addEventListener("click", event => {
            event.stopPropagation();
            openPlayerDetail(participant.id);
          });
          nameCell.replaceChildren(playerButton);
          row.className = "event-result-player";
          row.addEventListener("click", () => openPlayerDetail(participant.id));

          row.appendChild(
            idCell
          );

          row.appendChild(
            nameCell
          );

          row.appendChild(
            deckCell
          );


          row.appendChild(createPredictionCell(participant, data.decks, {shopId, eventId, seq}, () => {
            if (predictionParticipants === displayedParticipants) renderPredictionSummary();
          }));

          list.appendChild(
            row
          );
        }
      );


      document.getElementById(
        "participant-count"
      ).textContent =
        "取得件数：" +
        data.count +
        "人" + (data.recentDecksMessage ? "（" + data.recentDecksMessage + "）" : "");


    } catch (error) {

      console.error(
        error
      );


      alert(
        "参加者ページを取得できませんでした。\n" +
        error.message
      );
    }
  }
);


// ========================================
// 参加表明リセット
// ========================================

const resetButton =
  document.getElementById(
    "reset"
  );


resetButton.addEventListener(
  "click",
  () => {
    predictionParticipants = [];
    predictionDecks = [];
    renderPredictionSummary();


    document.getElementById(
      "event-url"
    ).value =
      "";


    document.getElementById(
      "shop-id"
    ).textContent =
      "-";


    document.getElementById(
      "event-id"
    ).textContent =
      "-";


    document.getElementById(
      "seq"
    ).textContent =
      "-";


    const participantUrl =
      document.getElementById(
        "participant-url"
      );


    participantUrl.href =
      "#";

    participantUrl.textContent =
      "-";


    document.getElementById(
      "participant-list"
    ).innerHTML =
      "";


    document.getElementById(
      "participant-count"
    ).textContent =
      "取得件数：0人";
  }
);


// ========================================
// 大会結果取得
// ========================================

const resultButton =
  document.getElementById(
    "get-result"
  );


resultButton.addEventListener(
  "click",
  async () => {

    const input =
      document.getElementById(
        "result-url"
      ).value.trim();


    if (!input) {

      alert(
        "大会詳細URLを入力してください。"
      );

      return;
    }


    void setMemoImportTarget(null);

    try {

      resultButton.disabled =
        true;

      resultButton.textContent =
        "大会結果取得中...";


      // --------------------------
      // 大会詳細URLをサーバーへ送信
      // --------------------------

      const response =
        await fetch(
          "/api/event-result-from-detail",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                detailUrl:
                  input
              })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        throw new Error(
          data.detail ||
          data.error ||
          "大会結果を取得できませんでした。"
        );
      }


      console.log(
        "大会情報・結果:",
        data
      );


      console.log(
        "自動生成された大会結果URL:",
        data.resultUrl
      );


      // --------------------------
      // 大会情報表示
      // --------------------------

      document.getElementById(
        "result-year"
      ).textContent =
        data.year;


      document.getElementById(
        "result-shop-id"
      ).textContent =
        data.shopId;


      document.getElementById(
        "result-event-id"
      ).textContent =
        data.eventId;


      document.getElementById(
        "result-held"
      ).textContent =
        data.held;


      // --------------------------
      // 保存済みデッキ取得
      // --------------------------

      const deckResponse =
        await fetch(
          "/api/deck-history" +
          "?shopId=" +
          encodeURIComponent(
            data.shopId
          ) +
          "&eventId=" +
          encodeURIComponent(
            data.eventId
          ) +
          "&seq=" +
          encodeURIComponent(
            data.held
          )
        );


      const deckData =
        await deckResponse.json();


      if (!deckResponse.ok) {

        throw new Error(
          deckData.detail ||
          deckData.error ||
          "保存済みデッキを取得できませんでした。"
        );
      }


      // --------------------------
      // DMP IDごとに保存済みデッキ整理
      // --------------------------

      const masterResponse = await fetch("/api/decks?sort=usage", {cache:"no-store"});
      const masterData = await masterResponse.json();
      if (!masterResponse.ok) throw new Error(masterData.error || "デッキ一覧を取得できませんでした。");

      const savedDecks = {};


      deckData.decks.forEach(
        (deck) => {

          const dmpId =
            String(
              deck.dmp_id
            );


          if (
            !savedDecks[
              dmpId
            ]
          ) {

            savedDecks[
              dmpId
            ] =
              deck.deck_name;
          }
        }
      );


      // --------------------------
      // 結果一覧
      // --------------------------

      const list =
        document.getElementById(
          "result-list"
        );


      list.innerHTML =
        "";


      const resultDeckInputs = new Map();

      data.participants.forEach(
        (participant) => {

          const row =
            document.createElement(
              "tr"
            );


          // 順位
          const rankCell =
            document.createElement(
              "td"
            );

          rankCell.textContent =
            participant.rank ??
            "-";


          // DMP ID
          const idCell =
            document.createElement(
              "td"
            );

          idCell.textContent =
            participant.id ??
            "-";


          // ハンドルネーム
          const nameCell =
            document.createElement(
              "td"
            );

          nameCell.textContent =
            participant.name ??
            "-";


          // デッキ入力
          const deckCell =
            document.createElement(
              "td"
            );


          const savedDeck = savedDecks[String(participant.id)];
          const deckInput = createDeckSelect(masterData.decks, {deckName:savedDeck, label:participant.name + "の使用デッキ"});
          resultDeckInputs.set(String(participant.id), deckInput);
          const deckNote = document.createElement("small");
          deckNote.textContent = deckInput.unmatchedDeckName
            ? "保存済み：" + deckInput.unmatchedDeckName + "（マスター未登録）。正式デッキを選んで保存するまで履歴は維持されます。" : "";
          deckInput.onSavedDeck = () => {
            deckNote.textContent = deckInput.unmatchedDeckName
              ? "保存済み：" + deckInput.unmatchedDeckName + "（マスター未登録）" : "";
          };
          deckCell.appendChild(deckNote);

          deckCell.appendChild(
            deckInput
          );


          // 保存ボタン
          const saveCell =
            document.createElement(
              "td"
            );


          const saveButton =
            document.createElement(
              "button"
            );


          saveButton.textContent =
            "保存";


          saveButton.addEventListener(
            "click",
            async () => {

              const deckId = Number(deckInput.value);
              if (!deckInput.value) {
                alert("デッキを選択してください。未選択では履歴を変更しません。");
                return;
              }
              deckInput.disabled = true;

              saveButton.disabled =
                true;

              saveButton.textContent =
                "保存中...";


              try {

                const saveResponse =
                  await fetch(
                    "/api/deck-history",
                    {
                      method:
                        "POST",

                      headers: {
                        "Content-Type":
                          "application/json"
                      },

                      body:
                        JSON.stringify({
                          dmpId:
                            participant.id,

                          shopId:
                            data.shopId,

                          eventId:
                            data.eventId,

                          seq:
                            data.held,

                          eventDate:
                            data.eventDate,

                          deckId: deckId
                        })
                    }
                  );


                const saveData =
                  await saveResponse.json();


                if (!saveResponse.ok) {

                  throw new Error(
                    saveData.detail ||
                    saveData.error ||
                    "デッキを保存できませんでした。"
                  );
                }


                deckInput.setSavedDeck(deckId, saveData.normalizedDeckName);
                deckNote.textContent = "";

                saveButton.textContent =
                  "保存済み";


                alert(
                  participant.name +
                  " のデッキを保存しました。\n\n" +
                  saveData.normalizedDeckName +
                  "\n大会開催日：" +
                  data.eventDate
                );


              } catch (error) {

                console.error(
                  error
                );


                alert(
                  "デッキを保存できませんでした。\n" +
                  error.message
                );


                saveButton.disabled =
                  false;

                saveButton.textContent =
                  "保存";
              } finally {
                deckInput.disabled = false;
                saveButton.disabled = false;
              }
            }
          );


          deckInput.addEventListener("change", () => { saveButton.textContent = "保存"; });

          saveCell.appendChild(
            saveButton
          );


          row.appendChild(
            rankCell
          );

          row.appendChild(
            idCell
          );

          row.appendChild(
            nameCell
          );

          row.appendChild(
            deckCell
          );

          row.appendChild(
            saveCell
          );


          list.appendChild(
            row
          );
        }
      );


      void setMemoImportTarget({shopId:String(data.shopId),eventId:String(data.eventId),seq:String(data.held)},resultDeckInputs);

      document.getElementById(
        "result-count"
      ).textContent =
        "取得件数：" +
        data.count +
        "人";


      alert(
        "大会結果を取得しました。\n" +
        data.count +
        "人\n\n" +
        "開催日：" +
        data.eventDate
      );


    } catch (error) {

      console.error(
        error
      );


      alert(
        "大会結果を取得できませんでした。\n" +
        error.message
      );


    } finally {

      resultButton.disabled =
        false;

      resultButton.textContent =
        "大会結果を取得";
    }
  }
);


// ========================================
// 大会結果リセット
// ========================================

const resultResetButton =
  document.getElementById(
    "result-reset"
  );


resultResetButton.addEventListener(
  "click",
  () => {
    void setMemoImportTarget(null);


    document.getElementById(
      "result-url"
    ).value =
      "";


    document.getElementById(
      "result-year"
    ).textContent =
      "-";


    document.getElementById(
      "result-shop-id"
    ).textContent =
      "-";


    document.getElementById(
      "result-event-id"
    ).textContent =
      "-";


    document.getElementById(
      "result-held"
    ).textContent =
      "-";


    document.getElementById(
      "result-list"
    ).innerHTML =
      "";


    document.getElementById(
      "result-count"
    ).textContent =
      "取得件数：0人";
  }
);


// ========================================
// 大会一覧
// ========================================

const reloadEventsButton =
  document.getElementById(
    "reload-events"
  );


const eventResetControls = createEventResetControls(afterReset => loadEvents(afterReset));
let eventsLoadVersion = 0;
async function loadEvents(afterReset = false) {
  if (eventResetControls.busy && !afterReset) return;
  const version = ++eventsLoadVersion;
  eventResetControls.beginLoad();

  const list =
    document.getElementById(
      "event-list"
    );

  const count =
    document.getElementById(
      "event-count"
    );


  list.innerHTML =
    `
      <tr>
        <td colspan="7">
          読み込み中...
        </td>
      </tr>
    `;


  try {

    const response =
      await fetch(
        "/api/events"
      );


    const data =
      await response.json();


    if (version !== eventsLoadVersion) return;
    if (!response.ok) {

      throw new Error(
        data.detail ||
        data.error ||
        "大会一覧を取得できませんでした。"
      );
    }


    list.innerHTML =
      "";


    count.textContent =
      "保存大会数：" +
      data.count +
      "件";


    if (
      !data.events ||
      data.events.length === 0
    ) {

      list.innerHTML =
        `
          <tr>
            <td colspan="7">
              保存されている大会はありません。
            </td>
          </tr>
        `;

      return;
    }


    data.events.forEach(
      (event) => {

        const row =
          document.createElement(
            "tr"
          );


        // --------------------------
        // 行をクリック可能にする
        // --------------------------

        row.style.cursor =
          "pointer";

        row.title =
          "クリックしてデッキ母数を表示";


        row.addEventListener(
          "click",
          () => {

            if (eventResetControls.rowClick(event.id)) return;
            openEventDetail(
              event
            );
          }
        );


        row.appendChild(eventResetControls.cell(event, row));

        // 開催日
        const dateCell =
          document.createElement(
            "td"
          );


        if (event.event_date) {

          const date =
            new Date(
              event.event_date
            );


          dateCell.textContent =
            date.toLocaleDateString(
              "ja-JP",
              {
                timeZone:
                  "Asia/Tokyo"
              }
            );


        } else {

          dateCell.textContent =
            "-";
        }


        // 大会名
        const nameCell =
          document.createElement(
            "td"
          );


        nameCell.textContent =
          event.event_name ||
          "大会名未取得";


        // 参加人数
        const participantCell =
          document.createElement(
            "td"
          );


        participantCell.textContent =
          event.participant_count +
          "人";


        // ShopID
        const shopCell =
          document.createElement(
            "td"
          );


        shopCell.textContent =
          event.shop_id;


        // EventID
        const eventCell =
          document.createElement(
            "td"
          );


        eventCell.textContent =
          event.event_id;


        // Seq
        const seqCell =
          document.createElement(
            "td"
          );


        seqCell.textContent =
          event.seq;


        row.appendChild(
          dateCell
        );

        row.appendChild(
          nameCell
        );

        row.appendChild(
          participantCell
        );

        row.appendChild(
          shopCell
        );

        row.appendChild(
          eventCell
        );

        row.appendChild(
          seqCell
        );


        list.appendChild(
          row
        );
      }
    );


  } catch (error) {
    if (version !== eventsLoadVersion) return;

    console.error(
      error
    );


    count.textContent =
      "保存大会数：-";


    list.innerHTML =
      `
        <tr>
          <td colspan="7">
            大会一覧を取得できませんでした。
          </td>
        </tr>
      `;


    alert(
      "大会一覧を取得できませんでした。\n" +
      error.message
    );
  } finally {
    if (version === eventsLoadVersion) eventResetControls.endLoad();
  }
}


reloadEventsButton.addEventListener(
  "click",
  async () => {

    await loadEvents();
  }
);


// ========================================
// 大会詳細・デッキ母数
// ========================================

const backEventsButton =
  document.getElementById(
    "back-events"
  );


let eventResultsRequest = 0;

async function loadEventResults(event) {
  const request = ++eventResultsRequest;
  const resultStatus = document.getElementById("event-results-status");
  const resultList = document.getElementById("event-results-list");
  resultList.replaceChildren();
  resultStatus.textContent = "読み込み中...";
  const addRow = (list, values) => {
    const row = document.createElement("tr");
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }
    list.appendChild(row);
    return row;
  };
  try {
    const query = new URLSearchParams({shopId: event.shop_id, eventId: event.event_id, seq: event.seq});
    const response = await fetch("/api/event-results?" + query);
    const data = await response.json();
    if (request !== eventResultsRequest) return;
    if (!response.ok) throw new Error(data.error || "取得に失敗しました。");
    resultStatus.textContent = data.count ? "保存済み：" + data.count + "人。プレイヤーをクリックすると個人ページを表示します。" : "保存済み大会結果がありません。";
    for (const player of data.participants) {
      const row = addRow(resultList, [player.rank == null ? "順位不明" : player.rank + "位", player.id, player.name, player.deckName?.trim() ? player.deckName : "未登録"]);
      row.className = "event-result-player";
      row.addEventListener("click", () => openPlayerDetail(player.id));
      const button = document.createElement("button");
      button.className = "player-detail-link";
      button.textContent = player.name;
      button.addEventListener("click", event => {
        event.stopPropagation();
        openPlayerDetail(player.id);
      });
      row.children[2].replaceChildren(button);
    }
  } catch (error) {
    if (request !== eventResultsRequest) return;
    resultStatus.textContent = "大会結果を取得できませんでした。" + error.message;
  }
}

async function openEventDetail(
  event
) {
  void loadEventResults(event);

  pageParticipants.style.display =
    "none";

  pageResults.style.display =
    "none";

  pageEvents.style.display =
    "none";

  pageEventDetail.style.display =
    "block";


  menuParticipants.classList.remove(
    "active"
  );

  menuResults.classList.remove(
    "active"
  );

  menuEvents.classList.add(
    "active"
  );


  document.getElementById(
    "detail-event-name"
  ).textContent =
    event.event_name ||
    "大会名未取得";


  let dateText =
    "-";


  if (event.event_date) {

    const date =
      new Date(
        event.event_date
      );


    dateText =
      date.toLocaleDateString(
        "ja-JP",
        {
          timeZone:
            "Asia/Tokyo"
        }
      );
  }


  document.getElementById(
    "detail-event-info"
  ).textContent =
    dateText +
    "　参加者" +
    event.participant_count +
    "人";


  const summary =
    document.getElementById(
      "deck-summary"
    );


  const list =
    document.getElementById(
      "deck-summary-list"
    );


  summary.textContent =
    "読み込み中...";


  list.innerHTML =
    "";


  try {

    const response =
      await fetch(
        "/api/event-deck-summary" +
        "?shopId=" +
        encodeURIComponent(
          event.shop_id
        ) +
        "&eventId=" +
        encodeURIComponent(
          event.event_id
        ) +
        "&seq=" +
        encodeURIComponent(
          event.seq
        )
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.detail ||
        data.error ||
        "デッキ母数を取得できませんでした。"
      );
    }


    summary.textContent =
      "参加者：" +
      data.participantCount +
      "人 ／ デッキ入力済み：" +
      data.registeredCount +
      "人 ／ 未入力：" +
      data.unregisteredCount +
      "人";


    // ====================================
    // 入力済みデッキ
    // ====================================

    data.decks.forEach(
      (deck) => {

        // --------------------------
        // 母数行
        // --------------------------

        const row =
          document.createElement(
            "tr"
          );


        row.style.cursor =
          "pointer";


        row.title =
          "クリックして使用者を表示";


        const nameCell =
          document.createElement(
            "td"
          );


        nameCell.textContent =
          "▶ " +
          deck.deckName;


        const countCell =
          document.createElement(
            "td"
          );


        countCell.textContent =
          deck.count +
          "人";


        const percentageCell =
          document.createElement(
            "td"
          );


        percentageCell.textContent =
          deck.percentage +
          "%";


        row.appendChild(
          nameCell
        );

        row.appendChild(
          countCell
        );

        row.appendChild(
          percentageCell
        );


        list.appendChild(
          row
        );


        // --------------------------
        // 使用者表示行
        // --------------------------

        const playerRow =
          document.createElement(
            "tr"
          );


        playerRow.style.display =
          "none";


        const playerCell =
          document.createElement(
            "td"
          );


        playerCell.colSpan =
          3;


        // 使用者一覧の箱
        const playerBox =
          document.createElement(
            "div"
          );


        playerBox.style.padding =
          "10px 20px";


        // タイトル
        const title =
          document.createElement(
            "strong"
          );


        title.textContent =
          deck.deckName +
          " 使用者";


        playerBox.appendChild(
          title
        );


        // --------------------------
        // 使用者テーブル
        // --------------------------

        const playerTable =
          document.createElement(
            "table"
          );


        playerTable.style.marginTop =
          "10px";


        const thead =
          document.createElement(
            "thead"
          );


        const headerRow =
          document.createElement(
            "tr"
          );


        const idHeader =
          document.createElement(
            "th"
          );


        idHeader.textContent =
          "DMP ID";


        const nameHeader =
          document.createElement(
            "th"
          );


        nameHeader.textContent =
          "ハンドルネーム";


        headerRow.appendChild(
          idHeader
        );

        headerRow.appendChild(
          nameHeader
        );


        thead.appendChild(
          headerRow
        );


        playerTable.appendChild(
          thead
        );


        const tbody =
          document.createElement(
            "tbody"
          );


        deck.players.forEach(
  (player) => {

    const userRow =
      document.createElement(
        "tr"
      );


    // --------------------------
    // クリックできるようにする
    // --------------------------

    userRow.style.cursor =
      "pointer";

    userRow.title =
      "クリックしてプレイヤー詳細を表示";


    // --------------------------
    // DMP ID
    // --------------------------

    const idCell =
      document.createElement(
        "td"
      );


    idCell.textContent =
      player.dmpId;


    // --------------------------
    // ハンドルネーム
    // --------------------------

    const handleCell =
      document.createElement(
        "td"
      );


    handleCell.textContent =
      player.handleName;


    // --------------------------
    // 個人ページへ移動
    // --------------------------

    userRow.addEventListener(
      "click",
      (event) => {

        event.stopPropagation();

        openPlayerDetail(
          player.dmpId
        );
      }
    );


    userRow.appendChild(
      idCell
    );

    userRow.appendChild(
      handleCell
    );


    tbody.appendChild(
      userRow
    );
  }
);


        playerTable.appendChild(
          tbody
        );


        playerBox.appendChild(
          playerTable
        );


        playerCell.appendChild(
          playerBox
        );


        playerRow.appendChild(
          playerCell
        );


        list.appendChild(
          playerRow
        );


        // --------------------------
        // 開閉処理
        // --------------------------

        let isOpen =
          false;


        row.addEventListener(
          "click",
          () => {

            isOpen =
              !isOpen;


            if (isOpen) {

              playerRow.style.display =
                "table-row";


              nameCell.textContent =
                "▼ " +
                deck.deckName;


            } else {

              playerRow.style.display =
                "none";


              nameCell.textContent =
                "▶ " +
                deck.deckName;
            }
          }
        );
      }
    );


    // ====================================
    // デッキ未入力
    // ====================================

    if (
      data.unregisteredCount > 0
    ) {

      const row =
        document.createElement(
          "tr"
        );


      const nameCell =
        document.createElement(
          "td"
        );


      nameCell.textContent =
        "デッキ未入力";


      const countCell =
        document.createElement(
          "td"
        );


      countCell.textContent =
        data.unregisteredCount +
        "人";


      const percentageCell =
        document.createElement(
          "td"
        );


      const percentage =
        data.participantCount > 0
          ? (
              data.unregisteredCount /
              data.participantCount *
              100
            ).toFixed(1)
          : "0.0";


      percentageCell.textContent =
        percentage +
        "%";


      row.appendChild(
        nameCell
      );

      row.appendChild(
        countCell
      );

      row.appendChild(
        percentageCell
      );


      list.appendChild(
        row
      );
    }


    // ====================================
    // データなし
    // ====================================

    if (
      data.decks.length === 0 &&
      data.unregisteredCount === 0
    ) {

      const row =
        document.createElement(
          "tr"
        );


      const cell =
        document.createElement(
          "td"
        );


      cell.colSpan =
        3;


      cell.textContent =
        "デッキデータはありません。";


      row.appendChild(
        cell
      );


      list.appendChild(
        row
      );
    }


  } catch (error) {

    console.error(
      error
    );


    summary.textContent =
      "デッキ母数を取得できませんでした。";


    alert(
      "デッキ母数を取得できませんでした。\n" +
      error.message
    );
  }
}


// ========================================
// 大会一覧へ戻る
// ========================================

backEventsButton.addEventListener(
  "click",
  () => {

    pageParticipants.style.display =
      "none";

    pageResults.style.display =
      "none";

    pageEventDetail.style.display =
      "none";

    pageEvents.style.display =
      "block";


    menuParticipants.classList.remove(
      "active"
    );

    menuResults.classList.remove(
      "active"
    );

    menuEvents.classList.add(
      "active"
    );
  }
);

// ========================================
// プレイヤー検索
// ========================================

const playerSearchButton =
  document.getElementById(
    "player-search-button"
  );

const playerSearchInput =
  document.getElementById(
    "player-search-input"
  );


async function searchPlayers() {

  const query =
    playerSearchInput.value.trim();

  if (!query) {
    alert(
      "DMP IDまたはハンドルネームを入力してください。"
    );

    return;
  }


  const list =
    document.getElementById(
      "player-search-list"
    );

  const count =
    document.getElementById(
      "player-search-count"
    );


  list.innerHTML =
    `
      <tr>
        <td colspan="2">
          検索中...
        </td>
      </tr>
    `;


  try {

    const response =
      await fetch(
        "/api/player-search?q=" +
        encodeURIComponent(query)
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.detail ||
        data.error ||
        "プレイヤーを検索できませんでした。"
      );
    }


    list.innerHTML =
      "";


    count.textContent =
      "検索結果：" +
      data.count +
      "人";


    if (
      !data.players ||
      data.players.length === 0
    ) {

      list.innerHTML =
        `
          <tr>
            <td colspan="2">
              該当するプレイヤーが見つかりませんでした。
            </td>
          </tr>
        `;

      return;
    }


    data.players.forEach(
      (player) => {

        const row =
          document.createElement(
            "tr"
          );


        row.style.cursor =
          "pointer";

        row.title =
          "クリックしてプレイヤー詳細を表示";


        const idCell =
          document.createElement(
            "td"
          );

        idCell.textContent =
          player.dmp_id;


        const nameCell =
          document.createElement(
            "td"
          );

        nameCell.textContent =
          player.handle_name;


        row.appendChild(
          idCell
        );

        row.appendChild(
          nameCell
        );


        row.addEventListener(
          "click",
          () => {

            openPlayerDetail(
              player.dmp_id
            );
          }
        );


        list.appendChild(
          row
        );
      }
    );


  } catch (error) {

    console.error(
      error
    );


    list.innerHTML =
      `
        <tr>
          <td colspan="2">
            検索に失敗しました。
          </td>
        </tr>
      `;


    alert(
      "プレイヤーを検索できませんでした。\n" +
      error.message
    );
  }
}


// ========================================
// 検索ボタン
// ========================================

playerSearchButton.addEventListener(
  "click",
  async () => {

    await searchPlayers();
  }
);


// ========================================
// Enterキーでも検索
// ========================================

playerSearchInput.addEventListener(
  "keydown",
  async (event) => {

    if (event.key === "Enter") {

      await searchPlayers();
    }
  }
);

// ========================================
// プレイヤー詳細表示
// ========================================

async function openPlayerDetail(
  dmpId
) {

  try {

    const response =
      await fetch(
        "/api/player-detail?dmpId=" +
        encodeURIComponent(dmpId)
      );


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.detail ||
        data.error ||
        "プレイヤー情報を取得できませんでした。"
      );
    }


    // --------------------------
    // ページ切り替え
    // --------------------------

    hideAllPages();
    clearActiveMenus();

    pagePlayerDetail.style.display =
      "block";

    menuPlayers.classList.add(
      "active"
    );


    // --------------------------
    // プレイヤー情報
    // --------------------------

    document.getElementById(
      "player-detail-name"
    ).textContent =
      data.player.handleName;


    document.getElementById(
      "player-detail-id"
    ).textContent =
      "DMP ID：" +
      data.player.dmpId;


    // --------------------------
    // 使用デッキ集計
    // --------------------------

    const deckList =
      document.getElementById(
        "player-deck-summary"
      );


    deckList.innerHTML =
      "";


    if (
      !data.deckSummary ||
      data.deckSummary.length === 0
    ) {

      deckList.innerHTML =
        `
          <tr>
            <td colspan="2">
              使用デッキの記録がありません。
            </td>
          </tr>
        `;

    } else {

      data.deckSummary.forEach(
        (deck) => {

          const row =
            document.createElement(
              "tr"
            );


          const deckCell =
            document.createElement(
              "td"
            );

          deckCell.textContent =
            deck.deckName;


          const countCell =
            document.createElement(
              "td"
            );

          countCell.textContent =
            deck.count + "回";


          row.appendChild(
            deckCell
          );

          row.appendChild(
            countCell
          );


          deckList.appendChild(
            row
          );
        }
      );
    }


    // --------------------------
    // 大会履歴
    // --------------------------

    const historyList =
      document.getElementById(
        "player-history-list"
      );


    const historyCount =
      document.getElementById(
        "player-history-count"
      );


    historyList.innerHTML =
      "";


    historyCount.textContent =
      "登録済み大会：" +
      data.historyCount +
      "件";


    if (
      !data.history ||
      data.history.length === 0
    ) {

      historyList.innerHTML =
        `
          <tr>
            <td colspan="3">
              大会履歴がありません。
            </td>
          </tr>
        `;

    } else {

      data.history.forEach(
        (history) => {

          const row =
            document.createElement(
              "tr"
            );


          // 開催日
          const dateCell =
            document.createElement(
              "td"
            );


          if (history.eventDate) {

            const date =
              new Date(
                history.eventDate
              );


            dateCell.textContent =
              date.toLocaleDateString(
                "ja-JP"
              );

          } else {

            dateCell.textContent =
              "-";
          }


          // 大会名
          const eventCell =
            document.createElement(
              "td"
            );

          eventCell.textContent =
            history.eventName ||
            "大会名未登録";


          // 使用デッキ
          const deckCell =
            document.createElement(
              "td"
            );

          deckCell.textContent =
            history.deckName;


          row.appendChild(
            dateCell
          );

          row.appendChild(
            eventCell
          );

          row.appendChild(
            deckCell
          );


          historyList.appendChild(
            row
          );
        }
      );
    }


  } catch (error) {

    console.error(
      error
    );


    alert(
      "プレイヤー情報を取得できませんでした。\n" +
      error.message
    );
  }
}


// ========================================
// プレイヤー検索へ戻る
// ========================================

const backPlayersButton =
  document.getElementById(
    "back-players"
  );


backPlayersButton.addEventListener(
  "click",
  () => {

    hideAllPages();
    clearActiveMenus();

    pagePlayers.style.display =
      "block";

    menuPlayers.classList.add(
      "active"
    );
  }
);

// ========================================
// デッキ一覧を読み込む
// ========================================

async function loadDecks() {
  try {
    const response =
      await fetch(
        "/api/decks"
      );

    const data =
      await response.json();


    if (!response.ok) {
      throw new Error(
        data.detail ||
        data.error ||
        "デッキ一覧を取得できませんでした。"
      );
    }


    const deckCount =
      document.getElementById(
        "deck-count"
      );

    const deckList =
      document.getElementById(
        "deck-management-list"
      );


    deckCount.textContent =
      "登録数：" +
      data.decks.length;


    deckList.innerHTML = "";


    // デッキがまだない場合
    if (
      !data.decks ||
      data.decks.length === 0
    ) {
      deckList.innerHTML =
        `
          <p>
            登録されているデッキはありません。
          </p>
        `;

      return;
    }


    // ====================================
    // デッキごとに表示
    // ====================================

    data.decks.forEach(
      (deck) => {

        const deckBox =
          document.createElement(
            "div"
          );


        deckBox.style.padding =
          "15px";

        deckBox.style.marginBottom =
          "15px";

        deckBox.style.border =
          "1px solid #ddd";

        deckBox.style.borderRadius =
          "8px";


        // --------------------------
        // 正式名称
        // --------------------------

        const name =
          document.createElement(
            "h3"
          );

        name.textContent =
          deck.name;

        name.style.marginTop =
          "0";

          // --------------------------
// 正式名称編集
// --------------------------

const editArea =
  document.createElement(
    "div"
  );

editArea.className =
  "input-area";

editArea.style.marginBottom =
  "10px";


const editInput =
  document.createElement(
    "input"
  );

editInput.type =
  "text";

editInput.value =
  deck.name;

editInput.placeholder =
  "正式デッキ名";


const editButton =
  document.createElement(
    "button"
  );

editButton.textContent =
  "名前を編集";


editButton.addEventListener(
  "click",
  async () => {

    const newName =
      editInput.value.trim();


    if (!newName) {
      alert(
        "デッキ名を入力してください。"
      );

      return;
    }


    if (newName === deck.name) {
      alert(
        "デッキ名が変更されていません。"
      );

      return;
    }


    try {

      const response =
        await fetch(
          "/api/decks/" +
          deck.id,
          {
            method: "PUT",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                name: newName
              })
          }
        );


      const result =
        await response.json();


      if (!response.ok) {
        throw new Error(
          result.detail ||
          result.error ||
          "デッキ名を編集できませんでした。"
        );
      }


      await loadDecks();


    } catch (error) {

      console.error(
        error
      );

      alert(
        "デッキ名を編集できませんでした。\n" +
        error.message
      );
    }
  }
);


editArea.appendChild(
  editInput
);

editArea.appendChild(
  editButton
);

        // --------------------------
        // 別名表示
        // --------------------------

        const aliasText =
          document.createElement(
            "p"
          );


        if (
          deck.aliases &&
          deck.aliases.length > 0
        ) {
          aliasText.textContent =
            "別名：" +
            deck.aliases.join(
              " / "
            );
        } else {
          aliasText.textContent =
            "別名：なし";
        }


        // --------------------------
        // 別名入力欄
        // --------------------------

        const aliasArea =
          document.createElement(
            "div"
          );

        aliasArea.className =
          "input-area";


        const aliasInput =
          document.createElement(
            "input"
          );

        aliasInput.type =
          "text";

        aliasInput.placeholder =
          "別名を入力";


        const aliasButton =
          document.createElement(
            "button"
          );

        aliasButton.textContent =
          "別名を追加";


        // --------------------------
        // 別名追加
        // --------------------------

        aliasButton.addEventListener(
          "click",
          async () => {

            const alias =
              aliasInput.value.trim();


            if (!alias) {
              alert(
                "別名を入力してください。"
              );

              return;
            }


            try {
              const response =
                await fetch(
                  "/api/deck-aliases",
                  {
                    method: "POST",

                    headers: {
                      "Content-Type":
                        "application/json"
                    },

                    body:
                      JSON.stringify({
                        deckId:
                          deck.id,

                        alias:
                          alias
                      })
                  }
                );


              const result =
                await response.json();


              if (!response.ok) {
                throw new Error(
                  result.detail ||
                  result.error ||
                  "別名を追加できませんでした。"
                );
              }


              aliasInput.value =
                "";


              await loadDecks();


            } catch (error) {
              console.error(
                error
              );

              alert(
                "別名を追加できませんでした。\n" +
                error.message
              );
            }
          }
        );


        aliasArea.appendChild(
          aliasInput
        );

        aliasArea.appendChild(
          aliasButton
        );


        deckBox.appendChild(name);
        deckBox.appendChild(editArea);
        deckBox.appendChild(aliasText);
        deckBox.appendChild(aliasArea);

        const mergeArea = document.createElement("div");
        mergeArea.className = "deck-merge-area";
        const mergeLabel = document.createElement("label");
        mergeLabel.textContent = "「" + deck.name + "」の統合先";
        const mergeSelect = document.createElement("select");
        mergeSelect.id = "merge-target-" + deck.id;
        mergeLabel.htmlFor = mergeSelect.id;
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "統合先を選択してください";
        mergeSelect.appendChild(placeholder);
        data.decks.filter(candidate => candidate.id !== deck.id)
          .sort((a, b) => b.usage_count - a.usage_count).forEach(candidate => {
          const option = document.createElement("option");
          option.value = String(candidate.id);
          option.textContent = candidate.name;
          mergeSelect.appendChild(option);
        });
        const mergeButton = document.createElement("button");
        mergeButton.textContent = "このデッキを統合";
        mergeButton.disabled = true;
        mergeSelect.addEventListener("change", () => {
          mergeButton.disabled = !mergeSelect.value;
        });
        mergeButton.addEventListener("click", async () => {
          const target = data.decks.find(candidate => String(candidate.id) === mergeSelect.value);
          if (!target || mergeButton.disabled) return;
          if (!confirm(
            "統合元：「" + deck.name + "」\n統合先：「" + target.name + "」\n\n" +
            "使用履歴と別名を統合先へ移し、統合元のデッキを削除します。\n" +
            "この操作は元に戻せません。統合しますか？"
          )) return;
          mergeButton.disabled = true;
          mergeSelect.disabled = true;
          mergeButton.textContent = "統合中...";
          try {
            const response = await fetch("/api/decks/" + deck.id + "/merge", {
              method: "POST",
              headers: {"Content-Type": "application/json"},
              body: JSON.stringify({targetDeckId: target.id})
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "デッキを統合できませんでした。");
            alert("統合しました。\n履歴更新：" + result.updatedHistoryCount +
              "件\n別名移動：" + result.movedAliasCount + "件");
            await loadDecks();
          } catch (error) {
            alert("デッキ統合に失敗しました。\n" + error.message);
          } finally {
            mergeButton.disabled = !mergeSelect.value;
            mergeSelect.disabled = false;
            mergeButton.textContent = "このデッキを統合";
          }
        });
        mergeArea.appendChild(mergeLabel);
        mergeArea.appendChild(mergeSelect);
        mergeArea.appendChild(mergeButton);
        deckBox.appendChild(mergeArea);


        deckList.appendChild(
          deckBox
        );
      }
    );


  } catch (error) {
    console.error(
      error
    );

    alert(
      "デッキ一覧を取得できませんでした。\n" +
      error.message
    );
  }
}

// ========================================
// 正式デッキ名を追加
// ========================================

const deckNameInput =
  document.getElementById(
    "deck-name-input"
  );

const deckAddButton =
  document.getElementById(
    "deck-add-button"
  );


async function addDeck() {
  const name =
    deckNameInput.value.trim();


  if (!name) {
    alert(
      "デッキ名を入力してください。"
    );

    return;
  }


  try {
    const response =
      await fetch(
        "/api/decks",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              name: name
            })
        }
      );


    const data =
      await response.json();


    if (!response.ok) {
      throw new Error(
        data.detail ||
        data.error ||
        "デッキを追加できませんでした。"
      );
    }


    // 入力欄を空にする
    deckNameInput.value =
      "";


    // 一覧を更新
    await loadDecks();


  } catch (error) {
    console.error(
      error
    );

    alert(
      "デッキを追加できませんでした。\n" +
      error.message
    );
  }
}


// 追加ボタン
deckAddButton.addEventListener(
  "click",
  addDeck
);


// Enterキーでも追加
deckNameInput.addEventListener(
  "keydown",
  (event) => {

    if (event.key === "Enter") {
      addDeck();
    }
  }
);
