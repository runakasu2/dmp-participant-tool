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

    // イベント情報を表示
    const shopElement = document.getElementById("shop-id");
    const eventElement = document.getElementById("event-id");

    if (!shopElement || !eventElement) {
      throw new Error("HTMLのイベント情報表示欄が見つかりません。");
    }

    shopElement.textContent = shopId;
    eventElement.textContent = eventId;

    // 参加者一覧ページのURL
    const participantUrl =
      `https://www.dmp-ranking.com/Deckbuild/Event/EventParticipantsList` +
      `?shop=${shopId}&event=${eventId}&held=${seq}&official=false`;

    const link = document.getElementById("participant-url");

    if (!link) {
      throw new Error("参加者一覧URLの表示欄が見つかりません。");
    }

    link.href = participantUrl;
    link.textContent = participantUrl;

    // サーバーに送信
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

    // 参加者一覧をクリア
    const list = document.getElementById("participant-list");

    if (!list) {
      throw new Error("参加者一覧の表示欄が見つかりません。");
    }

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
    const countElement =
      document.getElementById("participant-count");

    if (!countElement) {
      throw new Error("参加者件数の表示欄が見つかりません。");
    }

    countElement.textContent =
      `取得件数：${data.count}人`;

  } catch (error) {
    console.error(error);

    alert(
      "参加者ページを取得できませんでした。\n" +
      error.message
    );
  }
});