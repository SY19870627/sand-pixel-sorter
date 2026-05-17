const fs = require("fs/promises");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const LEVELS_DIR = path.join(ROOT_DIR, "levels");
const MANIFEST_PATH = path.join(LEVELS_DIR, "manifest.json");
const APP_URL = process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || "57512"}`;
const EXPECTED_SERVICE = "sand-pixel-sorter-dev-server";

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`回應不是 JSON：${text.slice(0, 120)}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const originalManifest = await fs.readFile(MANIFEST_PATH, "utf8");
  let uploadedSrc = "";

  try {
    const healthResponse = await fetch(`${APP_URL}/api/health`);
    assert(healthResponse.ok, `健康檢查失敗：HTTP ${healthResponse.status}`);
    const health = await readJson(healthResponse);
    assert(health.service === EXPECTED_SERVICE, `目前服務不是 ${EXPECTED_SERVICE}`);
    assert(health.capabilities?.includes("deleteLevels"), "目前服務不支援刪除圖片 API");

    const imageBody = await fs.readFile(path.join(LEVELS_DIR, "portrait.png"));
    const uploadResponse = await fetch(`${APP_URL}/api/levels`, {
      method: "POST",
      headers: {
        "content-type": "image/png",
        "x-file-name": encodeURIComponent("smoke-test.png"),
      },
      body: imageBody,
    });
    assert(uploadResponse.status === 201, `上傳失敗：HTTP ${uploadResponse.status}`);
    const uploadedItem = await readJson(uploadResponse);
    uploadedSrc = uploadedItem.src;

    const uploadedPath = path.join(LEVELS_DIR, uploadedSrc);
    assert(await fileExists(uploadedPath), "上傳後找不到測試圖片檔");

    const deleteResponse = await fetch(`${APP_URL}/api/levels/${encodeURIComponent(uploadedItem.id)}`, {
      method: "DELETE",
    });
    assert(deleteResponse.ok, `刪除失敗：HTTP ${deleteResponse.status}`);
    const deletePayload = await readJson(deleteResponse);
    assert(deletePayload.removedFile === true, "刪除 API 沒有回報已刪除實體檔");
    assert(!(await fileExists(uploadedPath)), "測試圖片檔仍然存在於 levels/uploads");

    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"));
    assert(!manifest.levels.some((item) => item.id === uploadedItem.id), "manifest 仍保留測試圖片");

    console.log("Smoke test passed: health, upload, delete, and file cleanup are aligned.");
  } finally {
    await fs.writeFile(MANIFEST_PATH, originalManifest, "utf8");
    if (uploadedSrc.startsWith("uploads/smoke-test-")) {
      const uploadedPath = path.join(LEVELS_DIR, uploadedSrc);
      if (await fileExists(uploadedPath)) {
        await fs.unlink(uploadedPath);
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
