# ChessViz

## TODO

- [ ] Front:
  - [ ] Add titles to charts
  - [x] Add labels to axes
  - [ ] Made update methods to not recreate everything when filtering
  - [ ] Add documentation
  - [ ] Improve uniformisation and optimization of the code
  - [ ] Improve styling
  - [ ] Translation everything to English
  - [ ] Accuracy:
    - [x] translate axes to be aligned with the squares
    - [x] Try other color scales
    - [x] Repair opening selector

## Data processing

This project turns raw Lichess PGN dumps into lighter datasets (parquet), then generates JSON assets (builders) for the front-end.

The pipeline is:

**PGN (.pgn.zst) > Parser > Parquet files > Loader > DataFrames > Builders > JSON outputs**

---

### 1) Parser: PGN > Parquet

The Parser reads a compressed Lichess `*.pgn.zst` file, extracts the useful information, applies filtering, and exports a single Parquet file into `parsed/`.

Key points:

- Streaming parsing (doesn't load the whole PGN in memory)
- Optional SHA256 verification against `data/sha256sums.txt`
- Filtering options:
  - `eval_only=True`: keeps only games containing engine evaluations
  - `only_time_control_selection=True`: keeps only `RAPID`, `BLITZ`, `BULLET`
- Exports the filtered result to:
  `parsed/<lichess_db_standard_rated_YYYY-MM>.parquet`

Example:

```py
from __future__ import annotations
from parser.parser import Parser

def export() -> int:
    p = Parser(
        source_file="data/2014/lichess_db_standard_rated_2014-12.pgn.zst",
        eval_only=True,
        only_time_control_selection=True,
        sha_check=True,
    )

    out_path = p.exportAll(progress=True)
    print(out_path)

    p.printProfile()
    return 0
```

---

### 2) Loader: Parquet > DataFrames

The Loader reads the Parquet files produced by the Parser and merges them into a single Polars `DataFrame` (or loads only one file if needed).

Key points:

- `load()` loads all `parsed/*.parquet` into a single DataFrame
- `loadFile(name)` loads one parquet file (typically one month)
- `stats()` computes quick dataset statistics (total, per time control, per year)
- `toGames()` optionally converts a DataFrame into `ParsedGame` objects (only for debug because very slow)

Example:

```py
from __future__ import annotations
from parser.loader import Loader

def load() -> int:
    loader = Loader()

    # Load only games from a specific file (= 1 month)
    df = loader.loadFile("lichess_db_standard_rated_2013-02")

    s = loader.stats()
    print(s.total_games)
    print(s.by_time_control)
    print(s.by_year)

    # Debug: print the first row (DataFrame view)
    print(df[0])

    return 0
```

---

### 3) Builders: DataFrames > JSON assets

Builders are responsible for generating structured JSON files in:

`json/<builderName>/...`

They all follow the same core idea:

- Take a Polars DataFrame as input (from Loader)
- Process/aggregate the dataset in a builder-specific way
- Export a JSON file into the appropriate folder

The builder system is built with a **base class + registry** approach:

- `BaseBuilder`: common logic (output folder, export helper, etc.)
- `register_builder`: decorator to auto-register new builders
- `get_builder(name)`: retrieves a builder class by name

Common concepts across builders:

- **Time controls**: many builders only work on `RAPID`, `BLITZ`, `BULLET`
- **Elo brackets** (example convention):
  - `0-500`
  - `500-1000`
  - `1000-1500`
  - `1500-2000`
  - `2000+`
- **Opening grouping**:
  - Openings are grouped by "family"
    - `Ruy Lopez: Steinitz Defense` > `Ruy Lopez`
  - A hardcoded whitelist keeps the dataset meaningful and reduces noise
  - Unlisted openings can be grouped into `"Other"`

Opening whitelist :

- Sicilian Defense
- French Defense
- Caro-Kann Defense
- Scandinavian Defense
- Alekhine Defense
- Pirc Defense
- Modern Defense
- Dutch Defense
- Philidor Defense
- Petrov's Defense
- Italian Game
- Ruy Lopez
- Scotch Game
- Four Knights Game
- Vienna Game
- King's Gambit
- English Opening
- Queen's Gambit
- Slav Defense
- Semi-Slav Defense
- Nimzo-Indian Defense
- Queen's Indian Defense
- Bogo-Indian Defense
- King's Indian Defense
- Grünfeld Defense
- Benoni Defense
- Benko Gambit
- London System
- Catalan Opening
- Réti Opening
- Bird Opening
- Polish Opening
- Owen Defense
- Czech Defense
- Trompowsky Attack
- Veresov Opening
- Jobava London System
- Stonewall Attack

Example: running a builder

```py
from __future__ import annotations
from parser.loader import Loader
from builder import get_builder

def run_builders() -> int:
    loader = Loader()
    df = loader.load()
    # df = loader.loadFile("lichess_db_standard_rated_2014-02")

    Cls = get_builder("opening_accuracy_heatmap")
    b = Cls(opening_moves=12)

    out = b.export(df, filename="acc_heatmap")
    print(out)

    return 0

if __name__ == "__main__":
    raise SystemExit(run_builders())
```

---

#### 3.1 Builder: Opening accuracy heatmap (winrate)

This builder creates a 10×10 heatmap where each cell corresponds to:

- **x-axis**: opening accuracy bin (0–10, …, 90–100)
- **y-axis**: after-opening accuracy bin (0–10, …, 90–100)

Accuracy is computed per player using the cumulative accuracy curve:

- Opening accuracy = value after the player's 12th move
- After-opening accuracy is recomputed from cumulative averages so it represents the *average accuracy of the remaining part of the game*, not just "the final cumulative value again".

For a given opening group / time control / elo bracket:

- `heatmap[y][x]` = average win rate among samples in that cell (`0..1`)
- `cell_samples[y][x]` = number of samples used to compute that value

So the output is directly usable as a "winrate heatmap" conditioned on (opening accuracy, after-opening accuracy), split by time control and elo bracket (and also includes an `"All"` opening bucket).
