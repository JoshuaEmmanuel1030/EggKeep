#!/usr/bin/env python3
"""
EggKeep Database Import Generator
===================================
Reads CSV exports from Lovable Cloud and generates a ready-to-run SQL file
for importing into your new Supabase project.

BEFORE RUNNING:
1. Create your Supabase project at supabase.com
2. Run combined_schema.sql in the SQL Editor
3. Go to Authentication > Users > Add User (or Invite) for each person below
4. Copy each user's UUID from the Users list and paste it into UUID_MAP
5. Run: python generate_import.py
6. Run the generated import_data.sql in the SQL Editor
"""

import csv
import json
import os
from pathlib import Path

# ============================================================
# STEP 1: FILL IN YOUR NEW SUPABASE UUIDS
# Find these in: Authentication > Users in your new Supabase project
# Leave as empty string "" to skip that user's data rows
# ============================================================
UUID_MAP = {
    "068f231b-ae47-4229-9d54-9edd544d6c6d": "c026a4c6-e26a-4f0b-89f4-b3f8c4001583",  # noviiatun498@gmail.com
    "de3937a4-296e-431a-a6d7-68b3c2a24504": "1d205fd2-ad2a-45e0-b99c-ab49b3c56512",  # jemmhar@bu.edu
    "c42a169b-3d9c-4732-b017-c87ff3b7c6f0": "7f6868e1-65a7-4ab5-a518-9f878e3c494a",  # joshuahartono@outlook.com
    "5352c3cf-3e74-4afa-966a-3caa41bd2218": "6c137c49-c490-4dbf-9067-e4347c8e5ab4",  # udinompong723@gmail.com
    # These users only appear in user_roles, not in data.
    # If you're recreating them, fill in their new UUIDs. Otherwise leave "".
    "14567567-8fdb-46e3-bbec-6252bdcdf4e6": "",  # unknown admin
    "ca5830d9-9a51-4141-a0e9-edda21aa91a1": "",  # unknown user
    "97a13118-e58f-44c6-9bb4-61e8eae78d44": "",  # unknown user
}

# ============================================================
# STEP 2: POINT TO YOUR CSV EXPORTS
# ============================================================
CSV_DIR = Path(r"C:\Users\joshu\Downloads")

CSVS = {
    "item_types":       "item_types-export-2026-06-19_03-09-03.csv",
    "buyers":           "buyers-export-2026-06-19_03-09-20.csv",
    "pack_skus":        "pack_skus-export-2026-06-19_03-09-12.csv",
    "inflows":          "inflows-export-2026-06-19_03-09-28.csv",
    "outflows":         "outflows-export-2026-06-19_03-09-40.csv",
    "fifo_deductions":  "fifo_deductions-export-2026-06-19_03-08-55.csv",
    "activity_logs":    "activity_logs-export-2026-06-19_03-08-46.csv",
    "user_roles":       "user_roles-export-2026-06-19_03-09-50.csv",
}

OUTPUT_FILE = Path(__file__).parent / "import_data.sql"

# ============================================================
# Helpers
# ============================================================

def remap_uuid(uid):
    if not uid or uid.strip() == "":
        return None
    new = UUID_MAP.get(uid.strip())
    if new is None:
        return uid  # not in map, keep as-is (shouldn't happen)
    if new == "":
        return None  # user not being migrated, skip row
    return new

def sql_str(val):
    """Escape a string value for SQL. Returns NULL for empty/None."""
    if val is None or str(val).strip() == "":
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"

def sql_uuid(val):
    """UUID value or NULL."""
    if val is None or str(val).strip() == "":
        return "NULL"
    return "'" + str(val).strip() + "'"

def sql_ts(val):
    """Timestamp or NULL."""
    if val is None or str(val).strip() == "":
        return "NULL"
    return "'" + str(val).strip() + "'"

def sql_num(val):
    """Numeric value or NULL."""
    if val is None or str(val).strip() == "":
        return "NULL"
    return str(val).strip()

def sql_bool(val):
    if str(val).lower() in ("true", "t", "1", "yes"):
        return "true"
    return "false"

def sql_jsonb(val):
    """JSONB value or NULL."""
    if val is None or str(val).strip() == "":
        return "NULL"
    v = str(val).strip()
    try:
        json.loads(v)  # validate
        return "'" + v.replace("'", "''") + "'::jsonb"
    except Exception:
        return "NULL"

def read_csv(table):
    path = CSV_DIR / CSVS[table]
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        return list(reader)

# ============================================================
# Generators
# ============================================================

def gen_item_types():
    lines = ["-- item_types", "DELETE FROM public.item_types;"]
    for r in read_csv("item_types"):
        lines.append(
            f"INSERT INTO public.item_types (id, category, name, created_at, deleted_at) VALUES ("
            f"{sql_uuid(r['id'])}, "
            f"'{r['category']}', "
            f"{sql_str(r['name'])}, "
            f"{sql_ts(r['created_at'])}, "
            f"{sql_ts(r.get('deleted_at'))}) ON CONFLICT (id) DO NOTHING;"
        )
    return lines

