# parser/pgn_reader.py
from __future__ import annotations

from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional, Tuple
import io
import re
import datetime as dt
import time
import sys

import zstandard as zstd

from .models import ParsedGame
from .game_helpers import (
    compute_accuracy_metrics_from_moves,
    compute_average_elo,
    normalize_moves_in_place,
    normalize_result_value,
    normalize_time_control_bucket,
    ts_ms_to_utc_date,
)

# Tiny, lightweight profiling to see where time goes while parsing large PGN dumps
PGN_PROFILE: Dict[str, float] = {
    "parse_games": 0.0,
    "extract_moves": 0.0,
}

# Print the PGN profile (after parsing)
def print_pgn_profile() -> None:
    # Nothing fancy: just dump the accumulated timers to stderr
    if not PGN_PROFILE:
        return
    print("\n[PGN PROFILE] Internal timings (seconds):", file=sys.stderr)
    for name, seconds in sorted(PGN_PROFILE.items(), key=lambda kv: kv[1], reverse=True):
        print(f"  {name:25s}: {seconds:10.3f}", file=sys.stderr)


# PGN tag lines like: [Key "Value"]
TAG_RE = re.compile(r'^\[(\w+)\s+"(.*)"\]$')

# Extract engine evals inside comments, e.g. { [%eval 0.17] ... }
EVAL_RE = re.compile(r"\[%eval\s+([^\]]+)\]")


