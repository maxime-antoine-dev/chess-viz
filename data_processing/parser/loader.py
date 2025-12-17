from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Union

import polars as pl

from .models import ParsedGame


@dataclass
class LoaderStats:
    total_games: int
    by_time_control: Dict[str, int]
    by_year: Dict[int, int]


class Loader:
    """
    Loads parquet files produced by Parser.exportAll() from a folder (default: <root>/parsed).

    - load()      -> loads all parquet files in the folder
    - loadFile()  -> loads a single parquet file by name
    - stats()     -> basic stats: total, by time control, by year

    Optionally you can rehydrate rows into ParsedGame objects with toGames().
    """

    def __init__(self, *, parsed_dir: Union[str, Path] = "parsed", root: Optional[Path] = None) -> None:
        self.root = root or Path(__file__).resolve().parents[1]
        self.parsed_dir = Path(parsed_dir)
        if not self.parsed_dir.is_absolute():
            self.parsed_dir = (self.root / self.parsed_dir).resolve()

        self.df: Optional[pl.DataFrame] = None

    def load(self) -> pl.DataFrame:
        """
        Load all parquet files from parsed_dir into a single DataFrame.
        """
        self.parsed_dir.mkdir(parents=True, exist_ok=True)
        files = sorted(self.parsed_dir.glob("*.parquet"))
        if not files:
            self.df = pl.DataFrame()
            return self.df

        frames = [pl.read_parquet(f) for f in files]
        self.df = pl.concat(frames, how="vertical", rechunk=True) if len(frames) > 1 else frames[0]
        return self.df

    def loadFile(self, name: str) -> pl.DataFrame:
        """
        Load a single parquet file by name (with or without ".parquet").
        Does NOT merge into self.df automatically (returns the file DataFrame).
        """
        fname = name if name.endswith(".parquet") else f"{name}.parquet"
        path = self.parsed_dir / fname
        if not path.exists():
            raise FileNotFoundError(f"Parquet file not found: {path}")
        return pl.read_parquet(path)

    def stats(self) -> LoaderStats:
        """
        Stats about currently loaded data.
        If nothing is loaded yet, it will auto-load() first.
        """
        if self.df is None:
            self.load()

        if self.df is None or self.df.is_empty():
            return LoaderStats(total_games=0, by_time_control={}, by_year={})

        total = self.df.height

        by_tc = (
            self.df.group_by("time_control")
            .len()
            .sort("len", descending=True)
            .to_dict(as_series=False)
        )
        by_time_control = {k: int(v) for k, v in zip(by_tc.get("time_control", []), by_tc.get("len", []))}

        by_y = (
            self.df.group_by("year")
            .len()
            .sort("year")
            .to_dict(as_series=False)
        )
        by_year = {int(k): int(v) for k, v in zip(by_y.get("year", []), by_y.get("len", [])) if k is not None}

        return LoaderStats(total_games=total, by_time_control=by_time_control, by_year=by_year)

    def toGames(self, *, limit: Optional[int] = None) -> List[ParsedGame]:
        """
        Rehydrate the loaded DataFrame into ParsedGame objects.
        (This can be heavy; use limit for quick tests.)
        """
        if self.df is None:
            self.load()

        if self.df is None or self.df.is_empty():
            return []

        df = self.df if limit is None else self.df.head(limit)

        games: List[ParsedGame] = []
        for row in df.iter_rows(named=True):
            games.append(
                ParsedGame(
                    event=row.get("event"),
                    site=row.get("site"),
                    utc_date=row["utc_date"],
                    time_control_raw=row["time_control_raw"],
                    time_control=row["time_control"],
                    white_elo=row.get("white_elo"),
                    black_elo=row.get("black_elo"),
                    average_elo=row.get("average_elo"),
                    result_raw=row["result_raw"],
                    result_value=int(row["result_value"]),
                    eco=row.get("eco"),
                    opening=row.get("opening"),
                    has_eval=bool(row["has_eval"]),
                    average_accuracy=row.get("average_accuracy"),
                    average_accuracy_per_move=json.loads(row["average_accuracy_per_move_json"] or "[]"),
                    avg_accuracy_white=row.get("avg_accuracy_white"),
                    avg_accuracy_black=row.get("avg_accuracy_black"),
                    avg_accuracy_per_move_white=json.loads(row["avg_accuracy_per_move_white_json"] or "[]"),
                    avg_accuracy_per_move_black=json.loads(row["avg_accuracy_per_move_black_json"] or "[]"),
                    moves=json.loads(row["moves_json"] or "[]"),
                    pgn_source=row.get("pgn_source") or "",
                )
            )

        return games
