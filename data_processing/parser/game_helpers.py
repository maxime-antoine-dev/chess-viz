from __future__ import annotations

import datetime as dt
import math
import re
from typing import Dict, List, Optional, Tuple


_TC_RE = re.compile(r"^\s*(\d+)\s*(?:\+\s*(\d+)\s*)?$")


def normalize_time_control_bucket(time_control_raw: str) -> str:
    m = _TC_RE.match(time_control_raw or "")
    if not m:
        return "OTHER"

    initial = int(m.group(1))
    inc = int(m.group(2) or 0)
    estimated = initial + 40 * inc  # seconds

    if estimated < 180:
        return "BULLET"
    if estimated < 480:
        return "BLITZ"
    if estimated < 1500:
        return "RAPID"
    return "OTHER"


def normalize_result_value(result_raw: str) -> int:
    if result_raw == "1-0":
        return 1
    if result_raw == "0-1":
        return -1
    if result_raw == "1/2-1/2":
        return 0
    return 0


def compute_average_elo(white_elo: Optional[int], black_elo: Optional[int]) -> Optional[float]:
    if white_elo is None and black_elo is None:
        return None
    if white_elo is None:
        return float(black_elo)
    if black_elo is None:
        return float(white_elo)
    return (white_elo + black_elo) / 2.0


def ts_ms_to_utc_date(ts_ms: int) -> str:
    d = dt.datetime.fromtimestamp(ts_ms / 1000.0, tz=dt.timezone.utc).date()
    return f"{d.year:04d}.{d.month:02d}.{d.day:02d}"


def accuracy_from_avg_cp_loss(avg_cp_loss: Optional[float]) -> Optional[float]:
    if avg_cp_loss is None:
        return None
    acc = 100.0 * math.exp(-avg_cp_loss / 100.0)
    return round(acc, 2)


def compute_accuracy_metrics_from_moves(
    moves: List[Dict[str, Optional[float]]]
) -> Tuple[
    bool,
    Optional[float],
    List[float],
    Optional[float],
    Optional[float],
    List[float],
    List[float],
]:
    """
    Input moves: [{"move": "e4", "eval": 0.2}, ...] where eval is in pawns.

    We compute centipawn loss per *player*:
      cp_loss_side = abs(eval_current - eval_previous_same_side) * 100

    We return:
      has_eval,
      average_accuracy (global),
      average_accuracy_per_move (global, NO None),
      avgAccuracyWhite,
      avgAccuracyBlack,
      avgAccuracyPerMoveWhite (NO None),
      avgAccuracyPerMoveBlack (NO None)

    Note: a player needs at least 2 eval points on their own moves to produce
    the first cp_loss (so the first accuracies appear later, but we don't emit None).
    """
    has_eval = any(m.get("eval") is not None for m in moves)

    last_eval_by_side: Dict[str, Optional[float]] = {"w": None, "b": None}

    cp_losses_all: List[float] = []
    cp_losses_w: List[float] = []
    cp_losses_b: List[float] = []

    acc_per_move_all: List[float] = []
    acc_per_move_w: List[float] = []
    acc_per_move_b: List[float] = []

    for ply_idx, m in enumerate(moves):
        side = "w" if ply_idx % 2 == 0 else "b"
        ev = m.get("eval")

        if ev is None:
            continue

        prev = last_eval_by_side[side]
        last_eval_by_side[side] = ev

        # Need 2 evals for this side to compute a delta -> else we skip (no None output)
        if prev is None:
            continue

        cp_loss = abs(ev - prev) * 100.0

        cp_losses_all.append(cp_loss)
        if side == "w":
            cp_losses_w.append(cp_loss)
        else:
            cp_losses_b.append(cp_loss)

        # Global running accuracy
        avg_cp_all = sum(cp_losses_all) / len(cp_losses_all)
        acc_per_move_all.append(accuracy_from_avg_cp_loss(avg_cp_all) or 0.0)

        # Per-side running accuracy
        if side == "w":
            avg_cp_w = sum(cp_losses_w) / len(cp_losses_w)
            acc_per_move_w.append(accuracy_from_avg_cp_loss(avg_cp_w) or 0.0)
        else:
            avg_cp_b = sum(cp_losses_b) / len(cp_losses_b)
            acc_per_move_b.append(accuracy_from_avg_cp_loss(avg_cp_b) or 0.0)

    average_accuracy = None
    if cp_losses_all:
        average_accuracy = accuracy_from_avg_cp_loss(sum(cp_losses_all) / len(cp_losses_all))

    avg_acc_w = None
    if cp_losses_w:
        avg_acc_w = accuracy_from_avg_cp_loss(sum(cp_losses_w) / len(cp_losses_w))

    avg_acc_b = None
    if cp_losses_b:
        avg_acc_b = accuracy_from_avg_cp_loss(sum(cp_losses_b) / len(cp_losses_b))

    return (
        has_eval,
        average_accuracy,
        acc_per_move_all,
        avg_acc_w,
        avg_acc_b,
        acc_per_move_w,
        acc_per_move_b,
    )
