from __future__ import annotations

import polars as pl

from ..base import BaseBuilder
from ..registry import register_builder

# Simple demo builder exporting basic stats

@register_builder
class StatsBuilder(BaseBuilder):
    name = "stats"

    def build(self, df: pl.DataFrame) -> dict:
        if df is None or df.is_empty():
            return {
                "total_games": 0,
                "by_time_control": {},
                "by_year": {},
            }

        total = df.height

        by_tc_df = (
            df.group_by("time_control")
            .len()
            .sort("len", descending=True)
        )
        by_tc = {str(r[0]): int(r[1]) for r in by_tc_df.iter_rows()}

        by_year_df = (
            df.group_by("year")
            .len()
            .sort("year")
        )
        by_year = {}
        for y, n in by_year_df.iter_rows():
            if y is None:
                continue
            by_year[int(y)] = int(n)

        return {
            "total_games": int(total),
            "by_time_control": by_tc,
            "by_year": by_year,
        }
