from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, List, Optional, Sequence, Set, Tuple


Color = str
CellIndex = int


COLOR_LABELS: Dict[Color, str] = {
    "red": "紅",
    "green": "綠",
    "blue": "藍",
    "yellow": "黃",
}
COLOR_ORDER: Dict[Color, int] = {color: index for index, color in enumerate(COLOR_LABELS)}


class GamePhase(str, Enum):
    """遊戲主要狀態。"""

    RUNNING = "running"
    WON = "won"
    LOST = "lost"


PHASE_LABELS = {
    GamePhase.RUNNING: "進行中",
    GamePhase.WON: "勝利",
    GamePhase.LOST: "失敗",
}


@dataclass
class AbsorbEvent:
    """單次吸收事件，用來讓除錯輸出更像玩家能理解的回合紀錄。"""

    color: Color
    row: int
    column: int
    exposed_color: Optional[Color]


@dataclass
class SandStack:
    """單一像素格的垂直沙粒堆疊。

    layers 使用「由底到上」的順序保存顏色。
    例如 ("red", "blue") 表示紅色在底層，紅色被吸走後才會露出藍色。
    bottom_cursor 指向目前最低、可被水桶吸收的沙粒單位。
    """

    layers: Tuple[Color, ...]
    bottom_cursor: int = 0

    def current_color(self) -> Optional[Color]:
        """回傳目前底層可吸收的顏色；若已清空則回傳 None。"""
        if self.bottom_cursor >= len(self.layers):
            return None
        return self.layers[self.bottom_cursor]

    def absorb_one(self) -> Optional[Color]:
        """吸收一單位沙粒，並回傳吸收後新露出的底層顏色。"""
        if self.current_color() is None:
            return None
        self.bottom_cursor += 1
        return self.current_color()

    def remaining_units(self) -> int:
        """回傳此堆疊尚未被吸收的沙粒數量。"""
        return max(0, len(self.layers) - self.bottom_cursor)

    def snapshot(self) -> Tuple[Color, ...]:
        """回傳尚未被吸收的堆疊資料，供 UI、測試或 AI 代理讀取。"""
        return self.layers[self.bottom_cursor :]


class SandGrid:
    """管理像素圖與底層顏色索引。"""

    def __init__(self, rows: Sequence[Sequence[Sequence[Color]]]) -> None:
        self.height = len(rows)
        self.width = len(rows[0]) if rows else 0
        self.stacks: List[SandStack] = []
        self.accessible_by_color: Dict[Color, Set[CellIndex]] = {}
        self.remaining_total = 0

        for row_index, row in enumerate(rows):
            if len(row) != self.width:
                raise ValueError(f"第 {row_index + 1} 列寬度不一致。")

            for layers in row:
                stack = SandStack(tuple(layers))
                cell_index = len(self.stacks)
                self.stacks.append(stack)
                self.remaining_total += stack.remaining_units()

                current_color = stack.current_color()
                if current_color is not None:
                    self.accessible_by_color.setdefault(current_color, set()).add(cell_index)

    def available_colors(self) -> Set[Color]:
        """回傳目前底層可被吸收的顏色集合 S。"""
        return set(self.accessible_by_color.keys())

    def can_absorb(self, color: Color) -> bool:
        """檢查指定顏色是否存在於目前底層可吸收集合。"""
        return color in self.accessible_by_color

    def absorb_one(self, color: Color) -> Optional[AbsorbEvent]:
        """吸收指定顏色的一單位沙粒。

        這裡只更新被吸收的那一格，不重新掃描整張圖。
        回傳 AbsorbEvent 表示成功吸收；回傳 None 表示目前沒有該顏色可吸。
        """
        cell_set = self.accessible_by_color.get(color)
        if not cell_set:
            return None

        cell_index = min(cell_set)
        cell_set.remove(cell_index)
        if not cell_set:
            del self.accessible_by_color[color]

        stack = self.stacks[cell_index]
        exposed_color = stack.absorb_one()
        self.remaining_total -= 1

        if exposed_color is not None:
            self.accessible_by_color.setdefault(exposed_color, set()).add(cell_index)

        row = cell_index // self.width + 1
        column = cell_index % self.width + 1
        return AbsorbEvent(
            color=color,
            row=row,
            column=column,
            exposed_color=exposed_color,
        )

    def is_cleared(self) -> bool:
        """檢查整張像素圖是否已完全清空。"""
        return self.remaining_total == 0

    def snapshot(self) -> List[List[Tuple[Color, ...]]]:
        """回傳 2D 格式的剩餘堆疊，方便 AI 代理或 UI 呈現。"""
        result: List[List[Tuple[Color, ...]]] = []
        for y in range(self.height):
            row: List[Tuple[Color, ...]] = []
            for x in range(self.width):
                row.append(self.stacks[y * self.width + x].snapshot())
            result.append(row)
        return result


