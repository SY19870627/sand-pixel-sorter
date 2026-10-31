// ============================================================
// 「關於」對話框（about.js）
// - 桌機從標題下方、手機從「更多」選單開啟
// - 使用原生 <dialog>，關閉時不影響遊戲操作
// ============================================================
(() => {
  const dialog = document.getElementById("aboutDialog");
  if (!dialog) return;

  function openAbout() {
    if (dialog.open) return;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeAbout() {
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  document.querySelectorAll("[data-about-open]").forEach((button) => {
    button.addEventListener("click", openAbout);
  });

  dialog.querySelectorAll("[data-about-close]").forEach((button) => {
    button.addEventListener("click", closeAbout);
  });

  // 點對話框外的半透明背景也可以關閉
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeAbout();
  });
})();
