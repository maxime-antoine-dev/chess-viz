from __future__ import annotations

import argparse
import itertools
from pathlib import Path
import sys
import datetime as dt

from parser.utils import load_sha256_sums, sha256_file
from parser.pgn_reader import parse_games, print_pgn_profile


def _ms_to_iso_utc(ts_ms: int) -> str:
    return dt.datetime.fromtimestamp(ts_ms / 1000.0, tz=dt.timezone.utc).isoformat(timespec="seconds")


def _resolve_pgn_path(root: Path, month: str | None, explicit_path: str | None) -> Path:
    data_root = root / "data"

    if explicit_path:
        p = Path(explicit_path)
        if not p.is_absolute():
            p = (root / p).resolve()
        if not p.exists():
            raise FileNotFoundError(f"PGN file not found: {p}")
        return p

    if month:
        year = month.split("-")[0]
        fname = f"lichess_db_standard_rated_{month}.pgn.zst"
        p = data_root / year / fname
        if not p.exists():
            raise FileNotFoundError(f"PGN file not found for month={month}: {p}")
        return p

    candidates = sorted(data_root.glob("*/*lichess_db_standard_rated_*.pgn.zst"))
    if not candidates:
        raise FileNotFoundError(
            f"No .pgn.zst files found under {data_root}. "
            f"Expected something like data/2013/lichess_db_standard_rated_2013-01.pgn.zst"
        )
    return candidates[0]


def _maybe_verify_sha256(root: Path, pgn_path: Path) -> None:
    sha_file = root / "data" / "sha256sums.txt"
    if not sha_file.exists():
        print(f"[WARN] sha256sums.txt not found at: {sha_file} (skipping SHA check)", file=sys.stderr)
        return

    mapping = load_sha256_sums(sha_file)

    key = pgn_path.name
    expected = mapping.get(key)
    if not expected:
        print(f"[WARN] No SHA entry for {key} in {sha_file} (skipping SHA check)", file=sys.stderr)
        return

    print("[INFO] Computing SHA256 (this may take a bit on large files)...", file=sys.stderr)
    actual = sha256_file(pgn_path)

    if actual.lower() != expected.lower():
        print(
            f"[ERROR] SHA256 mismatch for {key}\n"
            f"  expected: {expected}\n"
            f"  actual:   {actual}\n",
            file=sys.stderr,
        )
    else:
        print(f"[OK] SHA256 verified for {key}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse a Lichess .pgn.zst file and print the first 3 games.")
    parser.add_argument("--month", type=str, default=None, help="Month to parse, format YYYY-MM (e.g. 2013-01).")
    parser.add_argument("--path", type=str, default=None, help="Explicit path to a .pgn.zst file.")
    parser.add_argument("--no-sha-check", action="store_true", help="Skip SHA256 verification.")
    parser.add_argument(
        "--only-eval",
        action="store_true",
        help="Only keep games that contain at least one engine evaluation ([%eval ...]).",
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    pgn_path = _resolve_pgn_path(root, args.month, args.path)

    print(f"[INFO] Using file: {pgn_path}", file=sys.stderr)
    if not args.no_sha_check:
        _maybe_verify_sha256(root, pgn_path)

    games_iter = parse_games(pgn_path)
    if args.only_eval:
        games_iter = (game for game in games_iter if game.header.has_eval)

    for game in itertools.islice(games_iter, 3):
        g = game.header

        print("event : " + str(g.event))
        print("timeControl : " + str(g.time_control_raw))
        print("site : " + str(g.site))
        print("eloWhite : " + str(g.white_elo))
        print("eloBlack : " + str(g.black_elo))
        print("result : " + str(g.result))
        print("UTCDate : " + _ms_to_iso_utc(g.ts_ms))
        print("eco : " + str(g.eco))
        print("opening : " + str(g.opening))
        print("moveArray : " + str(game.moves_san))
        print("")

    print_pgn_profile()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