@dataclass
class Bucket:
    """輸送帶槽位中的水桶。"""

    color: Color
    capacity: int = 100
    amount: int = 0

    def is_full(self) -> bool:
        """檢查水桶是否已達消除條件。"""
        return self.amount >= self.capacity

    def absorb(self) -> None:
        """記錄水桶成功吸收一單位沙粒。"""
        if self.is_full():
            raise ValueError("水桶已滿，不能再吸收。")
        self.amount += 1


@dataclass
class TurnReport:
    """一次玩家放桶後的解析結果。"""

    placed_color: Color
    slot_index: int
    events: List[AbsorbEvent]
    removed_buckets: List[Bucket]


class Conveyor:
    """管理 5 個固定槽位。"""

    def __init__(self, slot_count: int = 5) -> None:
        self.slots: List[Optional[Bucket]] = [None for _ in range(slot_count)]

    def place_bucket(self, color: Color, capacity: int) -> int:
        """將水桶放入第一個空槽，並回傳槽位索引。"""
        for slot_index, bucket in enumerate(self.slots):
            if bucket is None:
                self.slots[slot_index] = Bucket(color=color, capacity=capacity)
                return slot_index
        raise ValueError("輸送帶已滿，無法放入新的水桶。")

    def remove_full_buckets(self) -> List[Bucket]:
        """移除已滿水桶，釋放槽位並回傳被移除的水桶清單。"""
        removed: List[Bucket] = []
        for slot_index, bucket in enumerate(self.slots):
            if bucket is not None and bucket.is_full():
                removed.append(bucket)
                self.slots[slot_index] = None
        return removed

    def active_buckets(self) -> List[Bucket]:
        """回傳目前槽位內所有啟動中的水桶。"""
        return [bucket for bucket in self.slots if bucket is not None]

    def is_full(self) -> bool:
        """檢查 5 個槽位是否都被佔用。"""
        return all(bucket is not None for bucket in self.slots)

    def bucket_colors(self) -> Set[Color]:
        """回傳槽位中水桶顏色集合 A。"""
        return {bucket.color for bucket in self.active_buckets()}

    def snapshot(self) -> List[Optional[Tuple[Color, int, int]]]:
        """回傳槽位狀態，格式為 (顏色, 目前容量, 最大容量)。"""
        return [
            None if bucket is None else (bucket.color, bucket.amount, bucket.capacity)
            for bucket in self.slots
        ]


