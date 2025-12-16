from dataclasses import dataclass
from typing import Optional, List, Dict


@dataclass
class GameHeader:
    event: Optional[str]
    site: Optional[str]
    white: str
    black: str
    result: str
    ts_ms: int
    white_elo: Optional[int]
    black_elo: Optional[int]
    white_rating_diff: Optional[int]
    black_rating_diff: Optional[int]
    time_control_raw: str
    termination: Optional[str]
    variant: str
    eco: Optional[str]
    opening: Optional[str]
    white_title: Optional[str] = None
    black_title: Optional[str] = None
    moves: int = 0
    has_eval: bool = False
    white_cp_loss: Optional[float] = None
    black_cp_loss: Optional[float] = None


@dataclass
class ParsedGame:
    event: Optional[str]
    site: Optional[str]
    utc_date: str
    time_control_raw: str
    time_control: str  # RAPID | BLITZ | BULLET | OTHER
    white_elo: Optional[int]
    black_elo: Optional[int]
    average_elo: Optional[float]
    result_raw: str
    result_value: int  # 1 white win, -1 black win, 0 draw/other
    eco: Optional[str]
    opening: Optional[str]
    # Accuracy (global + per-side)
    has_eval: bool
    average_accuracy: Optional[float]
    average_accuracy_per_move: List[float]
    avg_accuracy_white: Optional[float]
    avg_accuracy_black: Optional[float]
    avg_accuracy_per_move_white: List[float]
    avg_accuracy_per_move_black: List[float]
    # Moves
    moves: List[Dict[str, Optional[float]]]  # [{"move": "e4", "eval": 0.2}, ...]
    # Raw PGN (keep it if you need to persist the source)
    pgn_source: str