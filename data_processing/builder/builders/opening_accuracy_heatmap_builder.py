from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import polars as pl

from ..base import BaseBuilder
from ..registry import register_builder

# x = opening accuracy bin (0–10, …, 90–100)
# y = after-opening accuracy bin
#
# for a given opening / time control / elo bracket:
# heatmap[y][x] = average win score among the samples in that cell (0..1)
# cell_samples[y][x] = number of samples used to compute that heatmap[y][x]

def _fast_json_loads(s: Optional[str]) -> Any:
    if not s:
        return []
    try:
        import orjson  # type: ignore

        return orjson.loads(s)
    except Exception:
        import json

        return json.loads(s)


def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def _bin_index_10(x: float) -> int:
    """
    Map [0..100] -> 10 bins:
      0: [0,10)
      1: [10,20)
      ...
      9: [90,100]
    """
    x = _clamp(x, 0.0, 100.0)
    idx = int(x // 10.0)
    return 9 if idx >= 10 else idx


def _elo_bracket(elo: int) -> str:
    if elo < 500:
        return "0-500"
    if elo < 1000:
        return "500-1000"
    if elo < 1500:
        return "1000-1500"
    if elo < 2000:
        return "1500-2000"
    return "2000+"


def _compute_opening_and_after_accuracy(
    acc_per_move: List[float],
    opening_moves: int = 12,
) -> Optional[Tuple[float, float]]:
    """
    acc_per_move is cumulative average accuracy after each move of that player.
    - opening accuracy = acc_per_move[opening_moves-1]
    - after-opening accuracy must be recomputed from cumulative averages:

      total_sum = final_avg * N
      opening_sum = opening_avg * opening_moves
      after_avg = (total_sum - opening_sum) / (N - opening_moves)

    We require N > opening_moves. If N == opening_moves, there is no "after opening" segment.
    """
    if not acc_per_move or len(acc_per_move) <= opening_moves:
        return None

    opening_avg = acc_per_move[opening_moves - 1]
    final_avg = acc_per_move[-1]
    n_total = len(acc_per_move)

    total_sum = final_avg * n_total
    opening_sum = opening_avg * opening_moves
    n_after = n_total - opening_moves
    if n_after <= 0:
        return None

    after_avg = (total_sum - opening_sum) / n_after
    return float(opening_avg), float(after_avg)


def _new_matrix_float() -> List[List[float]]:
    return [[0.0 for _ in range(10)] for __ in range(10)]


def _new_matrix_int() -> List[List[int]]:
    return [[0 for _ in range(10)] for __ in range(10)]


def _player_win_score(result_value: int, is_white: bool) -> float:
    """
    result_value:
      1  -> white win
      -1 -> black win
      0  -> draw/other

    win score (for winrate):
      win  -> 1.0
      draw -> 0.5
      loss -> 0.0
    """
    if result_value == 0:
        return 0.5
    if is_white:
        return 1.0 if result_value == 1 else 0.0
    return 1.0 if result_value == -1 else 0.0


def _opening_root(name: str) -> str:
    """
    Normalize Lichess opening names by keeping only the "family" part before ':'.

    Examples:
      "Ruy Lopez: Steinitz Defense" -> "Ruy Lopez"
      "Sicilian Defense: Najdorf Variation" -> "Sicilian Defense"
    """
    s = (name or "").strip()
    if not s:
        return ""
    if ":" in s:
        s = s.split(":", 1)[0].strip()
    return s


@dataclass
class _AggCell:
    # counts per (after_bin=y, opening_bin=x)
    counts: List[List[int]]
    # sum of win scores in each cell
    win_sums: List[List[float]]
    total: int


@register_builder
class OpeningAccuracyHeatmapBuilder(BaseBuilder):
    """
    Build a 10x10 heatmap for (opening accuracy, after-opening accuracy),
    per time control + elo bracket + opening (+ "All").

    IMPORTANT:
      The matrix stores average winrate per cell:
        heatmap[y_after][x_opening] = avg win score in that cell (0..1)

      (win score = 1 win, 0 loss, 0.5 draw)
    """

    name = "opening_accuracy_heatmap"
    version = "3"  # bumped because we normalize/group opening names

    ALLOWED_TIME_CONTROLS = {"BLITZ", "RAPID", "BULLET"}

    # Hardcoded opening groups we keep.
    # Everything else can be mapped to "Other" (recommended), so JSON stays small and meaningful.
    OPENING_WHITELIST = {
        "Sicilian Defense",
        "French Defense",
        "Caro-Kann Defense",
        "Scandinavian Defense",
        "Alekhine Defense",
        "Pirc Defense",
        "Modern Defense",
        "Dutch Defense",
        "Philidor Defense",
        "Petrov's Defense",
        "Italian Game",
        "Ruy Lopez",
        "Scotch Game",
        "Four Knights Game",
        "Vienna Game",
        "King's Gambit",
        "English Opening",
        "Queen's Gambit",
        "Slav Defense",
        "Semi-Slav Defense",
        "Nimzo-Indian Defense",
        "Queen's Indian Defense",
        "Bogo-Indian Defense",
        "King's Indian Defense",
        "Grünfeld Defense",
        "Benoni Defense",
        "Benko Gambit",
        "London System",
        "Catalan Opening",
        "Réti Opening",
        "Bird Opening",
        "Polish Opening",
        "Owen Defense",
        "Czech Defense",
        "Trompowsky Attack",
        "Veresov Opening",
        "Jobava London System",
        "Stonewall Attack",
    }

    def __init__(
        self,
        *,
        root=None,
        opening_moves: int = 12,
        include_unknown_opening: bool = False,
        max_openings_per_bucket: Optional[int] = None,
        min_samples_per_opening: int = 1,
        group_unlisted_to_other: bool = True,
        other_label: str = "Other",
    ) -> None:
        super().__init__(root=root)
        self.opening_moves = opening_moves
        self.include_unknown_opening = include_unknown_opening
        self.max_openings_per_bucket = max_openings_per_bucket
        self.min_samples_per_opening = min_samples_per_opening
        self.group_unlisted_to_other = group_unlisted_to_other
        self.other_label = other_label

    def build(self, df: pl.DataFrame) -> Dict[str, Any]:
        if df is None or df.is_empty():
            return {}

        needed = [
            "time_control",
            "opening",
            "white_elo",
            "black_elo",
            "result_value",
            "avg_accuracy_per_move_white_json",
            "avg_accuracy_per_move_black_json",
        ]
        missing = [c for c in needed if c not in df.columns]
        if missing:
            raise ValueError(f"Missing required columns for builder '{self.name}': {missing}")

        sub = df.select(needed)
        cols = sub.to_dict(as_series=False)
        n = sub.height

        # agg[tc][bracket][opening] = _AggCell(...)
        agg: Dict[str, Dict[str, Dict[str, _AggCell]]] = {}

        def ensure_cell(tc: str, bracket: str, opening_name: str) -> _AggCell:
            if tc not in agg:
                agg[tc] = {}
            if bracket not in agg[tc]:
                agg[tc][bracket] = {}
            if opening_name not in agg[tc][bracket]:
                agg[tc][bracket][opening_name] = _AggCell(
                    counts=_new_matrix_int(),
                    win_sums=_new_matrix_float(),
                    total=0,
                )
            return agg[tc][bracket][opening_name]

        def add_sample(
            tc: str,
            bracket: str,
            opening_name: str,
            opening_acc: float,
            after_acc: float,
            win_score: float,
        ) -> None:
            x = _bin_index_10(opening_acc)
            y = _bin_index_10(after_acc)
            cell = ensure_cell(tc, bracket, opening_name)
            cell.counts[y][x] += 1
            cell.win_sums[y][x] += win_score
            cell.total += 1

        def normalize_opening(raw: Optional[str]) -> Tuple[bool, str]:
            """
            Returns (has_opening, grouped_name).

            - Extract family name before ':'
            - If it's not in whitelist:
                - map to "Other" if group_unlisted_to_other
                - else keep the family name as-is
            """
            s = (raw or "").strip()
            if not s:
                return False, ""

            family = _opening_root(s)
            if not family:
                return False, ""

            if family in self.OPENING_WHITELIST:
                return True, family

            if self.group_unlisted_to_other:
                return True, self.other_label

            return True, family

        for i in range(n):
            tc = cols["time_control"][i]
            if not tc or tc not in self.ALLOWED_TIME_CONTROLS:
                continue

            has_opening, opening_group = normalize_opening(cols["opening"][i])

            # This is per-game result, then we assign per-player win score.
            rv = cols["result_value"][i]
            if rv is None:
                continue
            rv = int(rv)

            # ---- WHITE sample ----
            w_elo = cols["white_elo"][i]
            if w_elo is not None:
                bracket = _elo_bracket(int(w_elo))
                acc_w = _fast_json_loads(cols["avg_accuracy_per_move_white_json"][i])
                if isinstance(acc_w, list):
                    res = _compute_opening_and_after_accuracy(acc_w, opening_moves=self.opening_moves)
                    if res is not None:
                        op_acc, aft_acc = res
                        win_score = _player_win_score(rv, is_white=True)

                        add_sample(tc, bracket, "All", op_acc, aft_acc, win_score)
                        if has_opening or self.include_unknown_opening:
                            add_sample(
                                tc,
                                bracket,
                                opening_group if has_opening else "Unknown",
                                op_acc,
                                aft_acc,
                                win_score,
                            )

            # ---- BLACK sample ----
            b_elo = cols["black_elo"][i]
            if b_elo is not None:
                bracket = _elo_bracket(int(b_elo))
                acc_b = _fast_json_loads(cols["avg_accuracy_per_move_black_json"][i])
                if isinstance(acc_b, list):
                    res = _compute_opening_and_after_accuracy(acc_b, opening_moves=self.opening_moves)
                    if res is not None:
                        op_acc, aft_acc = res
                        win_score = _player_win_score(rv, is_white=False)

                        add_sample(tc, bracket, "All", op_acc, aft_acc, win_score)
                        if has_opening or self.include_unknown_opening:
                            add_sample(
                                tc,
                                bracket,
                                opening_group if has_opening else "Unknown",
                                op_acc,
                                aft_acc,
                                win_score,
                            )

        def winrate_matrix(cell: _AggCell) -> List[List[float]]:
            # heatmap[y][x] = win_sums[y][x] / counts[y][x]
            out_m = [[0.0 for _ in range(10)] for __ in range(10)]
            for y in range(10):
                for x in range(10):
                    c = cell.counts[y][x]
                    if c <= 0:
                        out_m[y][x] = 0.0
                    else:
                        out_m[y][x] = round(cell.win_sums[y][x] / float(c), 6)
            return out_m

        def samples_matrix(cell: _AggCell) -> List[List[int]]:
            return cell.counts

        out: Dict[str, Any] = {}
        for tc, by_bracket in agg.items():
            tc_key = tc.lower()
            out[tc_key] = {}

            for bracket, by_opening in by_bracket.items():
                filtered_items = []
                for name, cell in by_opening.items():
                    if name == "All":
                        filtered_items.append((name, cell))
                        continue
                    if cell.total >= self.min_samples_per_opening:
                        filtered_items.append((name, cell))

                # IMPORTANT: if max_openings_per_bucket=20, keep the 20 biggest by sample count
                # (excluding "All", which is always kept).
                if self.max_openings_per_bucket is not None:
                    all_cell = next((c for n_, c in filtered_items if n_ == "All"), None)
                    others = [(n_, c) for n_, c in filtered_items if n_ != "All"]
                    others.sort(key=lambda t: t[1].total, reverse=True)
                    others = others[: self.max_openings_per_bucket]
                    filtered_items = ([("All", all_cell)] if all_cell is not None else []) + others

                out[tc_key][bracket] = {
                    name: {
                        "samples": int(cell.total),
                        "heatmap": winrate_matrix(cell),
                        "cell_samples": samples_matrix(cell),
                    }
                    for name, cell in filtered_items
                    if cell is not None
                }

        return out