def gen_buyers():
    lines = ["", "-- buyers", "DELETE FROM public.buyers;"]
    for r in read_csv("buyers"):
        lines.append(
            f"INSERT INTO public.buyers (id, name, default_box_mode, created_at, deleted_at) VALUES ("
            f"{sql_uuid(r['id'])}, "
            f"{sql_str(r['name'])}, "
            f"{sql_str(r['default_box_mode'])}, "
            f"{sql_ts(r['created_at'])}, "
            f"{sql_ts(r.get('deleted_at'))}) ON CONFLICT (id) DO NOTHING;"
        )
    return lines

def gen_pack_skus():
    lines = ["", "-- pack_skus", "DELETE FROM public.pack_skus;"]
    for r in read_csv("pack_skus"):
        lines.append(
            f"INSERT INTO public.pack_skus (id, code, display_name, eggs_per_pack, egg_product, packaging_item, is_active, created_at, deleted_at) VALUES ("
            f"{sql_uuid(r['id'])}, "
            f"{sql_str(r['code'])}, "
            f"{sql_str(r['display_name'])}, "
            f"{sql_num(r['eggs_per_pack'])}, "
            f"{sql_str(r['egg_product'])}, "
            f"{sql_str(r.get('packaging_item'))}, "
            f"{sql_bool(r.get('is_active', 'true'))}, "
            f"{sql_ts(r['created_at'])}, "
            f"{sql_ts(r.get('deleted_at'))}) ON CONFLICT (id) DO NOTHING;"
        )
    return lines

def gen_inflows():
    lines = ["", "-- inflows"]
    skipped = 0
    for r in read_csv("inflows"):
        new_uid = remap_uuid(r.get("user_id"))
        if new_uid is None:
            skipped += 1
            continue
        lines.append(
            f"INSERT INTO public.inflows (id, date, product, quantity_original, quantity_butir, remaining_butir, created_at, user_id, category, invoice_supplier, voided_at, void_reason) VALUES ("
            f"{sql_uuid(r['id'])}, "
            f"{sql_str(r['date'])}, "
            f"{sql_str(r['product'])}, "
            f"{sql_num(r['quantity_original'])}, "
            f"{sql_num(r['quantity_butir'])}, "
            f"{sql_num(r['remaining_butir'])}, "
            f"{sql_ts(r['created_at'])}, "
            f"'{new_uid}', "
            f"'{r['category']}', "
            f"{sql_str(r.get('invoice_supplier'))}, "
            f"{sql_ts(r.get('voided_at'))}, "
            f"{sql_str(r.get('void_reason'))}) ON CONFLICT (id) DO NOTHING;"
        )
    if skipped:
        lines.insert(1, f"-- WARNING: {skipped} rows skipped (user_id not in UUID_MAP)")
    return lines

def gen_outflows():
    lines = ["", "-- outflows"]
    skipped = 0
    for r in read_csv("outflows"):
        new_uid = remap_uuid(r.get("user_id"))
        if new_uid is None:
            skipped += 1
            continue
        lines.append(
            f"INSERT INTO public.outflows (id, date, product, quantity_butir, created_at, user_id, category, invoice_supplier, voided_at, void_reason) VALUES ("
            f"{sql_uuid(r['id'])}, "
            f"{sql_str(r['date'])}, "
            f"{sql_str(r['product'])}, "
            f"{sql_num(r['quantity_butir'])}, "
            f"{sql_ts(r['created_at'])}, "
            f"'{new_uid}', "
            f"'{r['category']}', "
            f"{sql_str(r.get('invoice_supplier'))}, "
            f"{sql_ts(r.get('voided_at'))}, "
            f"{sql_str(r.get('void_reason'))}) ON CONFLICT (id) DO NOTHING;"
        )
    if skipped:
        lines.insert(1, f"-- WARNING: {skipped} rows skipped (user_id not in UUID_MAP)")
    return lines

def gen_fifo_deductions():
    lines = ["", "-- fifo_deductions"]
    for r in read_csv("fifo_deductions"):
        lines.append(
            f"INSERT INTO public.fifo_deductions (id, outflow_id, inflow_id, quantity_deducted, created_at) VALUES ("
            f"{sql_uuid(r['id'])}, "
            f"{sql_uuid(r['outflow_id'])}, "
            f"{sql_uuid(r['inflow_id'])}, "
            f"{sql_num(r['quantity_deducted'])}, "
            f"{sql_ts(r['created_at'])}) ON CONFLICT (id) DO NOTHING;"
        )
    return lines

