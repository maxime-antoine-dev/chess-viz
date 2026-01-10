import polars as pl
from typing import Any, Dict, List, Optional, Tuple
from ..base import BaseBuilder
from ..registry import register_builder

@register_builder
class PopularityBuilder(BaseBuilder):
    name = "opening_popularity"

    ALLOWED_TIME_CONTROLS = {"BLITZ", "RAPID", "BULLET"}
    ELO_BRACKETS = ["0-500", "500-1000", "1000-1500", "1500-2000", "2000+"]

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
        #"Queen's Pawn Game","King's Pawn Game",
    }

    def __init__(
        self,
        *,
        root=None,
        max_openings_per_bucket: Optional[int] = None,
        min_samples_per_opening: int = 0,
        group_unlisted_to_other: bool = False,
        other_label: str = "Other",
    ) -> None:
        super().__init__(root=root)
        self.max_openings_per_bucket = max_openings_per_bucket
        self.min_samples_per_opening = min_samples_per_opening
        self.group_unlisted_to_other = group_unlisted_to_other
        self.other_label = other_label

    def build(self, df: pl.DataFrame) -> Any:
        df = df.filter(pl.col("time_control").is_in(self.ALLOWED_TIME_CONTROLS))

        df = df.with_columns([
            pl.col("opening")
                .str.split(":").list.get(0)          # Garde la famille
                .str.replace(r"\s#\d+", "")          # Supprime " #2", " #3" etc.
                .str.replace(r"Queen's Gambit.*", "Queen's Gambit") # Regroupe Declined/Accepted/Refused
                .str.replace(r"Queen's Pawn", "Queen's Pawn Game") 
                .str.strip_chars()
                .alias("opening_root"),
            
            pl.when(pl.col("average_elo") < 500).then(pl.lit("0-500"))
                .when(pl.col("average_elo") < 1000).then(pl.lit("500-1000"))
                .when(pl.col("average_elo") < 1500).then(pl.lit("1000-1500"))
                .when(pl.col("average_elo") < 2000).then(pl.lit("1500-2000"))
                .otherwise(pl.lit("2000+"))
                .alias("rating_bracket")
        ])

        df = df.with_columns(
            true_color=pl.when(pl.col("opening_root").str.contains("(?i)Defense|Indian|Scandinavian|Pirc|Caro-Kann|Benoni|Czech|Owen|Philidor|Petrov|Alekhine|Modern|Dutch|Slav"))
            .then(pl.lit("black"))
            .otherwise(pl.lit("white"))
        )

        totals = df.group_by(["time_control", "rating_bracket"]).len().rename({"len": "total_in_group"})
        
        if self.group_unlisted_to_other:
            df = df.with_columns(
                opening_name=pl.when(pl.col("opening_root").is_in(self.OPENING_WHITELIST))
                .then(pl.col("opening_root"))
                .otherwise(pl.lit(self.other_label))
            )
        else:
            df = df.filter(pl.col("opening_root").is_in(self.OPENING_WHITELIST))
            df = df.with_columns(pl.col("opening_root").alias("opening_name"))

        # --- ANALYSE DE LA CATÉGORIE "OTHER" (Commentaires conservés) ---
        # total_games = len(df)
        # others_df = df.filter(~pl.col("opening_root").is_in(self.OPENING_WHITELIST))
        # others_analysis = (
        #     others_df.group_by("opening_root")
        #     .len()
        #     .rename({"len": "game_count"})
        #     .with_columns(percentage=(pl.col("game_count") / total_games * 100).round(2))
        #     .sort("game_count", descending=True)
        # )
        # print(others_analysis.head(30))
        # -------------------------------------------------------------

        stats = (
            df.group_by(["time_control", "rating_bracket", "opening_name", "true_color"])
            .agg([
                pl.len().alias("count"),
                (pl.col("result_value") == 1).sum().alias("w_wins"),
                (pl.col("result_value") == -1).sum().alias("b_wins"),
                (pl.col("result_value") == 0).sum().alias("draws"),
            ])
        )

        final_stats = stats.join(totals, on=["time_control", "rating_bracket"])
        final_stats = final_stats.with_columns(
            popularity=(pl.col("count") / pl.col("total_in_group")).round(4),
            r_white=(pl.col("w_wins") / pl.col("count")).round(4),
            r_draw=(pl.col("draws") / pl.col("count")).round(4),
            r_black=(pl.col("b_wins") / pl.col("count")).round(4),
        ).with_columns(
            win_rate_triplet=pl.concat_list([pl.col("r_white"), pl.col("r_draw"), pl.col("r_black")])
        )

        output = {}
        for (tc, bracket), group_df in final_stats.partition_by(["time_control", "rating_bracket"], as_dict=True).items():
            tc_key = str(tc).lower()
            if tc_key not in output:
                output[tc_key] = {}

            processed_group = (
                group_df.filter(pl.col("count") >= self.min_samples_per_opening)
                .sort("popularity", descending=True)
            )
            
            if self.max_openings_per_bucket is not None:
                processed_group = processed_group.head(self.max_openings_per_bucket)

            output[tc_key][bracket] = (
                processed_group.select([
                    pl.col("opening_name").alias("name"),
                    "popularity",
                    pl.col("true_color").alias("color"),
                    "count",
                    pl.col("win_rate_triplet").alias("win_rate")
                ])
                .to_dicts()
            )
            
        return output