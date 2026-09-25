console.log("新しいscript.jsが読み込まれています");

// ==============================
// メニュー切り替え
// ==============================

const menuParticipants =
  document.getElementById("menu-participants");

const menuResults =
  document.getElementById("menu-results");

const pageParticipants =
  document.getElementById("page-participants");

const pageResults =
  document.getElementById("page-results");


menuParticipants.addEventListener("click", () => {
  pageParticipants.style.display = "block";
  pageResults.style.display = "none";

  menuParticipants.classList.add("active");
  menuResults.classList.remove("active");
});


menuResults.addEventListener("click", () => {
  pageParticipants.style.display = "none";
  pageResults.style.display = "block";

  menuParticipants.classList.remove("active");
  menuResults.classList.add("active");
});


// ==============================
// 参加表明者取得
// ==============================

const button =
  document.getElementById("get-event");


button.addEventListener("click", async () => {

  const input =
    document.getElementById("event-url").value.trim();


  try {

    const url = new URL(input);

    const shopId =
      url.searchParams.get("ShopID");

    const eventId =
      url.searchParams.get("EventID");

    const seq =
      url.searchParams.get("Seq");


    if (!shopId || !eventId || !seq) {

      alert(
        "ShopID、EventID、またはSeqを取得できませんでした。"
      );

      return;
    }


    document.getElementById(
      "shop-id"
    ).textContent = shopId;

    document.getElementById(
      "event-id"
    ).textContent = eventId;

    document.getElementById(
      "seq"
    ).textContent = seq;


    const participantUrl =
      `https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList` +
      `?shop=${shopId}&event=${eventId}&held=${seq}&official=false`;


    const link =
      document.getElementById("participant-url");

    link.href = participantUrl;
    link.textContent = participantUrl;


    // ==============================
    // 参加者取得
    // ==============================

    const response =
      await fetch("/api/participants", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          shopId,
          eventId,
          seq
        })
      });


    const data =
      await response.json();


    if (!response.ok) {

      throw new Error(
        data.error ||
        "参加者データを取得できませんでした。"
      );

    }


    // ==============================
    // 保存済みデッキ取得
    // ==============================

    const deckResponse =
      await fetch(
        `/api/deck-history?eventId=${encodeURIComponent(eventId)}`
      );


    const deckData =
      await deckResponse.json();


    if (!deckResponse.ok) {

      throw new Error(
        deckData.error ||
        "保存済みデッキを取得できませんでした。"
      );

    }


    const savedDecks = {};


    deckData.decks.forEach((deck) => {

      if (!savedDecks[String(deck.dmp_id)]) {

        savedDecks[String(deck.dmp_id)] =
          deck.deck_name;

      }

    });


    // ==============================
    // 参加者一覧表示
    // ==============================

    const list =
      document.getElementById(
        "participant-list"
      );

    list.innerHTML = "";


    data.participants.forEach((participant) => {

      const row =
        document.createElement("tr");


      const idCell =
        document.createElement("td");

      idCell.textContent =
        participant.id;


      const nameCell =
        document.createElement("td");

      nameCell.textContent =
        participant.name;


      const deckCell =
        document.createElement("td");


      const savedDeck =
        savedDecks[String(participant.id)];


      deckCell.textContent =
        savedDeck || "履歴なし";


      row.appendChild(idCell);
      row.appendChild(nameCell);
      row.appendChild(deckCell);


      list.appendChild(row);

    });


    document.getElementById(
      "participant-count"
    ).textContent =
      `取得件数：${data.count}人`;


  } catch (error) {

    console.error(error);

    alert(
      "参加者ページを取得できませんでした。\n" +
      error.message
    );

  }

});


// ==============================
// 参加表明リセット
// ==============================

const resetButton =
  document.getElementById("reset");


resetButton.addEventListener("click", () => {

  document.getElementById(
    "event-url"
  ).value = "";

  document.getElementById(
    "shop-id"
  ).textContent = "-";

  document.getElementById(
    "event-id"
  ).textContent = "-";

  document.getElementById(
    "seq"
  ).textContent = "-";


  const participantUrl =
    document.getElementById(
      "participant-url"
    );

  participantUrl.href = "#";
  participantUrl.textContent = "-";


  document.getElementById(
    "participant-list"
  ).innerHTML = "";


  document.getElementById(
    "participant-count"
  ).textContent =
    "取得件数：0人";

});


// ==============================
// 大会結果取得
// ==============================