def gen_activity_logs():
    lines = ["", "-- activity_logs"]
    skipped = 0
    for r in read_csv("activity_logs"):
        new_uid = remap_uuid(r.get("user_id"))
        if new_uid is None:
            skipped += 1
            continue
        lines.append(
            f"INSERT INTO public.activity_logs (id, user_id, action_type, product, quantity_butir, quantity_original, recorded_at, synced_at, created_at, client_id, category, invoice_supplier, user_email, metadata, voided_at, void_reason, original_log_id, corrected_by_log_id) VALUES ("
            f"{sql_uuid(r['id'])}, "
            f"'{new_uid}', "
            f"'{r['action_type']}', "
            f"{sql_str(r['product'])}, "
            f"{sql_num(r['quantity_butir'])}, "
            f"{sql_num(r.get('quantity_original'))}, "
            f"{sql_ts(r['recorded_at'])}, "
            f"{sql_ts(r.get('synced_at'))}, "
            f"{sql_ts(r['created_at'])}, "
            f"{sql_str(r.get('client_id'))}, "
            f"'{r.get('category', 'egg')}', "
            f"{sql_str(r.get('invoice_supplier'))}, "
            f"{sql_str(r.get('user_email'))}, "
            f"{sql_jsonb(r.get('metadata'))}, "
            f"{sql_ts(r.get('voided_at'))}, "
            f"{sql_str(r.get('void_reason'))}, "
            f"{sql_uuid(r.get('original_log_id'))}, "
            f"{sql_uuid(r.get('corrected_by_log_id'))}) ON CONFLICT (id) DO NOTHING;"
        )
    if skipped:
        lines.insert(1, f"-- WARNING: {skipped} rows skipped (user_id not in UUID_MAP)")
    return lines

def gen_user_roles():
    lines = ["", "-- user_roles (trigger auto-creates 'user' rows on signup — we upsert admin roles)"]
    for r in read_csv("user_roles"):
        new_uid = remap_uuid(r.get("user_id"))
        if not new_uid:
            continue
        granted_by = remap_uuid(r.get("granted_by"))
        lines.append(
            f"INSERT INTO public.user_roles (id, user_id, role, granted_by, granted_at) VALUES ("
            f"{sql_uuid(r['id'])}, "
            f"'{new_uid}', "
            f"'{r['role']}', "
            f"{sql_uuid(granted_by)}, "
            f"{sql_ts(r['granted_at'])}) ON CONFLICT (user_id, role) DO NOTHING;"
        )
    return lines

# ============================================================
# Main
# ============================================================

def main():
    # Validate all UUIDs are filled in
    empty = [email for old, new in UUID_MAP.items()
             if new == "" and old in (
                 "068f231b-ae47-4229-9d54-9edd544d6c6d",
                 "de3937a4-296e-431a-a6d7-68b3c2a24504",
                 "c42a169b-3d9c-4732-b017-c87ff3b7c6f0",
                 "5352c3cf-3e74-4afa-966a-3caa41bd2218",
             )]
    if empty:
        print("WARNING: Some UUID_MAP entries are still empty.")
        print("   Rows for those users will be SKIPPED in the import.")
        print("   Fill in the UUIDs if you want to include all data.\n")

    sections = (
        ["-- EggKeep Data Import",
         "-- Generated by generate_import.py",
         "-- Run in Supabase SQL Editor AFTER combined_schema.sql",
         "",
         "-- Bypass FK checks during bulk import",
         "SET session_replication_role = replica;",
         "",
         "BEGIN;",
        ]
        + gen_item_types()
        + gen_buyers()
        + gen_pack_skus()
        + gen_inflows()
        + gen_outflows()
        + gen_fifo_deductions()
        + gen_activity_logs()
        + gen_user_roles()
        + [
            "",
            "COMMIT;",
            "",
            "-- Restore FK enforcement",
            "SET session_replication_role = DEFAULT;",
            "",
            "-- Verify row counts",
            "SELECT 'inflows'          AS tbl, COUNT(*) FROM public.inflows",
            "UNION ALL SELECT 'outflows',         COUNT(*) FROM public.outflows",
            "UNION ALL SELECT 'activity_logs',    COUNT(*) FROM public.activity_logs",
            "UNION ALL SELECT 'fifo_deductions',  COUNT(*) FROM public.fifo_deductions",
            "UNION ALL SELECT 'buyers',           COUNT(*) FROM public.buyers",
            "UNION ALL SELECT 'item_types',       COUNT(*) FROM public.item_types",
            "UNION ALL SELECT 'pack_skus',        COUNT(*) FROM public.pack_skus",
            "UNION ALL SELECT 'user_roles',       COUNT(*) FROM public.user_roles;",
        ]
    )

    sql = "\n".join(sections)
    OUTPUT_FILE.write_text(sql, encoding="utf-8")

    print(f"[OK] Generated: {OUTPUT_FILE}")
    print(f"     Lines: {sql.count(chr(10))}")
    print()
    print("NEXT STEPS:")
    print("1. Run import_data.sql in Supabase SQL Editor")

if __name__ == "__main__":
    main()
