from __future__ import annotations
from parser.parser import Parser
from parser.loader import Loader

def export() -> int:
    p = Parser(
        source_file="data/2013/lichess_db_standard_rated_2013-03.pgn.zst",
        eval_only=True,
        only_time_control_selection=True,
        sha_check=True,
    )

    # Print the first 3 games found
    # for game in p.test(3):
    #     print(game)
    
    # Export the games to a paruet file
    out_path = p.exportAll()   # -> parsed/lichess_db_standard_rated_2013-01.parquet
    print(out_path)

    p.printProfile()
    return 0

def load() -> int:
    loader = Loader()
    df = loader.load() # DataFrames
    games = loader.toGames() # ParsedGame objects
    s = loader.stats()
    print(s.total_games)
    print(s.by_time_control)
    print(s.by_year)

    # print(games[0])

    return 0

if __name__ == "__main__":
    raise SystemExit(load())