class GameState:
    """Sand Pixel Sorter 的核心狀態機。"""

    def __init__(self, grid: SandGrid, bucket_capacity: int = 100) -> None:
        self.grid = grid
        self.conveyor = Conveyor(slot_count=5)
        self.bucket_capacity = bucket_capacity
        self.phase = GamePhase.RUNNING
        self.turn = 0

    def place_bucket(self, color: Color) -> TurnReport:
        """玩家行動：放入指定顏色水桶，然後自動解析吸收流程。"""
        if self.phase != GamePhase.RUNNING:
            raise ValueError(f"遊戲已結束，狀態為 {self.phase.value}。")

        slot_index = self.conveyor.place_bucket(color=color, capacity=self.bucket_capacity)
        self.turn += 1
        events, removed_buckets = self.resolve_absorption()
        self.update_phase()
        return TurnReport(
            placed_color=color,
            slot_index=slot_index,
            events=events,
            removed_buckets=removed_buckets,
        )

    def resolve_absorption(self) -> Tuple[List[AbsorbEvent], List[Bucket]]:
        """解析所有啟動水桶的自動吸收。

        每個水桶會持續吸收同色底層沙粒，直到水桶已滿或目前沒有同色底層。
        吸收可能會讓別的顏色露出來，所以同一輪會反覆檢查所有水桶。
        """
        events: List[AbsorbEvent] = []
        removed_buckets: List[Bucket] = []
        made_progress = True

        while made_progress and self.phase == GamePhase.RUNNING:
            made_progress = False

            for bucket in self.conveyor.active_buckets():
                while not bucket.is_full() and self.grid.can_absorb(bucket.color):
                    event = self.grid.absorb_one(bucket.color)
                    if event is None:
                        break

                    bucket.absorb()
                    events.append(event)
                    made_progress = True

                    if self.grid.is_cleared():
                        self.phase = GamePhase.WON
                        break

                if self.phase != GamePhase.RUNNING:
                    break

            removed_buckets.extend(self.conveyor.remove_full_buckets())

        return events, removed_buckets

    def update_phase(self) -> None:
        """依照勝利與死鎖條件更新遊戲狀態。"""
        if self.grid.is_cleared():
            self.phase = GamePhase.WON
            return

        if self.is_deadlocked():
            self.phase = GamePhase.LOST

    def is_deadlocked(self) -> bool:
        """死鎖判定：槽位全滿且 A 與 S 無交集。"""
        if not self.conveyor.is_full():
            return False

        available_colors = self.grid.available_colors()
        active_bucket_colors = self.conveyor.bucket_colors()
        return active_bucket_colors.isdisjoint(available_colors)

    def get_legal_actions(self, candidate_colors: Sequence[Color]) -> List[Color]:
        """回傳目前可放入槽位的水桶顏色，供 AI 代理列舉行動。"""
        if self.phase != GamePhase.RUNNING or self.conveyor.is_full():
            return []
        return list(candidate_colors)

    def snapshot(self) -> Dict[str, object]:
        """回傳完整可序列化狀態，方便 UI、測試與 AI 求解器使用。"""
        return {
            "turn": self.turn,
            "phase": self.phase.value,
            "remaining_total": self.grid.remaining_total,
            "available_colors": sorted(self.grid.available_colors()),
            "conveyor": self.conveyor.snapshot(),
            "grid": self.grid.snapshot(),
        }


def color_label(color: Color) -> str:
    """將內部英文顏色轉成玩家看得懂的中文。"""
    return COLOR_LABELS.get(color, color)


def sort_colors(colors: Sequence[Color]) -> List[Color]:
    """依照固定順序排序顏色，讓範例輸出穩定。"""
    return sorted(colors, key=lambda color: (COLOR_ORDER.get(color, 999), color))


def format_color_list(colors: Sequence[Color]) -> str:
    """格式化顏色清單。"""
    sorted_colors = sort_colors(colors)
    if not sorted_colors:
        return "無"
    return "、".join(color_label(color) for color in sorted_colors)


def format_stack(layers: Sequence[Color]) -> str:
    """格式化單一像素格。

    顯示規則為「底層 > 上層」。
    例如 [紅>藍] 表示紅色現在露出，可被紅桶吸走；紅色消失後才會露出藍色。
    """
    if not layers:
        return "[空]"
    return "[" + ">".join(color_label(color) for color in layers) + "]"


def print_intro(bucket_capacity: int) -> None:
    """印出玩家角度的玩法說明。"""
    print("Sand Pixel Sorter 核心規則示範")
    print("每個像素格都是一疊沙，畫面格式是 [底層>上層>更上層]。")
    print("水桶只能吸目前露出的底層顏色；吸走底層後，下一層顏色才會露出。")
    print(f"本範例水桶容量設為 {bucket_capacity}，正式遊戲可改成 100。")


