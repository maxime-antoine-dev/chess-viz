from __future__ import annotations
import sys
from parser.loader import Loader
from builder import get_builder

def run_builders() -> int:
    # 1. Charger tous les fichiers Parquet de 2013
    loader = Loader()
    print("🚀 Chargement des fichiers Parquet (2013)...")
    df = loader.load() 

    if df is None:
        print("❌ Erreur : Aucun DataFrame chargé.")
        return 1

    # 2. Exécuter le builder de Popularité (Visu #2)
    print("📊 Génération de popularity.json...")
    PopBuilder = get_builder("opening_popularity")
    b_pop = PopBuilder()
    # Le fichier sera créé dans data/builders/popularity.json
    b_pop.export(df, filename="popularity")

    # 3. Optionnel : Tu peux aussi lancer la Heatmap (Visu #3) ici
    # print("🔥 Génération de acc_heatmap.json...")
    # HeatmapBuilder = get_builder("opening_accuracy_heatmap")
    # b_heat = HeatmapBuilder(opening_moves=12)
    # b_heat.export(df, filename="acc_heatmap")

    print("✅ Exportation terminée avec succès !")
    return 0

if __name__ == "__main__":
    raise SystemExit(run_builders())