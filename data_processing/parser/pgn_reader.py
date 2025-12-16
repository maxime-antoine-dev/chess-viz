from pathlib import Path
from typing import Dict, Tuple, Iterable, Optional, List
import io
import re
import datetime as dt
import time
import sys

import zstandard as zstd

from .models import GameHeader, ParsedGame

#  Tiny, lightweight profiling to see where time goes while parsing large PGN dumps
PGN_PROFILE: Dict[str, float] = {
    "parse_game_headers": 0.0,
    "approx_moves": 0.0,
    "eval_stats": 0.0,
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


# Regexes
TAG_RE = re.compile(r'^\[(\w+)\s+"(.*)"\]$') # PGN tag lines like: [Key "Value"]
MOVE_NUMBER_RE = re.compile(r"\b\d+\.")  # Used as a quick/cheap proxy to count full moves ("1.", "2.", ...)
EVAL_RE = re.compile(r"\[%eval\s+([^\]]+)\]") # Extract engine evals inside comments, e.g. { [%eval 0.17] ... }
COMMENT_RE = re.compile(r"\{[^}]*\}")  # Curly-brace comments in movetext
NAG_RE = re.compile(r"\$\d+")  # Numeric Annotation Glyphs like $1, $2, ...


# Approximate number of full moves
def _approx_moves_from_movetext(movetext_flat: str) -> int:
    # We strip comments/NAGs first, then count move numbers. It's approximate, but very fast.
    t0 = time.perf_counter()

    cleaned = COMMENT_RE.sub(" ", movetext_flat)
    cleaned = NAG_RE.sub(" ", cleaned)
    matches = MOVE_NUMBER_RE.findall(cleaned)
    moves = len(matches)

    PGN_PROFILE["approx_moves"] += time.perf_counter() - t0
    return moves


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

# Tokenize movetext into ('TOKEN', token) and ('COMMENT', comment_content_without_braces).
def _tokenize_movetext(movetext_flat: str) -> List[Tuple[str, str]]:
    # Small custom tokenizer:
    # - keeps { ... } as a single COMMENT token (so we can scan for evals)
    # - everything else becomes TOKENs split by whitespace
    tokens: List[Tuple[str, str]] = []
    i = 0
    n = len(movetext_flat)
    while i < n:
        c = movetext_flat[i]
        if c.isspace():
            i += 1
            continue
        if c == "{":
            j = movetext_flat.find("}", i + 1)
            if j == -1:
                # Corrupted/unfinished comment: just stop at the end
                j = n - 1
            content = movetext_flat[i + 1 : j]
            tokens.append(("COMMENT", content))
            i = j + 1
        else:
            j = i
            while j < n and (not movetext_flat[j].isspace()) and movetext_flat[j] != "{":
                j += 1
            tok = movetext_flat[i:j]
            tokens.append(("TOKEN", tok))
            i = j
    return tokens

# Parse a [%eval ...] value to a float in pawns.
# Returns None for mates (#...) or unparsable values.
def _parse_eval_value(raw: str) -> Optional[float]:
    # We ignore mate scores like "#3" or "#-1" (not comparable as floats)
    s = raw.strip()
    if s.startswith("#"):
        return None
    try:
        return float(s)
    except ValueError:
        return None

# From movetext, extract whether the game has evals, and compute
# average centipawn loss (ACPL) for White and Black.
def _extract_eval_stats(movetext_flat: str) -> Tuple[bool, Optional[float], Optional[float]]:
    # ACPL here is a simple heuristic based on consecutive eval deltas.
    # If there's no [%eval] anywhere, we bail out early to keep things fast.
    t0 = time.perf_counter()

    if "[%eval" not in movetext_flat:
        PGN_PROFILE["eval_stats"] += time.perf_counter() - t0
        return False, None, None

    tokens = _tokenize_movetext(movetext_flat)

    evals_w: List[float] = []
    evals_b: List[float] = []

    side_to_move = "w"
    last_mover: Optional[str] = None

    for kind, val in tokens:
        if kind == "COMMENT":
            # If a comment contains an eval, assign it to the player who just moved
            m = EVAL_RE.search(val)
            if m and last_mover is not None:
                ev = _parse_eval_value(m.group(1))
                if ev is None:
                    continue
                if last_mover == "w":
                    evals_w.append(ev)
                else:
                    evals_b.append(ev)
        else:
            tok = val

            # Filter out non-move tokens we don't want to treat as SAN
            if tok in ("1-0", "0-1", "1/2-1/2", "*"):
                continue
            if re.fullmatch(r"\d+\.+", tok):
                continue
            if tok.startswith("$"):
                continue

            # Every remaining token is assumed to be a SAN move -> alternate sides
            last_mover = side_to_move
            side_to_move = "b" if side_to_move == "w" else "w"

    def average_cp_loss(evals: List[float]) -> Optional[float]:
        # Need at least two eval points to measure change
        if len(evals) < 2:
            return None
        diffs = [abs(evals[i] - evals[i - 1]) * 100.0 for i in range(1, len(evals))]
        return sum(diffs) / len(diffs)

    has_eval = bool(evals_w or evals_b)
    acpl_w = average_cp_loss(evals_w)
    acpl_b = average_cp_loss(evals_b)

    PGN_PROFILE["eval_stats"] += time.perf_counter() - t0
    return has_eval, acpl_w, acpl_b

# Extract PGN moves as an array of {"move": SAN, "eval": float|None}.
def _extract_moves_with_eval(movetext_flat: str) -> List[Dict[str, Optional[float]]]:
    # We walk the token stream in order and:
    # - when we see a move, we append {"move": ..., "eval": None}
    # - when we see a comment containing [%eval X], we attach it to the last move
    t0 = time.perf_counter()

    tokens = _tokenize_movetext(movetext_flat)
    moves: List[Dict[str, Optional[float]]] = []

    last_move_index: Optional[int] = None

    for kind, val in tokens:
        if kind == "TOKEN":
            tok = val

            # Same filters as before: skip results, move numbers, and NAGs
            if tok in ("1-0", "0-1", "1/2-1/2", "*"):
                continue
            if re.fullmatch(r"\d+\.+", tok):
                continue
            if tok.startswith("$"):
                continue

            moves.append({"move": tok, "eval": None})
            last_move_index = len(moves) - 1

        else:  # COMMENT
            if last_move_index is None:
                continue

            m = EVAL_RE.search(val)
            if not m:
                continue

            ev = _parse_eval_value(m.group(1))
            # ev can be None if it's a mate score or malformed -> keep None
            moves[last_move_index]["eval"] = ev

    PGN_PROFILE["extract_moves"] += time.perf_counter() - t0
    return moves


def _reconstruct_pgn_source(tags: Dict[str, str], movetext_raw: str) -> str:
    # Rebuild a "pretty normal" PGN: tags block, blank line, then movetext
    header_lines = [f'[{k} "{v}"]' for k, v in tags.items()]
    return "\n".join(header_lines) + "\n\n" + movetext_raw.strip() + "\n"


# Stream a .pgn.zst file and yield (tags_dict, movetext_flat, movetext_raw) per game.
def _parse_pgn_stream_zst(raw_path: Path) -> Iterable[Tuple[Dict[str, str], str, str]]:
    # We read the compressed stream and use a simple state machine:
    # - read tag lines
    # - then read movetext lines until a blank line ends the game
    with raw_path.open("rb") as fh:
        dctx = zstd.ZstdDecompressor()
        with dctx.stream_reader(fh) as reader:
            text_stream = io.TextIOWrapper(reader, encoding="utf-8", errors="replace")

            tags: Dict[str, str] = {}
            movetext_lines: List[str] = []
            mode = "search_header"

            for line in text_stream:
                line = line.rstrip("\n")

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


# Yield GameHeader objects from a lichess_db_standard_rated_YYYY-MM.pgn.zst file.
def parse_game_headers(raw_path: Path) -> Iterable[GameHeader]:
    # Parse and filter games into a lightweight header object (used by other pipelines)
    t0 = time.perf_counter()
    try:
        for tags, movetext_flat, _movetext_raw in _parse_pgn_stream_zst(raw_path):
            ts_ms = _parse_ts_ms_from_tags(tags)
            if ts_ms is None:
                continue

            result = tags.get("Result", "*")
            if result not in ("1-0", "0-1", "1/2-1/2"):
                continue

            # For now we only keep Standard games, since other variants change interpretation
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
            white = tags.get("White", "")
            black = tags.get("Black", "")
            white_elo = _safe_int("WhiteElo")
            black_elo = _safe_int("BlackElo")
            white_diff = _safe_int("WhiteRatingDiff")
            black_diff = _safe_int("BlackRatingDiff")
            tc_raw = tags.get("TimeControl", "")
            termination = tags.get("Termination")
            eco = tags.get("ECO")
            opening = tags.get("Opening")
            white_title = tags.get("WhiteTitle")
            black_title = tags.get("BlackTitle")

            moves = _approx_moves_from_movetext(movetext_flat)
            has_eval, acpl_w, acpl_b = _extract_eval_stats(movetext_flat)

            yield GameHeader(
                event=event,
                site=site,
                white=white,
                black=black,
                result=result,
                ts_ms=ts_ms,
                white_elo=white_elo,
                black_elo=black_elo,
                white_rating_diff=white_diff,
                black_rating_diff=black_diff,
                time_control_raw=tc_raw,
                termination=termination,
                variant=variant,
                eco=eco,
                opening=opening,
                white_title=white_title,
                black_title=black_title,
                moves=moves,
                has_eval=has_eval,
                white_cp_loss=acpl_w,
                black_cp_loss=acpl_b,
            )
    finally:
        PGN_PROFILE["parse_game_headers"] += time.perf_counter() - t0


# Yield ParsedGame for each parsed game, including:
# - moves array (SAN tokens + eval per move when available)
# - original PGN source (tags + movetext with line breaks)
def parse_games(raw_path: Path) -> Iterable[ParsedGame]:
    # Same filtering as parse_game_headers, but we also keep the move list + raw PGN text
    t0 = time.perf_counter()
    try:
        for tags, movetext_flat, movetext_raw in _parse_pgn_stream_zst(raw_path):
            ts_ms = _parse_ts_ms_from_tags(tags)
            if ts_ms is None:
                continue

            result = tags.get("Result", "*")
            if result not in ("1-0", "0-1", "1/2-1/2"):
                continue

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
            white = tags.get("White", "")
            black = tags.get("Black", "")
            white_elo = _safe_int("WhiteElo")
            black_elo = _safe_int("BlackElo")
            white_diff = _safe_int("WhiteRatingDiff")
            black_diff = _safe_int("BlackRatingDiff")
            tc_raw = tags.get("TimeControl", "")
            termination = tags.get("Termination")
            eco = tags.get("ECO")
            opening = tags.get("Opening")
            white_title = tags.get("WhiteTitle")
            black_title = tags.get("BlackTitle")

            approx_full_moves = _approx_moves_from_movetext(movetext_flat)
            has_eval, acpl_w, acpl_b = _extract_eval_stats(movetext_flat)
            moves_san = _extract_moves_with_eval(movetext_flat)

            header = GameHeader(
                event=event,
                site=site,
                white=white,
                black=black,
                result=result,
                ts_ms=ts_ms,
                white_elo=white_elo,
                black_elo=black_elo,
                white_rating_diff=white_diff,
                black_rating_diff=black_diff,
                time_control_raw=tc_raw,
                termination=termination,
                variant=variant,
                eco=eco,
                opening=opening,
                white_title=white_title,
                black_title=black_title,
                moves=approx_full_moves,
                has_eval=has_eval,
                white_cp_loss=acpl_w,
                black_cp_loss=acpl_b,
            )

            pgn_source = _reconstruct_pgn_source(tags, movetext_raw)

            yield ParsedGame(
                header=header,
                tags=tags,
                moves_san=moves_san,
                movetext_raw=movetext_raw,
                pgn_source=pgn_source,
            )
    finally:
        PGN_PROFILE["parse_game_headers"] += time.perf_counter() - t0
