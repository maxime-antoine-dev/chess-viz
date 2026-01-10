from .base import BaseBuilder
from .registry import get_builder, list_builders, register_builder

# Import builders so they auto-register
from .builders.stats_builder import StatsBuilder
from .builders.opening_accuracy_heatmap_builder import OpeningAccuracyHeatmapBuilder  # noqa: F401
from .builders.popularity_builder import PopularityBuilder
from .builders.opening_explorer_builder import OpeningExplorerBuilder

__all__ = [
    "BaseBuilder",
    "register_builder",
    "get_builder",
    "list_builders",
]