const resultButton =
  document.getElementById("get-result");


resultButton.addEventListener(
  "click",
  async () => {

    const input =
      document.getElementById(
        "result-url"
      ).value.trim();


    if (!input) {

      alert(
        "大会結果URLを入力してください。"
      );

      return;
    }


    try {

      const url =
        new URL(input);


      const year =
        url.searchParams.get("year");

      const shopId =
        url.searchParams.get("shop");

      const eventId =
        url.searchParams.get("event");

      const held =
        url.searchParams.get("held");


      if (
        !year ||
        !shopId ||
        !eventId ||
        !held
      ) {

        alert(
          "大会結果URLから必要な情報を取得できませんでした。"
        );

        return;
      }


      // ==============================
      // イベント情報表示
      // ==============================

      document.getElementById(
        "result-year"
      ).textContent = year;

      document.getElementById(
        "result-shop-id"
      ).textContent = shopId;

      document.getElementById(
        "result-event-id"
      ).textContent = eventId;

      document.getElementById(
        "result-held"
      ).textContent = held;


      // ==============================
      // 大会結果取得
      // ==============================

      resultButton.disabled = true;
      resultButton.textContent =
        "取得中...";


      const response =
        await fetch(
          "/api/event-result",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              year,
              shopId,
              eventId,
              held
            })
          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        throw new Error(
          data.error ||
          "大会結果を取得できませんでした。"
        );

      }


      console.log(
        "大会結果:",
        data
      );


      // ==============================
      // 結果一覧表示
      // ==============================

      const list =
        document.getElementById(
          "result-list"
        );

      list.innerHTML = "";


      data.participants.forEach(
        (participant) => {

          const row =
            document.createElement("tr");


          // 順位
          const rankCell =
            document.createElement("td");

          rankCell.textContent =
            participant.rank ?? "-";


          // ID
          const idCell =
            document.createElement("td");

          idCell.textContent =
            participant.id ?? "-";


          // 名前
          const nameCell =
            document.createElement("td");

          nameCell.textContent =
            participant.name ?? "-";


          // デッキ入力
          const deckCell =
            document.createElement("td");

          const deckInput =
            document.createElement("input");

          deckInput.type = "text";
          deckInput.className =
            "deck-input";

          deckInput.placeholder =
            "デッキ名を入力";


          deckCell.appendChild(
            deckInput
          );


          // 保存
          const saveCell =
            document.createElement("td");

          const saveButton =
            document.createElement("button");

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


              saveButton.disabled = true;

              saveButton.textContent =
                "保存中...";


              try {

                const saveResponse =
                  await fetch(
                    "/api/deck-history",
                    {
                      method: "POST",
                      headers: {
                        "Content-Type":
                          "application/json"
                      },
                      body: JSON.stringify({
                        dmpId:
                          participant.id,

                        eventId:
                          eventId,

                        eventDate:
                          `${year}-01-01`,

                        deckName:
                          deckName
                      })
                    }
                  );


                const saveData =
                  await saveResponse.json();


                if (!saveResponse.ok) {

                  throw new Error(
                    saveData.error ||
                    "デッキを保存できませんでした。"
                  );

                }


                saveButton.textContent =
                  "保存済み";


                alert(
                  `${participant.name} のデッキを保存しました。\n\n${deckName}`
                );


              } catch (error) {

                console.error(error);

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
        `取得件数：${data.count}人`;


      alert(
        `大会結果を取得しました。\n${data.count}人`
      );


    } catch (error) {

      console.error(error);

      alert(
        "大会結果を取得できませんでした。\n" +
        error.message
      );

    } finally {

      resultButton.disabled = false;

      resultButton.textContent =
        "大会結果を取得";

    }

  }
);


// ==============================
// 大会結果リセット
// ==============================

const resultResetButton =
  document.getElementById(
    "result-reset"
  );


resultResetButton.addEventListener(
  "click",
  () => {

    document.getElementById(
      "result-url"
    ).value = "";

    document.getElementById(
      "result-year"
    ).textContent = "-";

    document.getElementById(
      "result-shop-id"
    ).textContent = "-";

    document.getElementById(
      "result-event-id"
    ).textContent = "-";

    document.getElementById(
      "result-held"
    ).textContent = "-";

    document.getElementById(
      "result-list"
    ).innerHTML = "";

    document.getElementById(
      "result-count"
    ).textContent =
      "取得件数：0人";

  }
);

