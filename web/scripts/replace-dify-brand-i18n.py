#!/usr/bin/env python3
"""Replace user-facing Dify/dify brand strings with Bots/bots in web/i18n JSON values only."""

from __future__ import annotations

import json
import re
from pathlib import Path


def transform_string(s: str) -> str:
    protected: list[str] = []

    def shield(pattern: str, text: str) -> str:
        def repl(m: re.Match[str]) -> str:
            protected.append(m.group(0))
            return f"\x00{len(protected) - 1}\x00"

        return re.sub(pattern, repl, text)

    t = s
    t = shield(r"\{\{[^}]+\}\}", t)
    t = shield(r"mailto:[^\s>\"\]]+", t)
    t = shield(r"https?://[^\s\]<>\"\')]+", t)
    t = shield(r"[^\s@<>]+@[^\s@<>]+", t)

    # Possessive / inflected forms (ASCII); avoids splitting minimalDifyVersion (preceded by 'l').
    for old, new in (
        ("Dify's", "Bots'"),
        ("Difys ", "Bots' "),
        ("Difys,", "Bots',"),
        ("Difys.", "Bots'."),
        ("Difyju ", "Bots "),
        ("Difyju,", "Bots,"),
        ("Difyju.", "Bots."),
    ):
        t = t.replace(old, new)

    # CJK and punctuation-adjacent "Dify": \b fails when neighbors are Unicode letters.
    t = re.sub(r"(?<![A-Za-z])Dify(?![a-z])", "Bots", t)
    t = re.sub(r"(?<![A-Za-z])dify(?![a-z])", "bots", t)

    for i, orig in enumerate(protected):
        t = t.replace(f"\x00{i}\x00", orig)
    return t


def walk(obj: object) -> object:
    if isinstance(obj, dict):
        return {k: walk(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [walk(v) for v in obj]
    if isinstance(obj, str):
        return transform_string(obj)
    return obj


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    i18n = root / "i18n"
    for path in sorted(i18n.rglob("*.json")):
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
        new_data = walk(data)
        path.write_text(json.dumps(new_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
