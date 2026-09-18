"""Lightweight non-destructive CITYFILE sanity checker.

Run from the project root:
    python audit_project.py

It does not start the server or modify application data.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def ok(label: str, detail: str = "") -> None:
    print(f"[PASS] {label}{': ' + detail if detail else ''}")


def warn(label: str, detail: str = "") -> None:
    print(f"[WARN] {label}{': ' + detail if detail else ''}")


def fail(label: str, detail: str = "") -> None:
    print(f"[FAIL] {label}{': ' + detail if detail else ''}")


required = [
    "index.html", "style.css", "script.js", "main.py", "models.py",
    "schemas.py", "database.py", "blockchain.py"
]
missing = [name for name in required if not (ROOT / name).exists()]
if missing:
    fail("Required project files", ", ".join(missing))
else:
    ok("Required project files")

# Duplicate HTML IDs + navigation target sanity checks.
html_path = ROOT / "index.html"
if html_path.exists():
    html = html_path.read_text(encoding="utf-8", errors="replace")
    ids = re.findall(r'\bid\s*=\s*["\']([^"\']+)["\']', html, re.I)
    duplicate_ids = sorted(k for k, v in Counter(ids).items() if v > 1)
    if duplicate_ids:
        fail("Duplicate HTML IDs", ", ".join(duplicate_ids))
    else:
        ok("Duplicate HTML IDs", "none")

    views = set(re.findall(r'data-view-name\s*=\s*["\']([^"\']+)', html, re.I))
    targets = set(re.findall(r'data-view\s*=\s*["\']([^"\']+)', html, re.I))
    missing_views = sorted(targets - views)
    if missing_views:
        fail("Navigation targets", f"no matching view for {missing_views}")
    else:
        ok("Navigation targets")

# Python syntax.
py_files = [ROOT / name for name in [
    "main.py", "models.py", "schemas.py", "database.py", "blockchain.py"
] if (ROOT / name).exists()]
if py_files:
    result = subprocess.run(
        [sys.executable, "-m", "py_compile", *map(str, py_files)],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        fail("Python syntax", result.stderr.strip())
    else:
        ok("Python syntax")

# JavaScript syntax if Node is available.
node = shutil.which("node")
js_path = ROOT / "script.js"
if node and js_path.exists():
    result = subprocess.run([node, "--check", str(js_path)], capture_output=True, text=True)
    if result.returncode:
        fail("JavaScript syntax", result.stderr.strip())
    else:
        ok("JavaScript syntax")
elif js_path.exists():
    warn("JavaScript syntax", "Node is not installed; skipped node --check")

# Required asset references used by the current source.
asset_refs = {
    "assets/city_street.png", "assets/all.jpg", "assets/pothole.jpg",
    "assets/garbage.jpg", "assets/water.jpg", "assets/drainage.jpg",
    "assets/streetlight.jpg", "assets/safety.jpg", "assets/other.jpg",
}
missing_assets = sorted(ref for ref in asset_refs if not (ROOT / ref).exists())
if missing_assets:
    warn("Referenced assets missing", ", ".join(missing_assets))
else:
    ok("Referenced assets")

# Important environment/config warning only; do not read or print secrets.
if not (ROOT / ".env").exists():
    warn("Local .env", "not present in this folder (Railway may use Variables instead)")
else:
    ok("Local .env", "present; secret values were not inspected")

print("\nStatic audit complete. Run the manual end-to-end matrix in AUDIT_REPORT.md as well.")
