// ============================================================
// 手機與全螢幕輔助（mobile.js）
// - 全螢幕按鈕：支援 Fullscreen API 的瀏覽器才顯示（iPhone Safari 不支援，
//   改用「加入主畫面」以 manifest 的 fullscreen 模式開啟）
// - 「更多」選單：手機版把上傳圖片／色數收進選單
// ============================================================
(() => {
  const root = document.documentElement;
  const fullscreenButton = document.getElementById("fullscreenButton");
  const menuToggle = document.getElementById("menuToggle");
  const uploadControls = document.querySelector(".upload-controls");

  const canFullscreen = Boolean(
    root.requestFullscreen || root.webkitRequestFullscreen
  ) && (document.fullscreenEnabled || document.webkitFullscreenEnabled);

  const isStandalone =
    window.matchMedia?.("(display-mode: fullscreen)").matches
    || window.matchMedia?.("(display-mode: standalone)").matches
    || window.navigator.standalone === true;

  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;

  const EXPAND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>';
  const COLLAPSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /></svg>';

  function syncFullscreenButton() {
    if (!fullscreenButton) return;
    const active = Boolean(fullscreenElement());
    document.body.classList.toggle("is-fullscreen", active);
    fullscreenButton.innerHTML = active ? COLLAPSE_ICON : EXPAND_ICON;
    fullscreenButton.setAttribute("aria-label", active ? "離開全螢幕" : "全螢幕");
    fullscreenButton.title = active ? "離開全螢幕" : "全螢幕";
    // 版面尺寸改變後，請 Phaser 重新量一次容器
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 120);
  }

  async function toggleFullscreen() {
    try {
      if (fullscreenElement()) {
        await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        await (root.requestFullscreen || root.webkitRequestFullscreen).call(root, { navigationUI: "hide" });
      }
    } catch (_error) {
      // 使用者拒絕或瀏覽器不允許時，維持原狀即可
    }
  }

  if (fullscreenButton && canFullscreen && !isStandalone) {
    fullscreenButton.hidden = false;
    fullscreenButton.addEventListener("click", toggleFullscreen);
    document.addEventListener("fullscreenchange", syncFullscreenButton);
    document.addEventListener("webkitfullscreenchange", syncFullscreenButton);
  }

  function setMenuOpen(open) {
    document.body.classList.toggle("is-menu-open", open);
    menuToggle?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  menuToggle?.addEventListener("click", (event) => {
    event.stopPropagation();
    setMenuOpen(!document.body.classList.contains("is-menu-open"));
  });

  document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("is-menu-open")) return;
    if (uploadControls?.contains(event.target)) return;
    setMenuOpen(false);
  });

  // 選完圖片或色數就自動收起選單
  document.getElementById("imageUploadInput")?.addEventListener("change", () => setMenuOpen(false));
  document.getElementById("paletteSizeSelect")?.addEventListener("change", () => setMenuOpen(false));

  // iOS 上雙指縮放會打亂版面，遊戲中阻擋 gesture 縮放
  document.addEventListener("gesturestart", (event) => event.preventDefault());

  // 旋轉螢幕或網址列伸縮後，讓 Phaser 重新計算畫布大小
  window.addEventListener("orientationchange", () => {
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 250);
  });
})();
