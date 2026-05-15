# Sand Pixel Sorter 技術架構草案

## 核心概念

`Sand Pixel Sorter` 的核心狀態由三個部分組成：

1. `SandGrid`
   - 表示上方 2D 像素藝術圖。
   - 每一格都是一個 `SandStack`，內部保存由底到上的顏色堆疊。
   - 每個堆疊只暴露目前「最低尚未被吸收」的顏色單位。

2. `Conveyor`
   - 表示 5 個固定槽位。
   - 玩家放入水桶後，水桶立即進入啟動狀態。
   - 每個槽位最多持有一個 `Bucket`。

3. `GameState`
   - 管理回合狀態、吸收解析、勝負判定與死鎖判定。
   - 未來 AI 代理可以透過 `snapshot()` 讀取完整狀態，並透過 `get_legal_actions()` 取得可行動作。

## 底層掃描演算法

若每次水桶吸收都重新掃描整張圖，成本會接近：

```text
O(width * height * absorbed_units)
```

這會在大圖或高容量水桶中迅速變慢。

本原型採用「底層索引表」：

```text
accessible_by_color: Dict[Color, Set[cell_index]]
```

初始化時掃描每個格子一次：

1. 取得該格 `SandStack.current_color()`。
2. 若尚未清空，就把格子索引加入對應顏色集合。

吸收時不重新掃描全圖，而是：

1. 從 `accessible_by_color[bucket.color]` 取出一個格子索引。
2. 對該格 `SandStack.absorb_one()`，讓該堆疊的游標往上一層。
3. 若該格還有新底層顏色，就把格子索引加入新顏色集合。
4. 若舊顏色集合變空，從索引表移除該顏色。

因此每吸收一個單位的更新成本接近：

```text
O(1)
```

只有初始化需要：

```text
O(width * height)
```

## 死鎖邏輯

定義：

```text
S = 目前底層可用顏色集合
A = 5 個槽位中水桶顏色集合
```

若輸送帶 5 個槽位全滿，且沒有任何水桶顏色能吸收目前底層顏色：

```text
A ∩ S = ∅
```

則判定失敗。

遊戲狀態判定順序：

1. 若 `SandGrid` 全部清空，判定勝利。
2. 若符合死鎖條件，判定失敗。
3. 否則維持進行中。

## AI 代理整合方向

為了讓未來 AI 自動求解器容易接入，核心邏輯應維持以下特性：

1. 狀態可序列化
   - `snapshot()` 回傳純資料結構，不暴露內部可變物件。

2. 行動可列舉
   - `get_legal_actions()` 回傳目前可放入槽位的水桶顏色。

3. 模擬可重現
   - 核心循環不依賴真實時間。
   - 每次玩家行動後，以固定規則解析吸收結果。

4. 狀態轉移集中
   - 由 `GameState.place_bucket()` 與 `GameState.resolve_absorption()` 控制狀態改變。
   - UI、動畫、音效不直接修改核心模型。

