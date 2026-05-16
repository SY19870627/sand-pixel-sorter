# Sand Pixel Sorter Web Prototype

這是一個可在瀏覽器執行的 `Sand Pixel Sorter` 原型。

## 執行方式

直接用瀏覽器開啟：

```text
D:\Git\Idle Sand Sorting\index.html
```

目前 Web 版使用 `Phaser 3 + Bitmap Sand Engine` 負責 Canvas 場景、像素沙畫、吸入粒子與輸送帶顯示。核心規則仍保留在純 JavaScript 狀態模型中，方便之後接 AI 求解或關卡驗證。

目前沙子採用「Uint8Array Grid + ImageData」：

- 每顆沙是 bitmap 裡的 `1` 個 pixel，不是獨立 JS 物件或 Phaser circle。
- `colorGrid: Uint8Array` 保存沙子顏色，`0` 代表空格，`1..N` 代表顏色。
- 目前來源圖是程式產生的 `128x128` bitmap，只使用 6 種顏色。
- 畫面只顯示一張低解析度 CanvasTexture，並用 nearest-neighbor / `image-rendering: pixelated` 放大。
- 水桶只吸「該桶目前 X 軸正上方」底部可接觸的同色 pixel。
- 吸走一顆沙後，只把受影響區域加入 active queue，沙子依照下、左下、右下規則流動。
- 沙子邏輯已抽離為 `SandEngine`，可切換 `down / right / up / left` 重力方向。

## 原型規則

- 每個像素格是一個垂直堆疊。
- 上方顯示的是完整像素沙畫；目前沙畫解析度為 `128x128`，來源色盤限制為 6 色。
- 每格目前只有一層沙畫顏色；吸完後該格會直接變空，不會露出隨機填充色。
- 吸走一格後，同一欄上方的沙會往下掉補位。
- 水桶放入 5 格輸送帶後會自動吸同色底層。
- 玩家可以連續放桶；吸收迴圈會在背景持續處理所有啟動中的水桶。
- 多個水桶同時啟動時採用輪流吸收，每一輪每個桶最多吸 `1` 顆沙球。
- 吸收動畫已加速：每輪多桶可並行吸收，單顆吸入 Tween 約 `68ms`。
- 吸收採用串流判定：第一顆吸入動畫尚未結束時，約每 `8ms` 會重新判斷是否能接著吸下一顆。
- 輸送帶槽位會持續往右移動，超過最右側後循環回到最左側。
- 上方的輸送帶速度按鈕可在 `x1 / x2 / x3` 間切換。
- 上方的重力按鈕可切換沙流方向，用於測試旋轉畫框前的重力邏輯。
- 輸送帶左右兩側有最上層遮罩，隱藏桶子循環回到左側的瞬間位移。
- 放桶時會選擇畫面上 X 座標最左邊的空槽，而不是槽位編號最小的空槽。
- 右側介面已極簡化，只保留水桶按鈕。
- 本原型每吸 `1` 個 pixel 算 `1` 單位，水桶容量是 `100`。
- 水桶滿 `100/100` 後會消失並釋放槽位。
- 若 5 個槽位全滿，且沒有任何水桶顏色符合目前底層可吸顏色，判定死鎖。

## 下一階段架構計畫：SandEngine 抽離與可變重力

目標：將沙子模擬從 Phaser 場景中抽離，形成可測試、可擴充的 `SandEngine`。這個階段不追求完整 Noita 等級的材料系統，而是先讓旋轉畫框、重力方向變更與道具特效有穩定的架構入口。

設計原則：

- 沙子仍維持 `Uint8Array colorGrid`，每個 cell 是一顆沙或空格。
- Phaser 只負責顯示、輸入、Tween 與畫面特效。
- `SandEngine` 負責 grid、active cells、沙流規則、吸沙查詢與道具 command。
- 重力方向不能再寫死為 `cellY + 1`，需改成 `gravity = { x, y }`。
- 目前先維持 active cells，不立即導入 chunk dirty rect；但 API 要保留未來升級成 chunks 的空間。

任務清單：

- [x] 建立 `SandEngine` 類別，接管 `colorGrid`、`width`、`height`、`remainingTotal`。
- [x] 將 `SandField` 中的 grid 操作搬入 `SandEngine`，包含 `index`、`cellX`、`cellY`、`getIndex`、`clearIndex`、`moveIndex`。
- [x] 將 `activeCells`、`dirtyCells` 與沙流步進邏輯移入 `SandEngine`。
- [x] 讓 Phaser 場景改用 `engine.consumeDirtyCells()` 取得要重繪的 pixel。
- [x] 建立 `gravityDirection`，支援 `down`、`left`、`up`、`right`。
- [x] 改寫沙流規則，依照目前 gravity 計算「正下方」、「左斜下」、「右斜下」。
- [x] 改寫底層查詢，讓吸沙不再只看固定 X 軸，而是依 gravity 查詢可接觸的外層沙。
- [x] 保留目前水桶對應畫框座標的吸沙規則，確保未旋轉時行為不變。
- [x] 建立 engine command 介面，例如 `eraseCircle`、`recolorArea`、`wakeArea`、`rotateGravity`、`spawnSandRect`。
- [x] 實作 `rotateGravity(direction)`，先只旋轉重力，不旋轉美術畫框。
- [x] 增加一個簡單測試按鈕或除錯入口，切換重力方向觀察沙流。
- [x] 保持水桶、輸送帶、滿桶消除、死鎖判定可正常運作。
- [x] 執行 `node --check app.js`。
- [x] 使用 `http://127.0.0.1:57512/index.html` 驗證頁面可載入。
- [x] 驗證預設重力下，放桶吸沙行為與目前版本一致。
- [x] 驗證切換重力後，沙子會沿新方向流動。
- [x] 完成後提交 commit。

下次執行提示詞：

```text
請在 Sand Pixel Sorter 專案中執行下一階段架構重構：建立 SandEngine，將目前 app.js 裡的沙子資料、active cells、dirty cells、沙流步進、吸沙查詢從 Phaser 場景抽離。SandEngine 使用 Uint8Array colorGrid，保持每顆沙為 1 pixel，並提供 consumeDirtyCells 給渲染層更新 ImageData。請加入 gravityDirection，支援 down、left、up、right，將沙流規則從寫死 cellY + 1 改為依 gravity 計算正下方、左斜下、右斜下。吸沙查詢也要改成依 gravity 找水桶對應線上的外層可接觸沙，但預設 down 時行為必須與目前版本一致。請建立 engine command 入口，至少包含 wakeArea、eraseCircle、recolorArea、rotateGravity、spawnSandRect，方便未來做旋轉畫框與道具特效。本階段先不要實作完整 chunk dirty rect，但 API 要保留未來升級空間。完成後執行 node --check app.js，並用 http://127.0.0.1:57512/index.html 驗證頁面載入、預設吸沙、切換重力後沙流方向，最後 commit。
```
