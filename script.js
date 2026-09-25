console.log("新しいscript.jsが読み込まれています");

const button = document.getElementById("get-event");

button.addEventListener("click", async () => {
  const input = document.getElementById("event-url").value.trim();

  try {
    const url = new URL(input);

    const shopId = url.searchParams.get("ShopID");
    const eventId = url.searchParams.get("EventID");
    const seq = url.searchParams.get("Seq");

    console.log("ShopID:", shopId);
    console.log("EventID:", eventId);
    console.log("Seq:", seq);

    if (!shopId || !eventId || !seq) {
      alert("ShopID、EventID、またはSeqを取得できませんでした。");
      return;
    }

    document.getElementById("shop-id").textContent = shopId;
    document.getElementById("event-id").textContent = eventId;
    document.getElementById("seq").textContent = seq;

    const participantUrl =
      `https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList` +
      `?shop=${shopId}&event=${eventId}&held=${seq}&official=false`;

    const link = document.getElementById("participant-url");

    link.href = participantUrl;
    link.textContent = participantUrl;

    const response = await fetch("/api/participants", {
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

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "参加者データを取得できませんでした。"
      );
    }

    const list = document.getElementById("participant-list");
    list.innerHTML = "";

    data.participants.forEach((participant) => {
      const row = document.createElement("tr");

      // ID
      const idCell = document.createElement("td");
      idCell.textContent = participant.id;

      // ハンドルネーム
      const nameCell = document.createElement("td");
      nameCell.textContent = participant.name;

      // デッキ入力
      const deckCell = document.createElement("td");

      const deckInput = document.createElement("input");
      deckInput.type = "text";
      deckInput.className = "deck-input";
      deckInput.placeholder = "デッキ名を入力";

      deckCell.appendChild(deckInput);

      // 保存
      const saveCell = document.createElement("td");

      const saveButton = document.createElement("button");
      saveButton.textContent = "保存";

      saveButton.addEventListener("click", async () => {
        const deckName = deckInput.value.trim();

        if (!deckName) {
          alert("デッキ名を入力してください。");
          return;
        }

        saveButton.disabled = true;
        saveButton.textContent = "保存中...";

        try {
          const saveResponse = await fetch("/api/deck-history", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              dmpId: participant.id,
              eventId: eventId,
              eventDate: new Date().toISOString().split("T")[0],
              deckName: deckName
            })
          });

          const saveData = await saveResponse.json();

          if (!saveResponse.ok) {
            throw new Error(
              saveData.error || "デッキを保存できませんでした。"
            );
          }

          saveButton.textContent = "保存済み";

          alert(
            `${participant.name} のデッキを保存しました。\n\n${deckName}`
          );

        } catch (error) {
          console.error(error);

          alert(
            "デッキを保存できませんでした。\n" +
            error.message
          );

          saveButton.disabled = false;
          saveButton.textContent = "保存";
        }
      });

      saveCell.appendChild(saveButton);

      row.appendChild(idCell);
      row.appendChild(nameCell);
      row.appendChild(deckCell);
      row.appendChild(saveCell);

      list.appendChild(row);
    });

    document.getElementById("participant-count").textContent =
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
// リセットボタン
// ==============================

const resetButton = document.getElementById("reset");

resetButton.addEventListener("click", () => {
  document.getElementById("event-url").value = "";

  document.getElementById("shop-id").textContent = "-";
  document.getElementById("event-id").textContent = "-";
  document.getElementById("seq").textContent = "-";

  const participantUrl =
    document.getElementById("participant-url");

  participantUrl.href = "#";
  participantUrl.textContent = "-";

  document.getElementById("participant-list").innerHTML = "";

  document.getElementById("participant-count").textContent =
    "取得件数：0人";
});