#!/usr/bin/env python3
"""
Splits import_data.sql into per-table files.
Large tables (inflows, outflows, activity_logs) are further chunked by CHUNK_SIZE rows.
"""

from pathlib import Path
import math

src = Path(__file__).parent / "import_data.sql"
out_dir = Path(__file__).parent / "import_chunks"
out_dir.mkdir(exist_ok=True)

# Remove old chunks first
for f in out_dir.glob("*.sql"):
    f.unlink()

CHUNK_SIZE = 200  # rows per SQL Editor paste

ORDER = ["item_types", "buyers", "pack_skus", "inflows", "outflows", "fifo_deductions", "activity_logs", "user_roles"]

text = src.read_text(encoding="utf-8")
lines = text.splitlines()

header = [
    "SET session_replication_role = replica;",
    "BEGIN;",
]
footer = [
    "COMMIT;",
    "SET session_replication_role = DEFAULT;",
]

# Split by "-- <table>" markers
sections = {}
current = None
buffer = []

for line in lines:
    stripped = line.strip()
    matched = next((t for t in ORDER if stripped == f"-- {t}"), None)
    if matched:
        if current and buffer:
            sections[current] = buffer
        current = matched
        buffer = [line]
    elif current:
        buffer.append(line)

if current and buffer:
    sections[current] = buffer

file_index = 1

for tbl in ORDER:
    if tbl not in sections:
        continue

    all_lines = sections[tbl]
    insert_lines = [l for l in all_lines if l.strip().startswith("INSERT")]
    other_lines  = [l for l in all_lines if not l.strip().startswith("INSERT")]

    total = len(insert_lines)
    chunks = math.ceil(total / CHUNK_SIZE) if total > 0 else 1

    for chunk_i in range(chunks):
        batch = insert_lines[chunk_i * CHUNK_SIZE : (chunk_i + 1) * CHUNK_SIZE]
        label = f"{tbl} (part {chunk_i+1}/{chunks})" if chunks > 1 else tbl

        content_lines = (
            header
            + ([f"-- {label}"] if chunk_i == 0 else [f"-- {label}"])
            + (other_lines if chunk_i == 0 else [])  # DELETE only on first chunk
            + batch
            + footer
            + [f"\n-- Verify {tbl}", f"SELECT '{tbl}' AS tbl, COUNT(*) FROM public.{tbl};"]
        )

        fname = out_dir / f"{file_index:02d}_{tbl}{'_p'+str(chunk_i+1) if chunks > 1 else ''}.sql"
        fname.write_text("\n".join(content_lines), encoding="utf-8")
        print(f"  {fname.name}  ({len(batch)} inserts)")
        file_index += 1

print(f"\nFiles in: {out_dir}")
