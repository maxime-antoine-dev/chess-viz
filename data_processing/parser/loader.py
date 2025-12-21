from __future__ import annotations

import json
import sys
import time
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

    - load()      -> loads all parquet files in the folder (with progress bar by total bytes)
    - loadFile()  -> loads a single parquet file by name
    - stats()     -> basic stats: total, by time control, by year
    - toGames()   -> rehydrate to ParsedGame objects (with progress bar by rows)

    Now also prints total duration for each step.
    """

    def __init__(self, *, parsed_dir: Union[str, Path] = "parsed", root: Optional[Path] = None) -> None:
        self.root = root or Path(__file__).resolve().parents[1]
        self.parsed_dir = Path(parsed_dir)
        if not self.parsed_dir.is_absolute():
            self.parsed_dir = (self.root / self.parsed_dir).resolve()

        self.df: Optional[pl.DataFrame] = None

    def load(
        self,
        *,
        progress: bool = True,
        progress_min_interval_s: float = 0.15,
        bar_width: int = 28,
    ) -> pl.DataFrame:
        t_all0 = time.perf_counter()

        self.parsed_dir.mkdir(parents=True, exist_ok=True)
        files = sorted(self.parsed_dir.glob("*.parquet"))
        if not files:
            self.df = pl.DataFrame()
            if progress:
                dt_all = time.perf_counter() - t_all0
                print(f"[LOAD] no files found (took {dt_all:.3f}s)", file=sys.stderr)
            return self.df

        t_list0 = time.perf_counter()
        total_bytes = sum(f.stat().st_size for f in files)
        bytes_done = 0
        dt_list = time.perf_counter() - t_list0

        last_print_t = 0.0
        start_t = time.perf_counter()

        def render_bar(p: float) -> str:
            p = max(0.0, min(1.0, p))
            filled = int(p * bar_width)
            return "[" + ("#" * filled) + ("-" * (bar_width - filled)) + "]"

        def maybe_print(force: bool = False) -> None:
            nonlocal last_print_t
            if not progress:
                return

            now = time.perf_counter()
            if not force and (now - last_print_t) < progress_min_interval_s:
                return
            last_print_t = now

            pct = (bytes_done / total_bytes) if total_bytes > 0 else 1.0
            elapsed = now - start_t
            speed_mb_s = (bytes_done / (1024 * 1024) / elapsed) if elapsed > 0 else 0.0

            bar = render_bar(pct)
            msg = (
                f"\r{bar} {pct*100:6.2f}% "
                f"bytes={bytes_done:,}/{total_bytes:,} "
                f"({speed_mb_s:,.1f} MB/s)"
            )
            print(msg, end="", file=sys.stderr, flush=True)

        frames: List[pl.DataFrame] = []

        t_read0 = time.perf_counter()
        for f in files:
            frames.append(pl.read_parquet(f))
            bytes_done += f.stat().st_size
            maybe_print()
        dt_read = time.perf_counter() - t_read0

        if progress:
            maybe_print(force=True)
            print("", file=sys.stderr)

        t_concat0 = time.perf_counter()
        self.df = pl.concat(frames, how="vertical", rechunk=True) if len(frames) > 1 else frames[0]
        dt_concat = time.perf_counter() - t_concat0

        dt_all = time.perf_counter() - t_all0
        if progress:
            print(
                f"[LOAD] files={len(files)} total_bytes={total_bytes:,} "
                f"t(list)={dt_list:.3f}s t(read)={dt_read:.3f}s t(concat)={dt_concat:.3f}s t(total)={dt_all:.3f}s",
                file=sys.stderr,
            )

        return self.df

    def loadFile(self, name: str, *, set_as_current: bool = True) -> pl.DataFrame:
        fname = name if name.endswith(".parquet") else f"{name}.parquet"
        path = self.parsed_dir / fname
        if not path.exists():
            raise FileNotFoundError(f"Parquet file not found: {path}")

        df = pl.read_parquet(path)
        if set_as_current:
            self.df = df
        return df

    def stats(self) -> LoaderStats:
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

    def toGames(
        self,
        *,
        limit: Optional[int] = None,
        progress: bool = True,
        progress_min_interval_s: float = 0.15,
        bar_width: int = 28,
    ) -> List[ParsedGame]:
        """
        Rehydrate the loaded DataFrame into ParsedGame objects.
        Adds per-step timings (dict conversion, JSON parsing+object creation, total).
        """
        t_all0 = time.perf_counter()

        if self.df is None:
            t_autoload0 = time.perf_counter()
            self.load(progress=progress)
            dt_autoload = time.perf_counter() - t_autoload0
        else:
            dt_autoload = 0.0

        if self.df is None or self.df.is_empty():
            dt_all = time.perf_counter() - t_all0
            if progress:
                print(f"[TOGAMES] empty dataframe (t(total)={dt_all:.3f}s)", file=sys.stderr)
            return []

        df = self.df if limit is None else self.df.head(limit)
        total = df.height

        t_cols0 = time.perf_counter()
        cols = df.to_dict(as_series=False)
        dt_cols = time.perf_counter() - t_cols0

        def jloads_list(s: Optional[str]) -> list:
            if not s:
                return []
            return json.loads(s)

        last_print_t = 0.0
        start_t = time.perf_counter()

        def render_bar(p: float) -> str:
            p = max(0.0, min(1.0, p))
            filled = int(p * bar_width)
            return "[" + ("#" * filled) + ("-" * (bar_width - filled)) + "]"

        def maybe_print(done: int, force: bool = False) -> None:
            nonlocal last_print_t
            if not progress:
                return

            now = time.perf_counter()
            if not force and (now - last_print_t) < progress_min_interval_s:
                return
            last_print_t = now

            pct = (done / total) if total > 0 else 1.0
            elapsed = now - start_t
            speed = (done / elapsed) if elapsed > 0 else 0.0

            bar = render_bar(pct)
            msg = f"\r{bar} {pct*100:6.2f}% toGames={done:,}/{total:,} ({speed:,.0f} g/s)"
            print(msg, end="", file=sys.stderr, flush=True)

        games: List[ParsedGame] = []
        games_append = games.append

        t_build0 = time.perf_counter()
        for i in range(total):
            games_append(
                ParsedGame(
                    event=cols.get("event", [None])[i],
                    site=cols.get("site", [None])[i],
                    utc_date=cols["utc_date"][i],
                    time_control_raw=cols["time_control_raw"][i],
                    time_control=cols["time_control"][i],
                    white_elo=cols.get("white_elo", [None])[i],
                    black_elo=cols.get("black_elo", [None])[i],
                    average_elo=cols.get("average_elo", [None])[i],
                    result_raw=cols["result_raw"][i],
                    result_value=int(cols["result_value"][i]),
                    eco=cols.get("eco", [None])[i],
                    opening=cols.get("opening", [None])[i],
                    has_eval=bool(cols["has_eval"][i]),
                    average_accuracy=cols.get("average_accuracy", [None])[i],
                    average_accuracy_per_move=jloads_list(cols.get("average_accuracy_per_move_json", ["[]"])[i]),
                    avg_accuracy_white=cols.get("avg_accuracy_white", [None])[i],
                    avg_accuracy_black=cols.get("avg_accuracy_black", [None])[i],
                    avg_accuracy_per_move_white=jloads_list(cols.get("avg_accuracy_per_move_white_json", ["[]"])[i]),
                    avg_accuracy_per_move_black=jloads_list(cols.get("avg_accuracy_per_move_black_json", ["[]"])[i]),
                    moves=jloads_list(cols.get("moves_json", ["[]"])[i]),
                    pgn_source=(cols.get("pgn_source", [""])[i] or ""),
                )
            )

            maybe_print(i + 1)

        dt_build = time.perf_counter() - t_build0

        if progress:
            maybe_print(total, force=True)
            print("", file=sys.stderr)

        dt_all = time.perf_counter() - t_all0

        if progress:
            print(
                f"[TOGAMES] rows={total:,} "
                f"t(autoload)={dt_autoload:.3f}s t(to_dict)={dt_cols:.3f}s t(build+json)={dt_build:.3f}s "
                f"t(total)={dt_all:.3f}s",
                file=sys.stderr,
            )

        return games
