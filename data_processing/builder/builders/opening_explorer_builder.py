import polars as pl
import json
import gc
from typing import Any, Dict, List, Optional
from ..base import BaseBuilder
from ..registry import register_builder

@register_builder
class OpeningExplorerBuilder(BaseBuilder):
    name = "opening_explorer"

    ALLOWED_TIME_CONTROLS = {"BLITZ", "RAPID", "BULLET"}
    
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
        # "Queen's Pawn Game",
        # "King's Pawn Game",
    }

    def __init__(self, *, root=None, max_depth: int = 10, min_games: int = 0):
        super().__init__(root=root)
        self.max_depth = max_depth
        self.min_games = min_games

    def build(self, df: pl.DataFrame) -> Any:
        df = df.select(["time_control", "average_elo", "opening", "moves_json", "result_value"])
        
        df = df.with_columns(
            rating_bracket=pl.when(pl.col("average_elo") < 1000).then(pl.lit("500-1000"))
            .when(pl.col("average_elo") < 1500).then(pl.lit("1000-1500"))
            .when(pl.col("average_elo") < 2000).then(pl.lit("1500-2000"))
            .otherwise(pl.lit("2000+")),
            clean_opening=pl.col("opening").str.split(":").list.get(0).str.replace(r"\s#\d+", "").str.strip_chars()
        ).drop(["opening", "average_elo"])

        output = {}
        moves_schema = pl.List(pl.Struct([pl.Field("move", pl.Utf8), pl.Field("eval", pl.Float64)]))

        groups = df.select(["time_control", "rating_bracket"]).unique().to_dicts()

        for g in groups:
            tc_key = g["time_control"].lower()
            if tc_key not in output: output[tc_key] = {}
            
            subset = df.filter((pl.col("time_control") == g["time_control"]) & (pl.col("rating_bracket") == g["rating_bracket"]))
            subset = subset.with_columns(pl.col("moves_json").str.json_decode(dtype=moves_schema))

            output[tc_key][g["rating_bracket"]] = self._build_recursive(subset, depth=0)

            del subset
            gc.collect()

        return output

    def _build_recursive(self, df: pl.DataFrame, depth: int) -> List[Dict]:
        if depth >= self.max_depth or df.is_empty():
            return []
        
        # Filtre les parties qui ont assez de coups
        df_active = df.filter(pl.col("moves_json").list.len() > depth)
        
        if df_active.is_empty():
            return []

        # Récupère le coup à la profondeur actuelle
        df_at_depth = df_active.with_columns(
            current_m=pl.col("moves_json").list.get(depth).struct.field("move")
        ).filter(pl.col("current_m").is_not_null())

        if df_at_depth.is_empty():
            return []

        # CORRECTION ICI : On groupe uniquement par "current_m"
        stats = (
            df_at_depth.group_by("current_m")
            .agg([
                pl.len().alias("c"),
                ((pl.col("result_value") == 1).sum() / pl.len()).round(3).alias("w"),
                ((pl.col("result_value") == 0).sum() / pl.len()).round(3).alias("d_rate"),
                ((pl.col("result_value") == -1).sum() / pl.len()).round(3).alias("b"),
                pl.col("clean_opening").mode().first().alias("top_opening_name")
            ])
            .sort("c", descending=True)
            .head(3)
        )

        nodes = []
        for row in stats.to_dicts():
            if row["c"] < self.min_games:
                continue

            # On filtre pour passer SEULEMENT les parties de ce coup aux enfants
            sub_df = df_at_depth.filter(pl.col("current_m") == row["current_m"])
            
            node = {
                "move": row["current_m"],
                "name": row["top_opening_name"], # Ex: "Sicilian Defense" si c'est la majorité après e4
                "count": row["c"],
                "stats": [row["w"], row["d_rate"], row["b"]]
            }

            # Récursion
            children = self._build_recursive(sub_df, depth + 1)
            if children:
                node["children"] = children

            nodes.append(node)

        return nodes