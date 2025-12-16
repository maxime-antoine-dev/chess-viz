# main.py
from __future__ import annotations

import argparse

from parser.parser import Parser


def main() -> int:
    p = Parser(
        source_file="data/2013/lichess_db_standard_rated_2013-01.pgn.zst",
        eval_only=True,
        sha_check=True,
    )

    # Print the first 3 games found
    for game in p.test(3):
        print(game)
    
    # Get all games (takes around 1m30s for 01/2013)
    # allGames = p.getAll()

    p.printProfile()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())