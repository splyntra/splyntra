#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Insert or verify SPDX license headers across the open-core source tree.

Per LICENSING.md: files under sdks/ are Apache-2.0; everything else is
AGPL-3.0-only. Run with no args to apply headers in place; run with --check to
verify (non-zero exit if any file is missing or has the wrong header) — that is
what CI uses.

Usage:
    python scripts/license_headers.py            # apply
    python scripts/license_headers.py --check     # verify only
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Directories to scan, relative to repo root.
SCAN_DIRS = ["apps", "sdks", "examples", "tests", "scripts"]
EXCLUDE_PARTS = {"node_modules", ".next", "dist", "__pycache__", ".venv", "venv", "bin", "vendor"}

# Extension -> comment prefix.
LINE_COMMENT = {".go": "//", ".py": "#", ".ts": "//", ".tsx": "//", ".js": "//"}


def spdx_for(path: Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    return "Apache-2.0" if rel.startswith("sdks/") else "AGPL-3.0-only"


def header_line(path: Path) -> str:
    return f"{LINE_COMMENT[path.suffix]} SPDX-License-Identifier: {spdx_for(path)}"


def iter_files():
    for d in SCAN_DIRS:
        base = ROOT / d
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.suffix not in LINE_COMMENT:
                continue
            if any(part in EXCLUDE_PARTS for part in p.relative_to(ROOT).parts):
                continue
            if p.name.endswith(".d.ts"):
                continue
            yield p


def has_correct_header(text: str, expected: str) -> bool:
    # Look in the first few lines (after a possible shebang).
    for line in text.splitlines()[:5]:
        if "SPDX-License-Identifier:" in line:
            return expected in line
    return False


def has_any_header(text: str) -> bool:
    return any("SPDX-License-Identifier:" in ln for ln in text.splitlines()[:5])


def apply_header(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    expected = header_line(path)
    if has_correct_header(text, spdx_for(path)):
        return False
    lines = text.split("\n")
    # Preserve a leading shebang (Python scripts).
    insert_at = 1 if lines and lines[0].startswith("#!") else 0
    # Drop a pre-existing (wrong) SPDX line if present near the top.
    for i in range(insert_at, min(insert_at + 5, len(lines))):
        if "SPDX-License-Identifier:" in lines[i]:
            lines.pop(i)
            break
    lines.insert(insert_at, expected)
    path.write_text("\n".join(lines), encoding="utf-8")
    return True


def main() -> int:
    check = "--check" in sys.argv
    missing, fixed = [], []
    for p in iter_files():
        text = p.read_text(encoding="utf-8")
        if has_correct_header(text, spdx_for(p)):
            continue
        if check:
            missing.append(p.relative_to(ROOT).as_posix())
        else:
            apply_header(p)
            fixed.append(p.relative_to(ROOT).as_posix())
    if check:
        if missing:
            print("Missing/incorrect SPDX header in:")
            for m in missing:
                print(f"  {m}  (expected {spdx_for(ROOT / m)})")
            return 1
        print("All source files carry the correct SPDX header.")
        return 0
    print(f"Applied SPDX headers to {len(fixed)} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
