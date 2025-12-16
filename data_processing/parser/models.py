from dataclasses import dataclass
from typing import Optional, List, Dict

# Minimal per-game information we need from the raw Lichess PGN.
@dataclass
class GameHeader:
    event: Optional[str]
    site: Optional[str]
    white: str
    black: str
    result: str # "1-0", "0-1", or "1/2-1/2"
    ts_ms: int                    # creation timestamp in ms (UTC)
    white_elo: Optional[int]
    black_elo: Optional[int]
    white_rating_diff: Optional[int]
    black_rating_diff: Optional[int]
    time_control_raw: str # e.g. "300+0"
    termination: Optional[str]
    variant: str # e.g. "Standard"
    eco: Optional[str] # ECO code like "C50"
    opening: Optional[str]
    white_title: Optional[str] = None # GM, IM, ...
    black_title: Optional[str] = None
    moves: int = 0  
    has_eval: bool = False
    # average centipawn loss per move for each side
    white_cp_loss: Optional[float] = None
    black_cp_loss: Optional[float] = None


@dataclass
class ParsedGame:
    header: GameHeader
    tags: Dict[str, str]
    moves_san: List[str]
    movetext_raw: str
    pgn_source: str