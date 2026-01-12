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
        "Sicilian Defense", "French Defense", "Caro-Kann Defense", "Scandinavian Defense",
        "Alekhine Defense", "Pirc Defense", "Modern Defense", "Dutch Defense",
        "Philidor Defense", "Petrov's Defense", "Italian Game", "Ruy Lopez",
        "Scotch Game", "Four Knights Game", "Vienna Game", "King's Gambit",
        "English Opening", "Queen's Gambit", "Slav Defense", "Semi-Slav Defense",
        "Nimzo-Indian Defense", "Queen's Indian Defense", "Bogo-Indian Defense",
        "King's Indian Defense", "Grünfeld Defense", "Benoni Defense", "Benko Gambit",
        "London System", "Catalan Opening", "Réti Opening", "Bird Opening",
        "Polish Opening", "Owen Defense", "Czech Defense", "Trompowsky Attack",
        "Veresov Opening", "Jobava London System", "Stonewall Attack",
    }

    def __init__(self, *, root=None, max_depth: int = 8, min_games: int = 0):
        super().__init__(root=root)
        self.max_depth = max_depth
        self.min_games = min_games

    def build(self, df: pl.DataFrame) -> Any:
        # On garde 'opening' entier pour extraire la variante plus tard
        df = df.select(["time_control", "average_elo", "opening", "moves_json", "result_value"])
        
        df = df.with_columns(
            rating_bracket=pl.when(pl.col("average_elo") < 1000).then(pl.lit("500-1000"))
            .when(pl.col("average_elo") < 1500).then(pl.lit("1000-1500"))
            .when(pl.col("average_elo") < 2000).then(pl.lit("1500-2000"))
            .otherwise(pl.lit("2000+")),
            # Pour le regroupement principal (famille)
            clean_opening=pl.col("opening").str.split(":").list.get(0).str.replace(r"\s#\d+", "").str.strip_chars()
        ).drop(["average_elo"]) # On conserve "opening" pour la variante

        output = {}
        moves_schema = pl.List(pl.Struct([pl.Field("move", pl.Utf8), pl.Field("eval", pl.Float64)]))

        groups = df.select(["time_control", "rating_bracket"]).unique().to_dicts()

        for g in groups:
            tc_key = g["time_control"].lower()
            if tc_key not in output: output[tc_key] = {}
            
            subset = df.filter(
                (pl.col("time_control") == g["time_control"]) & 
                (pl.col("rating_bracket") == g["rating_bracket"])
            )
            subset = subset.with_columns(pl.col("moves_json").str.json_decode(dtype=moves_schema))

            output[tc_key][g["rating_bracket"]] = self._build_recursive(subset, depth=0)

            del subset
            gc.collect()

        # Retourne formaté avec la clé 'opening_explorer' si besoin, ou direct
        return {"opening_explorer": output}

    def _build_recursive(self, df: pl.DataFrame, depth: int) -> List[Dict]:
        if depth >= self.max_depth or df.is_empty():
            return []
        
        df_active = df.filter(pl.col("moves_json").list.len() > depth)
        
        if df_active.is_empty():
            return []

        df_at_depth = df_active.with_columns(
            current_m=pl.col("moves_json").list.get(depth).struct.field("move")
        ).filter(pl.col("current_m").is_not_null())

        if df_at_depth.is_empty():
            return []

        # --- GESTION COMPLEXITÉ / LARGEUR ---
        # Si profondeur 0 ou 1 (les 2 premiers demi-coups) -> Top 10
        # Ensuite -> Top 3
        top_k = 10 if depth < 2 else 3

        stats = (
            df_at_depth.group_by("current_m")
            .agg([
                pl.len().alias("c"),
                ((pl.col("result_value") == 1).sum() / pl.len()).round(3).alias("w"),
                ((pl.col("result_value") == 0).sum() / pl.len()).round(3).alias("d_rate"),
                ((pl.col("result_value") == -1).sum() / pl.len()).round(3).alias("b"),
                
                # Nom de famille majoritaire
                pl.col("clean_opening").mode().first().alias("top_family"),
                
                # Nom complet majoritaire (pour extraire la variante)
                pl.col("opening").mode().first().alias("most_freq_fullname")
            ])
            .sort("c", descending=True)
            .head(top_k) # Largeur dynamique
        )

        nodes = []
        for row in stats.to_dicts():
            if row["c"] < self.min_games:
                continue

            # Extraction de la variante depuis "Family: Variant"
            variant_name = ""
            full_name = row["most_freq_fullname"]
            if full_name and ":" in full_name:
                parts = full_name.split(":", 1)
                if len(parts) > 1:
                    variant_name = parts[1].strip()

            sub_df = df_at_depth.filter(pl.col("current_m") == row["current_m"])
            
            node = {
                "move": row["current_m"],
                "name": row["top_family"],
                "variant": variant_name, # Nouvel attribut
                "count": row["c"],
                "stats": [row["w"], row["d_rate"], row["b"]]
            }

            children = self._build_recursive(sub_df, depth + 1)
            if children:
                node["children"] = children

            nodes.append(node)

        return nodes