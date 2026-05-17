# 本機測試流程

這個專案需要用同一個本機 HTTP 服務測試，避免 Codex 的臨時測試服務和使用者手動開的服務互相打架。

## 唯一標準服務

正式本機測試只使用：

```powershell
npm start
```

預設網址：

```text
http://127.0.0.1:57512/index.html
```

健康檢查：

```text
http://127.0.0.1:57512/api/health
```

回傳的 `service` 必須是：

```text
sand-pixel-sorter-dev-server
```

如果不是這個服務，圖庫上傳、刪除、保存都不能視為有效測試。

## 對齊規則

- `57512` 保留給使用者手動啟動的 `npm start` / `node server.js`。
- Codex 不再用臨時測試服務占用 `57512`。
- Codex 驗證使用者看到的問題時，先檢查 `/api/health`。
- 如果 Codex 必須開隔離測試服務，只能使用其他 port，例如 `57514`，並在測試後關閉。
- 圖庫刪除功能必須用 HTTP 服務測試，不能用 `file://` 測。

## 快速驗證

先啟動服務：

```powershell
npm start
```

另開一個 PowerShell 執行：

```powershell
npm run smoke
```

這個測試會檢查：

- 目前連到的是正確的 `server.js`
- `/api/health` 正常
- 上傳圖片會寫入 `levels/uploads`
- 刪除圖片會移除 `levels/uploads` 的實體檔
- `levels/manifest.json` 會同步更新

測試會建立一張臨時圖片，最後會清掉它並還原 manifest。

## Port 被占用時

查占用：

```powershell
netstat -ano | findstr :57512
```

關掉 LISTENING 的 PID：

```powershell
taskkill /PID <PID> /F
```

或改用其他 port：

```powershell
$env:PORT=57513
npm start
```

再用對應網址開啟：

```text
http://127.0.0.1:57513/index.html
```
