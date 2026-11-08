#!/usr/bin/env python3
"""Check PID shard sizes and integrity after building, before publishing Pages.

The entire PID feed stays on GitHub Pages; mobile clients fetch individual shards.
No single shard may exceed the browser IndexedDB per-item budget (5 MiB).
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path

MAX_SHARD_BYTES = 5 * 1024 * 1024
EXPECTED_SCHEMA = "casovac-pid-v1"


def verify(root: Path) -> dict:
    manifest_file = root / "manifest.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest.get("schema") != EXPECTED_SCHEMA:
        raise ValueError("Invalid PID schema")
    if not manifest.get("days"):
        raise ValueError("No service days")
    for date, info in manifest["days"].items():
        folder = root / "days" / date
        if not (folder / "trips.json").is_file():
            raise ValueError(f"Missing trip locator for {date}")
        if not (folder / "blocks.json").is_file():
            raise ValueError(f"Missing block locator for {date}")
        if info["available"] and not list((folder / "routes").glob("*.json")):
            raise ValueError(f"Missing route shards for {date}")
        for bucket in range(64):
            path = folder / "departures" / f"{bucket:02d}.json"
            # A bucket may be empty for sparse synthetic / out-of-service days.
            if info["buckets"] == 64 and not path.is_file():
                raise ValueError(f"Missing departures bucket {date}/{bucket:02d}")
    files = list(root.rglob("*.json"))
    if not files:
        raise ValueError("Empty PID bundle")
    largest_size, largest_name = max(
        ((file.stat().st_size, file.relative_to(root).as_posix()) for file in files),
        key=lambda item: item[0]
    )
    if largest_size > MAX_SHARD_BYTES:
        raise ValueError(
            f"PID shard {largest_name} is {largest_size:,} B "
            f"(limit {MAX_SHARD_BYTES:,} B); re-shard before publishing"
        )
    return {
        "files": len(files),
        "totalBytes": sum(file.stat().st_size for file in files),
        "largestShard": largest_name,
        "largestBytes": largest_size,
        "perItemLimitBytes": MAX_SHARD_BYTES,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path, nargs="?", default=Path("public/data/pid/v1"))
    args = parser.parse_args()
    print(json.dumps(verify(args.root), ensure_ascii=False, indent=2))
