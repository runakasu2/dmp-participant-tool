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


// ========================================
// メニュー切り替え
// ========================================

menuParticipants.addEventListener(
  "click",
  () => {

    pageParticipants.style.display =
      "block";

    pageResults.style.display =
      "none";

    pageEvents.style.display =
      "none";

    pageEventDetail.style.display =
      "none";


    menuParticipants.classList.add(
      "active"
    );

    menuResults.classList.remove(
      "active"
    );

    menuEvents.classList.remove(
      "active"
    );
  }
);


menuResults.addEventListener(
  "click",
  () => {

    pageParticipants.style.display =
      "none";

    pageResults.style.display =
      "block";

    pageEvents.style.display =
      "none";

    pageEventDetail.style.display =
      "none";


    menuParticipants.classList.remove(
      "active"
    );

    menuResults.classList.add(
      "active"
    );

    menuEvents.classList.remove(
      "active"
    );
  }
);


menuEvents.addEventListener(
  "click",
  async () => {

    pageParticipants.style.display =
      "none";

    pageResults.style.display =
      "none";

    pageEvents.style.display =
      "block";

    pageEventDetail.style.display =
      "none";


    menuParticipants.classList.remove(
      "active"
    );

    menuResults.classList.remove(
      "active"
    );

    menuEvents.classList.add(
      "active"
    );


    await loadEvents();
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
      // 保存済みデッキ取得
      // --------------------------

      const deckResponse =
        await fetch(
          "/api/deck-history" +
          "?shopId=" +
          encodeURIComponent(
            shopId
          ) +
          "&eventId=" +
          encodeURIComponent(
            eventId
          ) +
          "&seq=" +
          encodeURIComponent(
            seq
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
      // DMP IDごとに履歴整理
      // --------------------------

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
      // 参加者一覧表示
      // --------------------------

      const list =
        document.getElementById(
          "participant-list"
        );


      list.innerHTML =
        "";


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


          const savedDeck =
            savedDecks[
              String(
                participant.id
              )
            ];


          deckCell.textContent =
            savedDeck ||
            "履歴なし";


          row.appendChild(
            idCell
          );

          row.appendChild(
            nameCell
          );

          row.appendChild(
            deckCell
          );


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
        "人";


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


          const deckInput =
            document.createElement(
              "input"
            );


          deckInput.type =
            "text";

          deckInput.className =
            "deck-input";

          deckInput.placeholder =
            "デッキ名を入力";


          const savedDeck =
            savedDecks[
              String(
                participant.id
              )
            ];


          if (savedDeck) {

            deckInput.value =
              savedDeck;
          }


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

              const deckName =
                deckInput.value.trim();


              if (!deckName) {

                alert(
                  "デッキ名を入力してください。"
                );

                return;
              }


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

                          deckName:
                            deckName
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


                saveButton.textContent =
                  "保存済み";


                alert(
                  participant.name +
                  " のデッキを保存しました。\n\n" +
                  deckName +
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
              }
            }
          );


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


async function loadEvents() {

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
        <td colspan="6">
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
            <td colspan="6">
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

            openEventDetail(
              event
            );
          }
        );


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

    console.error(
      error
    );


    count.textContent =
      "保存大会数：-";


    list.innerHTML =
      `
        <tr>
          <td colspan="6">
            大会一覧を取得できませんでした。
          </td>
        </tr>
      `;


    alert(
      "大会一覧を取得できませんでした。\n" +
      error.message
    );
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


async function openEventDetail(
  event
) {

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


            const idCell =
              document.createElement(
                "td"
              );


            idCell.textContent =
              player.dmpId;


            const handleCell =
              document.createElement(
                "td"
              );


            handleCell.textContent =
              player.handleName;


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