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

    for game in p.test(3):
        print("event : " + str(game.event))
        print("timeControl : " + str(game.time_control))
        print("site : " + str(game.site))
        print("eloWhite : " + str(game.white_elo))
        print("eloBlack : " + str(game.black_elo))
        print("averageElo : " + str(game.average_elo))
        print("result : " + str(game.result_value))
        print("UTCDate : " + str(game.utc_date))
        print("eco : " + str(game.eco))
        print("opening : " + str(game.opening))
        print("avgAccuracyWhite : " + str(game.avg_accuracy_white))
        print("avgAccuracyBlack : " + str(game.avg_accuracy_black))
        print("avgAccuracyPerMoveWhite : " + str(game.avg_accuracy_per_move_white))
        print("avgAccuracyPerMoveBlack : " + str(game.avg_accuracy_per_move_black))
        print("moveArray : " + str(game.moves))
        print("")

    p.printProfile()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())