def print_snapshot(game: GameState) -> None:
    """以玩家能理解的方式輸出目前遊戲狀態。"""
    snapshot = game.snapshot()
    phase = PHASE_LABELS[game.phase]

    print(f"\n回合 {snapshot['turn']} | 狀態：{phase} | 剩餘沙粒：{snapshot['remaining_total']}")
    print(f"目前露出的底層顏色：{format_color_list(list(game.grid.available_colors()))}")

    print("\n像素圖：")
    for row in snapshot["grid"]:
        print("  " + "  ".join(format_stack(cell) for cell in row))

    print("\n輸送帶：")
    for slot_index, bucket in enumerate(snapshot["conveyor"], start=1):
        if bucket is None:
            print(f"  槽 {slot_index}: 空")
        else:
            color, amount, capacity = bucket
            print(f"  槽 {slot_index}: {color_label(color)}桶 {amount}/{capacity}")


def print_turn_report(report: TurnReport) -> None:
    """輸出一次玩家行動後發生的吸收與消除。"""
    print(f"\n玩家放入：{color_label(report.placed_color)}桶 -> 槽 {report.slot_index + 1}")

    if not report.events:
        print("吸收結果：沒有相同顏色的底層可以吸。")
    else:
        grouped: Dict[Color, List[AbsorbEvent]] = {}
        for event in report.events:
            grouped.setdefault(event.color, []).append(event)

        print("吸收結果：")
        for color in sort_colors(list(grouped.keys())):
            events = grouped[color]
            details: List[str] = []
            for event in events:
                if event.exposed_color is None:
                    details.append(f"第{event.row}列第{event.column}格清空")
                else:
                    exposed = color_label(event.exposed_color)
                    details.append(f"第{event.row}列第{event.column}格露出{exposed}")
            print(f"  {color_label(color)}桶吸走 {len(events)} 單位：{'；'.join(details)}")

    if report.removed_buckets:
        removed = "、".join(
            f"{color_label(bucket.color)}桶 {bucket.amount}/{bucket.capacity}"
            for bucket in report.removed_buckets
        )
        print(f"水桶消除：{removed} 已滿並離開輸送帶。")


def build_demo_game() -> GameState:
    """建立一個小型可跑通的測試關卡。

    每個內層 list 都是一個像素格，順序是由底到上。
    為了讓範例容易看懂，示範容量使用 3；正式遊戲可改為 100。
    """
    rows = [
        [["red", "blue"], ["red", "green"], ["yellow", "blue"]],
        [["green", "red"], ["blue", "yellow"], ["green", "yellow"]],
    ]
    return GameState(grid=SandGrid(rows), bucket_capacity=3)


def run_demo() -> None:
    """執行固定玩家輸入序列，展示核心循環如何推進狀態。"""
    game = build_demo_game()
    candidate_actions = ["red", "green", "blue", "yellow"]
    scripted_actions = ["red", "green", "blue", "yellow"]

    print_intro(game.bucket_capacity)
    print_snapshot(game)

    for color in scripted_actions:
        if game.phase != GamePhase.RUNNING:
            break

        legal_actions = game.get_legal_actions(candidate_actions)
        if color not in legal_actions:
            raise ValueError(f"目前不能放入 {color_label(color)}桶。")

        print("\n" + "=" * 60)
        report = game.place_bucket(color)
        print_turn_report(report)
        print_snapshot(game)

    print("\n" + "=" * 60)
    if game.phase == GamePhase.RUNNING:
        print("示範結束：遊戲尚未分出勝負，等待更多玩家行動。")
    elif game.phase == GamePhase.WON:
        print("結果：像素圖已清空，玩家勝利。")
    else:
        print("結果：5 個槽位全滿，而且沒有任何水桶能吸目前底層顏色，玩家失敗。")


if __name__ == "__main__":
    run_demo()
