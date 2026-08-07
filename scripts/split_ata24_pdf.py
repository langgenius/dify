# -*- coding: utf-8 -*-
"""Split ATA Chapter 24 PDF by level-2 outline (Effective Pages / Contents / Sections)."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import fitz

SRC = Path(r"D:\Users\RC_Laptop\Desktop\24___090.PDF")
OUT_DIR = Path(r"D:\Users\RC_Laptop\Desktop\24_ELECTRICAL_POWER_拆分")

SECTION_RE = re.compile(r"^Section\s+(\d{2}-\d{2})\b", re.I)
FRONT_RE = re.compile(r"^24\s*-\s*(Effective Pages|Contents)\b", re.I)


def safe_filename(name: str) -> str:
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    name = re.sub(r"\s+", " ", name).strip().rstrip(".")
    return name


def main() -> int:
    if not SRC.exists():
        print(f"missing source: {SRC}", file=sys.stderr)
        return 1

    doc = fitz.open(SRC)
    toc = doc.get_toc(simple=True)
    print(f"source={SRC}")
    print(f"pages={doc.page_count} toc={len(toc)}")

    # Level-2 bookmarks matching the navigation pane in the screenshot
    cuts: list[tuple[str, int, str]] = []
    for lvl, title, page in toc:
        if lvl != 2:
            continue
        title_clean = " ".join(str(title).split())
        if SECTION_RE.match(title_clean) or FRONT_RE.match(title_clean):
            cuts.append((title_clean, page, title_clean))

    if not cuts:
        print("No level-2 Section/front-matter bookmarks found", file=sys.stderr)
        return 2

    # Include chapter cover pages (1 .. first_cut-1) as a separate file if any
    first_page = cuts[0][1]
    ranges: list[tuple[str, int, int]] = []
    if first_page > 1:
        ranges.append(("Chapter 24 - ELECTRICAL POWER (cover)", 1, first_page - 1))

    for i, (title, start, _) in enumerate(cuts):
        end = cuts[i + 1][1] - 1 if i + 1 < len(cuts) else doc.page_count
        if end < start:
            print(f"WARN skip inverted {title}: {start}-{end}", file=sys.stderr)
            continue
        ranges.append((title, start, end))

    print("--- ranges ---")
    for title, start, end in ranges:
        print(f"{start:>4}-{end:<4} ({end - start + 1:>3}p)  {title}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    written: list[tuple[str, int, int, int]] = []

    for title, start, end in ranges:
        out_name = f"{safe_filename(title)}.pdf"
        out_path = OUT_DIR / out_name
        new_doc = fitz.open()
        new_doc.insert_pdf(doc, from_page=start - 1, to_page=end - 1)
        new_doc.save(out_path, garbage=3, deflate=True)
        new_doc.close()
        n = end - start + 1
        written.append((out_name, start, end, n))
        print(f"OK {out_name}  {start}-{end} ({n})")

    index_path = OUT_DIR / "_拆分说明.txt"
    with index_path.open("w", encoding="utf-8") as f:
        f.write(f"源文件: {SRC}\n")
        f.write(f"总页数: {doc.page_count}\n")
        f.write("拆分规则: PDF 书签 level-2（24 Effective Pages / Contents / Section 24-xx），\n")
        f.write("每段从该书签页到下一书签前一页；封面页单独成文件。源文件未修改。\n\n")
        for name, start, end, n in written:
            f.write(f"{name}\t页{start}-{end}\t{n}页\n")

    doc.close()
    print(f"\nDone: {len(written)} PDFs + index -> {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
