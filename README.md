# Sand Pixel Sorter Web Prototype

這是一個可在瀏覽器執行的 `Sand Pixel Sorter` 原型。

## 執行方式

直接用瀏覽器開啟：

```text
D:\Git\Idle Sand Sorting\index.html
```

目前 Web 版使用 `Phaser 3 + Matter Physics` 負責 Canvas 場景、圓球沙粒、剛體碰撞、重力、滾動、吸入粒子與輸送帶顯示。核心規則仍保留在純 JavaScript 狀態模型中，方便之後接 AI 求解或關卡驗證。

目前沙子採用「Particle Object + Matter Body」：

- 每顆沙都是 `SandParticle` 物件，保存 `id`、`color`、`gridX`、`gridY`、`x`、`y`、`state`。
- 每顆沙在 Phaser 場景中都有一個 Matter 圓形剛體。
- 水桶只吸「該桶目前 X 軸正上方」且位於畫框底部範圍內的同色沙。
- 沙粒材質使用低彈性、高摩擦、高阻尼設定，避免像橡膠球一樣回彈。
- 吸走一顆沙後，周圍沙球會受重力、碰撞、摩擦與微弱側向擾動自然下落或滾動。

## 原型規則

- 每個像素格是一個垂直堆疊。
- 上方顯示的是完整像素沙畫；目前沙畫解析度為 `64x64`。
- 每格目前只有一層沙畫顏色；吸完後該格會直接變空，不會露出隨機填充色。
- 吸走一格後，同一欄上方的沙會往下掉補位。
- 水桶放入 5 格輸送帶後會自動吸同色底層。
- 玩家可以連續放桶；吸收迴圈會在背景持續處理所有啟動中的水桶。
- 多個水桶同時啟動時採用輪流吸收，每一輪每個桶最多吸 `1` 顆沙球。
- 吸收動畫已加速：每輪多桶可並行吸收，單顆吸入 Tween 約 `68ms`。
- 吸收採用串流判定：第一顆吸入動畫尚未結束時，約每 `12ms` 會重新判斷是否能接著吸下一顆。
- 輸送帶槽位會持續往右移動，超過最右側後循環回到最左側。
- 輸送帶左右兩側有最上層遮罩，隱藏桶子循環回到左側的瞬間位移。
- 放桶時會選擇畫面上 X 座標最左邊的空槽，而不是槽位編號最小的空槽。
- 右側介面已極簡化，只保留水桶按鈕。
- 本原型每吸一層算 `10` 單位，水桶容量是 `100`。
- 水桶滿 `100/100` 後會消失並釋放槽位。
- 若 5 個槽位全滿，且沒有任何水桶顏色符合目前底層可吸顏色，判定死鎖。

## 下一階段任務清單：Bitmap Sand Engine

目標：將沙子核心改成「一顆沙 = bitmap 的一個 pixel」。資料層不再建立一顆沙一個 JS 物件，渲染層也不再逐顆畫圓，而是更新一張低解析度 bitmap，再用 nearest-neighbor 等比例放大顯示。

- [ ] 建立新分支：`engine/bitmap-sand`
- [ ] 建立 bitmap 沙畫資料模型。
- [ ] 移除 `SandParticle` 物件式資料。
- [ ] 使用 `Uint8Array colorGrid` 儲存沙子顏色。
- [ ] 使用 `0` 代表空格，`1..N` 代表沙子顏色。
- [ ] 視需要建立 `nextGrid` 或 temp swap buffer。
- [ ] 建立 `activeQueue`，只保存會動的 cell index。
- [ ] 建立 `dirtyCells` 或 `dirtyChunks`，只重繪有變動的區域。
- [ ] 改寫沙流模擬，每次吸沙後只把受影響 cell 加入 active queue。
- [ ] 每幀只處理 active cells。
- [ ] 沙流規則採用：下、左下、右下。
- [ ] 左下與右下加入交錯或隨機順序，避免沙子固定偏向同一側。
- [ ] 改寫渲染層，建立低解析度 bitmap canvas，例如 `128x128` 或 `256x256`。
- [ ] 每顆沙直接寫入 `ImageData` 的一個 pixel。
- [ ] Phaser / DOM 只顯示這一張 bitmap。
- [ ] 顯示時使用 nearest-neighbor / `image-rendering: pixelated` 等比例放大。
- [ ] 改寫吸沙邏輯，將水桶目前 X 軸換算成 bitmap column。
- [ ] 水桶只吸該 column 底部可接觸的同色 pixel。
- [ ] 吸走後該 pixel 設為 `0`。
- [ ] 吸走後將該 column 與附近 columns 加入 active queue。
- [ ] 保留右側水桶按鈕。
- [ ] 保留輸送帶移動與左右遮罩。
- [ ] 保留水桶滿桶消除。
- [ ] 保留死鎖判定。
- [ ] 每幀限制最多處理 active cells 數量，避免阻塞 UI。
- [ ] 若 active queue 過大，分幀處理。
- [ ] 驗證沙子比目前更密，且每顆沙是 1 pixel。
- [ ] 驗證畫面放大後仍是像素風。
- [ ] 驗證放桶後沙子會自然往下流。
- [ ] 驗證連續放桶不卡。
- [ ] 執行 `node --check app.js`。
- [ ] 測試本機網址：`http://127.0.0.1:57512/index.html`
- [ ] 完成後提交 commit。

下次執行提示詞：

```text
請建立 Git 分支 engine/bitmap-sand，將 Sand Pixel Sorter 的沙子核心重構為 bitmap sand engine。每顆沙是一個 bitmap pixel，不再是 JS 物件或 Phaser circle。使用 Uint8Array colorGrid 儲存沙子顏色，0 代表空格，1..N 代表顏色。使用 active queue 只更新會動的 cell，流動規則為下、左下、右下。渲染層改成 ImageData / CanvasTexture，只畫一張低解析度 bitmap，顯示時用 nearest-neighbor / image-rendering: pixelated 等比例放大。保留現有輸送帶、水桶、X 軸底層吸沙、滿桶消除與死鎖邏輯。完成後測試 http://127.0.0.1:57512/index.html、執行 node --check app.js，最後 commit。
```
