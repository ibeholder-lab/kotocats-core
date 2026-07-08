document.querySelectorAll("[data-cat-donate]").forEach(function(root) {
  const amountButtons = root.querySelectorAll("[data-amount]");
  const donateButton = root.querySelector("[data-donate-button]");

  if (!donateButton) return;

  let currentAmount = 300;

  amountButtons.forEach(function(button) {
    button.addEventListener("click", function() {
      currentAmount = Number(button.dataset.amount) || 300;

      amountButtons.forEach(function(item) {
        item.classList.remove("is-active");
      });

      button.classList.add("is-active");
      donateButton.textContent = "Помочь на " + currentAmount + " ₽";
    });
  });

  donateButton.addEventListener("click", async function() {
    const defaultButtonText = donateButton.textContent;

    donateButton.disabled = true;
    donateButton.textContent = "Создаём платёж…";

    try {
      const response = await fetch("/api/donations/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          animal_id: root.dataset.catId,
          animal_name: root.dataset.catName,
          amount: currentAmount,
          payment_type: "donate",
          comment: "Донат кошке " + root.dataset.catName,
          success_url: root.dataset.successUrl,
          failure_url: root.dataset.failureUrl
        })
      });

      const result = await response.json();

      if (!result.ok || !result.redirect_url) {
        alert(result.message || "Не удалось создать платёж.");
        donateButton.disabled = false;
        donateButton.textContent = defaultButtonText;
        return;
      }

      window.location.href = result.redirect_url;
    } catch (err) {
      console.error(err);
      alert("Ошибка соединения.");
      donateButton.disabled = false;
      donateButton.textContent = defaultButtonText;
    }
  });
});
