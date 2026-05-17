const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const ROOT_DIR = __dirname;
const LEVELS_DIR = path.join(ROOT_DIR, "levels");
const UPLOADS_DIR = path.join(LEVELS_DIR, "uploads");
const MANIFEST_PATH = path.join(LEVELS_DIR, "manifest.json");
const PORT = Number.parseInt(process.env.PORT || "57512", 10);
const HOST = "127.0.0.1";
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function decodeHeaderValue(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return fallback;
  }
}

function safeBaseName(fileName) {
  const parsed = path.parse(fileName);
  const cleaned = parsed.name
    .normalize("NFKD")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return cleaned || "upload";
}

function extensionForUpload(fileName, contentType) {
  const ext = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    return ext;
  }

  if (contentType.includes("image/jpeg")) {
    return ".jpg";
  }
  if (contentType.includes("image/png")) {
    return ".png";
  }
  if (contentType.includes("image/webp")) {
    return ".webp";
  }
  if (contentType.includes("image/gif")) {
    return ".gif";
  }
  return "";
}

async function readRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_UPLOAD_BYTES) {
      throw new Error("UPLOAD_TOO_LARGE");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readManifest() {
  try {
    const text = await fs.readFile(MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(text);
    if (!Array.isArray(manifest.levels)) {
      manifest.levels = [];
    }
    return manifest;
  } catch (error) {
    if (error.code === "ENOENT") {
      return { levels: [] };
    }
    throw error;
  }
}

async function writeManifest(manifest) {
  await fs.writeFile(`${MANIFEST_PATH}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await fs.rename(`${MANIFEST_PATH}.tmp`, MANIFEST_PATH);
}

function levelIdFromUrl(requestUrl) {
  const parsedUrl = new URL(requestUrl, `http://${HOST}:${PORT}`);
  const match = parsedUrl.pathname.match(/^\/api\/levels\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function safeLevelFilePath(relativeSrc) {
  const normalizedSrc = path.normalize(String(relativeSrc || "")).replace(/^([/\\])+/, "");
  const filePath = path.join(LEVELS_DIR, normalizedSrc);
  const relativePath = path.relative(LEVELS_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return {
    filePath,
    relativePath: relativePath.replace(/\\/g, "/"),
  };
}

async function handleLevelUpload(request, response) {
  try {
    const encodedName = request.headers["x-file-name"];
    const originalName = decodeHeaderValue(encodedName, "upload.png");
    const contentType = request.headers["content-type"] || "application/octet-stream";
    const ext = extensionForUpload(originalName, contentType);
    if (ext === "") {
      sendJson(response, 415, { error: "只支援 png、jpg、webp、gif 圖片。" });
      return;
    }

    const body = await readRequestBody(request);
    if (body.length === 0) {
      sendJson(response, 400, { error: "沒有收到圖片資料。" });
      return;
    }

    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const id = `${safeBaseName(originalName)}-${Date.now()}`;
    const relativeSrc = `uploads/${id}${ext}`;
    const targetPath = path.join(LEVELS_DIR, relativeSrc);
    await fs.writeFile(targetPath, body);

    const manifest = await readManifest();
    const title = path.parse(originalName).name || "Upload";
    const item = { id, title, src: relativeSrc };
    manifest.levels.push(item);
    await writeManifest(manifest);
    sendJson(response, 201, item);
  } catch (error) {
    if (error.message === "UPLOAD_TOO_LARGE") {
      sendJson(response, 413, { error: "圖片太大，請使用 12MB 以下圖片。" });
      return;
    }
    sendJson(response, 500, { error: "圖片保存失敗。" });
  }
}

async function handleLevelDelete(request, response) {
  try {
    const levelId = levelIdFromUrl(request.url);
    if (!levelId) {
      sendJson(response, 404, { error: "找不到圖片。" });
      return;
    }

    const manifest = await readManifest();
    const levelIndex = manifest.levels.findIndex((level) => level.id === levelId);
    if (levelIndex === -1) {
      sendJson(response, 404, { error: "找不到圖片。" });
      return;
    }

    const [removedLevel] = manifest.levels.splice(levelIndex, 1);
    await writeManifest(manifest);

    const safePath = safeLevelFilePath(removedLevel.src);
    let removedFile = false;
    if (safePath?.relativePath.startsWith("uploads/")) {
      try {
        await fs.unlink(safePath.filePath);
        removedFile = true;
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }

    sendJson(response, 200, {
      id: removedLevel.id,
      removedFile,
    });
  } catch (_error) {
    sendJson(response, 500, { error: "圖片刪除失敗。" });
  }
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${HOST}:${PORT}`);
  const pathname = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const normalizedPath = path.normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = path.join(ROOT_DIR, normalizedPath);
  const relativePath = path.relative(ROOT_DIR, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(data);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500, {
      "content-type": "text/plain; charset=utf-8",
    });
    response.end(error.code === "ENOENT" ? "Not Found" : "Server Error");
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url?.startsWith("/api/levels")) {
    await handleLevelUpload(request, response);
    return;
  }

  if (request.method === "DELETE" && request.url?.startsWith("/api/levels/")) {
    await handleLevelDelete(request, response);
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    await serveStatic(request, response);
    return;
  }

  response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
  response.end("Method Not Allowed");
});

server.listen(PORT, HOST, () => {
  console.log(`Sand Pixel Sorter running at http://${HOST}:${PORT}/index.html`);
});
