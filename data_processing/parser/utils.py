from pathlib import Path
import hashlib
from typing import Dict

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# Parse a sha256sums.txt file of the form: <hash> <filename>
def load_sha256_sums(sha_file: Path) -> Dict[str, str]:
    mapping: Dict[str, str] = {}
    with sha_file.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            h = parts[0]
            fname = parts[-1]
            if fname.startswith("./"):
                fname = fname[2:]
            mapping[fname] = h
    return mapping