console.log("新しいscript.jsが読み込まれています");

const button = document.getElementById("get-event");

button.addEventListener("click", async () => {
  const input = document.getElementById("event-url").value.trim();

  try {
    const url = new URL(input);

    const shopId = url.searchParams.get("ShopID");
    const eventId = url.searchParams.get("EventID");

    if (!shopId || !eventId) {
      alert("ShopIDまたはEventIDを取得できませんでした。");
      return;
    }

    // イベント情報を表示
    document.getElementById("shop-id").textContent = shopId;
    document.getElementById("event-id").textContent = eventId;

    // 参加者一覧ページのURLを作成
    const participantUrl =
      `https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList` +
      `?shop=${shopId}&event=${eventId}&held=1&official=false`;

    const link = document.getElementById("participant-url");

    link.href = participantUrl;
    link.textContent = participantUrl;

    // サーバーにShopIDとEventIDを送る
    const response = await fetch("/api/participants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        shopId,
        eventId
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "参加者データを取得できませんでした。"
      );
    }

    // 参加者一覧をクリア
    const list = document.getElementById("participant-list");
    list.innerHTML = "";

    // 参加者を表に追加
    data.participants.forEach((participant) => {
      const row = document.createElement("tr");

      const idCell = document.createElement("td");
      idCell.textContent = participant.id;

      const nameCell = document.createElement("td");
      nameCell.textContent = participant.name;

      row.appendChild(idCell);
      row.appendChild(nameCell);

      list.appendChild(row);
    });

    // 件数を表示
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