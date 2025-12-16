from __future__ import annotations

import itertools
from pathlib import Path
from typing import Iterable, List, Optional, Union

from .models import ParsedGame
from .pgn_reader import parse_games, print_pgn_profile
from .utils import load_sha256_sums, sha256_file


class Parser:
    """
    wrapper around parse_games().

    Usage:
        p = Parser("data/2013/lichess_db_standard_rated_2013-01.pgn.zst")
        first3 = p.test()
        all_games = p.getAll()

    Notes:
      - eval_only defaults to True
      - sha_check defaults to True (if sha256sums.txt exists)
    """

    def __init__(
        self,
        source_file: Union[str, Path],
        *,
        eval_only: bool = True,
        sha_check: bool = True,
        root: Optional[Path] = None,
    ) -> None:
        self.root = root or Path(__file__).resolve().parents[1]
        self.eval_only = eval_only
        self.sha_check = sha_check

        self.source_path = self._resolve_source_path(source_file)

    # Public API

    def iterGames(self) -> Iterable[ParsedGame]:
        """
        Stream parsed games (generator).
        Applies sha check (optional) + eval-only filter (optional).
        """
        if self.sha_check:
            self._maybe_verify_sha256(self.root, self.source_path)

        games_iter = parse_games(self.source_path)

        if self.eval_only:
            games_iter = (g for g in games_iter if g.has_eval)

        return games_iter

    def test(self, n: int = 3) -> List[ParsedGame]:
        """
        Return the first n parsed games as a list (default 3).
        """
        return list(itertools.islice(self.iterGames(), n))

    def getAll(self) -> List[ParsedGame]:
        """
        Parse the whole file and return everything as a list.
        (Warning: can be huge.)
        """
        return list(self.iterGames())

    def printProfile(self) -> None:
        """
        Print internal PGN profiling (timings).
        """
        print_pgn_profile()

    # Internals

    def _resolve_source_path(self, source_file: Union[str, Path]) -> Path:
        p = Path(source_file)
        if not p.is_absolute():
            p = (self.root / p).resolve()
        if not p.exists():
            raise FileNotFoundError(f"PGN file not found: {p}")
        return p

    def _maybe_verify_sha256(self, root: Path, pgn_path: Path) -> None:
        sha_file = root / "data" / "sha256sums.txt"
        if not sha_file.exists():
            return

        mapping = load_sha256_sums(sha_file)
        expected = mapping.get(pgn_path.name)
        if not expected:
            return

        actual = sha256_file(pgn_path)
        if actual.lower() != expected.lower():
            raise ValueError(
                f"SHA256 mismatch for {pgn_path.name}\n"
                f"  expected: {expected}\n"
                f"  actual:   {actual}\n"
            )