def _parse_ts_ms_from_tags(tags: Dict[str, str]) -> Optional[int]:
    # Lichess provides UTCDate + UTCTime; fall back to Date if needed
    utc_date = tags.get("UTCDate") or tags.get("Date")
    utc_time = tags.get("UTCTime") or "00:00:00"
    if not utc_date or utc_date == "????.??.??":
        return None

    try:
        dt_obj = dt.datetime.strptime(f"{utc_date} {utc_time}", "%Y.%m.%d %H:%M:%S")
    except ValueError:
        # Sometimes time is missing or malformed; best effort is to assume midnight
        try:
            dt_obj = dt.datetime.strptime(f"{utc_date} 00:00:00", "%Y.%m.%d %H:%M:%S")
        except ValueError:
            return None

    return int(dt_obj.replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def _parse_eval_value(raw: str) -> Optional[float]:
    # We ignore mate scores like "#3" or "#-1" (not comparable as floats)
    s = raw.strip()
    if s.startswith("#"):
        return None
    try:
        return float(s)
    except ValueError:
        return None

def _reconstruct_pgn_source(tags: Dict[str, str], movetext_raw: str) -> str:
    # Rebuild a "pretty normal" PGN: tags block, blank line, then movetext
    header_lines = [f'[{k} "{v}"]' for k, v in tags.items()]
    return "\n".join(header_lines) + "\n\n" + movetext_raw.strip() + "\n"


def _is_move_number(tok: str) -> bool:
    # Matches "1." / "1..." / "23..." etc (same spirit as re.fullmatch(r"\d+\.+", tok))
    if not tok or "." not in tok:
        return False
    for c in tok:
        if not (c.isdigit() or c == "."):
            return False
    return any(c.isdigit() for c in tok)


def _extract_moves_with_eval(movetext_flat: str) -> List[Dict[str, Optional[float]]]:
    # Single-pass move + eval extraction:
    # - avoids building a token list (big speed win)
    # - keeps identical semantics: SAN moves, eval comes from the following { ... } comment
    t0 = time.perf_counter()

    moves: List[Dict[str, Optional[float]]] = []
    last_move_index: Optional[int] = None

    n = len(movetext_flat)
    i = 0

    while i < n:
        c = movetext_flat[i]

        # Skip whitespace quickly
        if c.isspace():
            i += 1
            continue

        # Curly-brace comment: { ... }
        if c == "{":
            j = movetext_flat.find("}", i + 1)
            if j == -1:
                # Corrupted/unfinished comment: just stop at the end
                j = n - 1

            if last_move_index is not None:
                comment = movetext_flat[i + 1 : j]

                # Fast guard: most comments don't contain eval
                if "[%eval" in comment:
                    m = EVAL_RE.search(comment)
                    if m:
                        ev = _parse_eval_value(m.group(1))
                        moves[last_move_index]["eval"] = ev

            i = j + 1
            continue

        # Otherwise it's a token: read until whitespace or '{'
        j = i
        while j < n and (not movetext_flat[j].isspace()) and movetext_flat[j] != "{":
            j += 1
        tok = movetext_flat[i:j]
        i = j

        # Filter out non-move tokens we don't want to treat as SAN
        if tok in ("1-0", "0-1", "1/2-1/2", "*"):
            continue
        if tok.startswith("$"):
            continue
        if _is_move_number(tok):
            continue

        moves.append({"move": tok, "eval": None})
        last_move_index = len(moves) - 1

    PGN_PROFILE["extract_moves"] += time.perf_counter() - t0
    return moves


def _parse_pgn_stream_zst(
    raw_path: Path,
    *,
    progress_hook: Optional[Callable[[int, int], None]] = None,
    progress_every_bytes: int = 8 * (1 << 20),  # 8MB default
) -> Iterable[Tuple[Dict[str, str], str, str]]:
    """
    Stream a .pgn.zst file and yield (tags_dict, movetext_flat, movetext_raw) per game.
    """
    total_bytes = raw_path.stat().st_size
    last_report_pos = 0

    with raw_path.open("rb") as fh:
        dctx = zstd.ZstdDecompressor()
        with dctx.stream_reader(fh) as reader:
            text_stream = io.TextIOWrapper(reader, encoding="utf-8", errors="replace")

            tags: Dict[str, str] = {}
            movetext_lines: List[str] = []
            mode = "search_header"

            for line in text_stream:
                line = line.rstrip("\n")

                # Lightweight progress hook (based on compressed bytes)
                if progress_hook is not None:
                    pos = fh.tell()
                    if pos - last_report_pos >= progress_every_bytes:
                        last_report_pos = pos
                        progress_hook(pos, total_bytes)

                if mode in ("search_header", "header"):
                    if line.startswith("["):
                        mode = "header"
                        m = TAG_RE.match(line.strip())
                        if m:
                            key, val = m.group(1), m.group(2)
                            tags[key] = val
                    elif line.strip() == "":
                        continue
                    else:
                        # First non-tag, non-empty line -> movetext begins
                        movetext_lines = [line.rstrip()]
                        mode = "moves"

                elif mode == "moves":
                    if line.strip() == "":
                        # Blank line ends a game entry
                        if tags:
                            movetext_raw = "\n".join(movetext_lines)
                            movetext_flat = " ".join(s.strip() for s in movetext_lines if s.strip())
                            yield tags, movetext_flat, movetext_raw
                        tags = {}
                        movetext_lines = []
                        mode = "search_header"
                    else:
                        movetext_lines.append(line.rstrip())

            # Handle the last game if the file doesn't end with a blank line
            if mode == "moves" and tags:
                movetext_raw = "\n".join(movetext_lines)
                movetext_flat = " ".join(s.strip() for s in movetext_lines if s.strip())
                yield tags, movetext_flat, movetext_raw

            # Final progress flush
            if progress_hook is not None:
                progress_hook(total_bytes, total_bytes)


def parse_games(
    raw_path: Path,
    *,
    progress_hook: Optional[Callable[[int, int], None]] = None,
    progress_every_bytes: int = 8 * (1 << 20),
) -> Iterable[ParsedGame]:
    """
    Yield ParsedGame objects from a lichess .pgn.zst file.
    """
    t0 = time.perf_counter()
    try:
        for tags, movetext_flat, movetext_raw in _parse_pgn_stream_zst(
            raw_path,
            progress_hook=progress_hook,
            progress_every_bytes=progress_every_bytes,
        ):
            # Timestamp (we keep it mainly to reconstruct UTCDate if needed)
            ts_ms = _parse_ts_ms_from_tags(tags)
            if ts_ms is None:
                continue

            # Result filtering (you asked for a simple 1 / -1 / 0 mapping)
            result_raw = tags.get("Result", "*")
            if result_raw not in ("1-0", "0-1", "1/2-1/2"):
                continue

            # Only standard games (variants can change interpretation)
            variant = tags.get("Variant", "Standard")
            if variant.lower() != "standard":
                continue

            def _safe_int(key: str) -> Optional[int]:
                v = tags.get(key)
                if v is None:
                    return None
                try:
                    return int(v)
                except ValueError:
                    return None

            event = tags.get("Event")
            site = tags.get("Site")

            utc_date = tags.get("UTCDate") or tags.get("Date")
            if not utc_date or utc_date == "????.??.??":
                # Last-resort fallback from timestamp if date tag is missing
                utc_date = ts_ms_to_utc_date(ts_ms)

            time_control_raw = tags.get("TimeControl", "") or ""
            time_control = normalize_time_control_bucket(time_control_raw)

            white_elo = _safe_int("WhiteElo")
            black_elo = _safe_int("BlackElo")
            average_elo = compute_average_elo(white_elo, black_elo)

            eco = tags.get("ECO")
            opening = tags.get("Opening")

            # Moves + eval per move (fast path)
            moves = _extract_moves_with_eval(movetext_flat)

            # Split "??", "?!", ... into tag/label fields (in-place)
            normalize_moves_in_place(moves)

            # Accuracy metrics (global + per-side), built from eval deltas
            (
                has_eval,
                average_accuracy,
                average_accuracy_per_move,
                avg_accuracy_white,
                avg_accuracy_black,
                avg_accuracy_per_move_white,
                avg_accuracy_per_move_black,
            ) = compute_accuracy_metrics_from_moves(moves)

            pgn_source = _reconstruct_pgn_source(tags, movetext_raw)

            yield ParsedGame(
                event=event,
                site=site,
                utc_date=utc_date,
                time_control_raw=time_control_raw,
                time_control=time_control,
                white_elo=white_elo,
                black_elo=black_elo,
                average_elo=average_elo,
                result_raw=result_raw,
                result_value=normalize_result_value(result_raw),
                eco=eco,
                opening=opening,
                has_eval=has_eval,
                average_accuracy=average_accuracy,
                average_accuracy_per_move=average_accuracy_per_move,
                avg_accuracy_white=avg_accuracy_white,
                avg_accuracy_black=avg_accuracy_black,
                avg_accuracy_per_move_white=avg_accuracy_per_move_white,
                avg_accuracy_per_move_black=avg_accuracy_per_move_black,
                moves=moves,
                pgn_source=pgn_source,
            )
    finally:
        PGN_PROFILE["parse_games"] += time.perf_counter() - t0
