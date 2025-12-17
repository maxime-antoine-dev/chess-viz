from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Iterable, List, Optional, Union

import polars as pl

from .models import ParsedGame
from .pgn_reader import parse_games, print_pgn_profile
from .utils import load_sha256_sums, sha256_file


class Parser:
    """
    Wrapper around parse_games().

    Usage:
        p = Parser("data/2013/lichess_db_standard_rated_2013-01.pgn.zst")
        first3 = p.test()
        out = p.exportAll()   # writes parsed/<name>.parquet

    Notes:
      - eval_only defaults to True
      - only_time_control_selection defaults to True (keeps RAPID/BLITZ/BULLET)
      - sha_check defaults to True (if sha256sums.txt exists)
    """

    ALLOWED_TIME_CONTROLS = {"RAPID", "BLITZ", "BULLET"}

    def __init__(
        self,
        source_file: Union[str, Path],
        *,
        eval_only: bool = True,
        only_time_control_selection: bool = True,
        sha_check: bool = True,
        root: Optional[Path] = None,
    ) -> None:
        self.root = root or Path(__file__).resolve().parents[1]
        self.eval_only = eval_only
        self.only_time_control_selection = only_time_control_selection
        self.sha_check = sha_check

        self.source_path = self._resolve_source_path(source_file)

    # -------------------------
    # Public API
    # -------------------------

    def iterGames(self) -> Iterable[ParsedGame]:
        """
        Stream parsed games (generator).
        Applies sha check (optional) + eval-only filter (optional) + time control filter (optional).
        """
        if self.sha_check:
            self._maybe_verify_sha256(self.root, self.source_path)

        games_iter = parse_games(self.source_path)

        if self.eval_only:
            games_iter = (g for g in games_iter if g.has_eval)

        if self.only_time_control_selection:
            games_iter = (g for g in games_iter if g.time_control in self.ALLOWED_TIME_CONTROLS)

        return games_iter

    def test(self, n: int = 3) -> List[ParsedGame]:
        """
        Return the first n parsed games as a list (default 3).
        """
        return list(itertools.islice(self.iterGames(), n))

    def getAll(self) -> List[ParsedGame]:
        """
        Parse the whole file and return everything as a list.
        (Warning: can be huge.)
        """
        return list(self.iterGames())

    def exportAll(self, *, out_dir: Union[str, Path] = "parsed") -> Path:
        """
        Same idea as getAll(), but exports the filtered games into:
            <root>/<out_dir>/<source_name>.parquet

        The parquet contains only games that pass the Parser filters.
        Nested fields are stored as JSON strings for robustness:
          - moves
          - average_accuracy_per_move
          - avg_accuracy_per_move_white
          - avg_accuracy_per_move_black
        """
        out_root = Path(out_dir)
        if not out_root.is_absolute():
            out_root = (self.root / out_root).resolve()
        out_root.mkdir(parents=True, exist_ok=True)

        out_path = out_root / f"{self._output_basename(self.source_path.name)}.parquet"

        rows = []
        for g in self.iterGames():
            rows.append(self._game_to_row(g))

        df = pl.DataFrame(rows) if rows else pl.DataFrame(
            schema={
                "event": pl.Utf8,
                "site": pl.Utf8,
                "utc_date": pl.Utf8,
                "year": pl.Int32,
                "time_control_raw": pl.Utf8,
                "time_control": pl.Utf8,
                "white_elo": pl.Int32,
                "black_elo": pl.Int32,
                "average_elo": pl.Float64,
                "result_raw": pl.Utf8,
                "result_value": pl.Int8,
                "eco": pl.Utf8,
                "opening": pl.Utf8,
                "has_eval": pl.Boolean,
                "average_accuracy": pl.Float64,
                "average_accuracy_per_move_json": pl.Utf8,
                "avg_accuracy_white": pl.Float64,
                "avg_accuracy_black": pl.Float64,
                "avg_accuracy_per_move_white_json": pl.Utf8,
                "avg_accuracy_per_move_black_json": pl.Utf8,
                "moves_json": pl.Utf8,
                "pgn_source": pl.Utf8,
                "source_file": pl.Utf8,
            }
        )

        df.write_parquet(out_path, compression="zstd", statistics=True)
        return out_path

    def printProfile(self) -> None:
        """
        Print internal PGN profiling (timings).
        """
        print_pgn_profile()

    # -------------------------
    # Internals
    # -------------------------

    def _resolve_source_path(self, source_file: Union[str, Path]) -> Path:
        p = Path(source_file)
        if not p.is_absolute():
            p = (self.root / p).resolve()
        if not p.exists():
            raise FileNotFoundError(f"PGN file not found: {p}")
        return p

    def _maybe_verify_sha256(self, root: Path, pgn_path: Path) -> None:
        sha_file = root / "data" / "sha256sums.txt"
        if not sha_file.exists():
            return

        mapping = load_sha256_sums(sha_file)
        expected = mapping.get(pgn_path.name)
        if not expected:
            return

        actual = sha256_file(pgn_path)
        if actual.lower() != expected.lower():
            raise ValueError(
                f"SHA256 mismatch for {pgn_path.name}\n"
                f"  expected: {expected}\n"
                f"  actual:   {actual}\n"
            )

    def _output_basename(self, filename: str) -> str:
        # "lichess_db_standard_rated_2013-01.pgn.zst" -> "lichess_db_standard_rated_2013-01"
        name = filename
        if name.endswith(".pgn.zst"):
            return name[: -len(".pgn.zst")]
        if name.endswith(".zst"):
            name = name[: -len(".zst")]
        if name.endswith(".pgn"):
            name = name[: -len(".pgn")]
        return name

    def _safe_year_from_utc_date(self, utc_date: str) -> Optional[int]:
        # utc_date is "YYYY.MM.DD"
        try:
            return int(utc_date.split(".")[0])
        except Exception:
            return None

    def _game_to_row(self, g: ParsedGame) -> dict:
        year = self._safe_year_from_utc_date(g.utc_date)
        return {
            "event": g.event,
            "site": g.site,
            "utc_date": g.utc_date,
            "year": year,
            "time_control_raw": g.time_control_raw,
            "time_control": g.time_control,
            "white_elo": g.white_elo,
            "black_elo": g.black_elo,
            "average_elo": g.average_elo,
            "result_raw": g.result_raw,
            "result_value": g.result_value,
            "eco": g.eco,
            "opening": g.opening,
            "has_eval": g.has_eval,
            "average_accuracy": g.average_accuracy,
            "average_accuracy_per_move_json": json.dumps(g.average_accuracy_per_move, ensure_ascii=False),
            "avg_accuracy_white": g.avg_accuracy_white,
            "avg_accuracy_black": g.avg_accuracy_black,
            "avg_accuracy_per_move_white_json": json.dumps(g.avg_accuracy_per_move_white, ensure_ascii=False),
            "avg_accuracy_per_move_black_json": json.dumps(g.avg_accuracy_per_move_black, ensure_ascii=False),
            "moves_json": json.dumps(g.moves, ensure_ascii=False),
            "pgn_source": g.pgn_source,
            "source_file": self.source_path.name,
        }
