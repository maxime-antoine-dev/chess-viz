from __future__ import annotations

import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional, Union

import polars as pl

@dataclass(frozen=True)
class BuildResult:
    builder: str
    created_at_unix: int
    payload: Any

# Base class for all builders.
class BaseBuilder(ABC):
    # Name used in folder: json/<name>/
    name: str = "base"

    def __init__(self, *, root: Optional[Path] = None) -> None:
        # root should be data_processing/ by default
        self.root = root or Path(__file__).resolve().parents[1]

    @abstractmethod
    # Produce the JSON payload from an input DataFrame.
    def build(self, df: pl.DataFrame) -> Any:
        raise NotImplementedError

    # Export helpers
    def export(
        self,
        df: pl.DataFrame,
        *,
        filename: Optional[str] = None,
        out_dir: Union[str, Path] = "json",
        pretty: bool = True,
        ensure_ascii: bool = False,
    ) -> Path:
        # Build + export as a JSON file in: <root>/<out_dir>/<builderName>/<filename>.json
        # If filename is None, we generate one automatically.
        
        out_root = Path(out_dir)
        if not out_root.is_absolute():
            out_root = (self.root / out_root).resolve()

        target_dir = out_root / self.name
        target_dir.mkdir(parents=True, exist_ok=True)

        if filename is None:
            filename = self.default_filename(df)

        if not filename.endswith(".json"):
            filename = f"{filename}.json"

        payload = self.build(df)

        wrapped = BuildResult(
            builder=self.name,
            created_at_unix=int(time.time()),
            payload=payload,
        )

        out_path = target_dir / filename
        out_path.write_text(
            json.dumps(
                wrapped.__dict__,
                indent=2 if pretty else None,
                ensure_ascii=ensure_ascii,
                default=self._json_default,
            ),
            encoding="utf-8",
        )
        return out_path

    # Default output filename if none provided.
    def default_filename(self, df: pl.DataFrame) -> str:
        base = "all"
        if df is not None and not df.is_empty() and "source_file" in df.columns:
            try:
                uniq = df.select(pl.col("source_file").unique()).to_series().to_list()
                uniq = [x for x in uniq if x]
                if len(uniq) == 1:
                    base = str(uniq[0]).replace(".parquet", "").replace(".pgn.zst", "")
            except Exception:
                pass

        ts = int(time.time())
        return f"{base}_{self.name}_{ts}"

    # JSON fallback for non-serializable values (polars/numpy types, Path, etc.)
    def _json_default(self, obj: Any) -> Any:

        if isinstance(obj, Path):
            return str(obj)

        # Polars sometimes returns Int64/Float64 scalar types, which are JSON-serializable
        # but if anything weird comes through, stringifying is safe.
        try:
            import numpy as np  # type: ignore

            if isinstance(obj, (np.integer, np.floating)):
                return obj.item()
            if isinstance(obj, np.ndarray):
                return obj.tolist()
        except Exception:
            pass

        # Fallback: try to cast to primitive
        if hasattr(obj, "__dict__"):
            return obj.__dict__

        return str(obj)
