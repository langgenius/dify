"""Test-only rendering against Web's English catalog; backend owns no copy."""

import json
import re
from dataclasses import asdict, is_dataclass
from pathlib import Path

_CATALOG = json.loads((Path(__file__).resolve().parents[5] / "web/i18n/locales/en-US/dify-builder.json").read_text())


def english_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if is_dataclass(value) and not isinstance(value, type):
        value = asdict(value)
    assert isinstance(value, dict)
    if value.get("type") == "parts":
        return "".join(english_text(part) for part in value["parts"])
    assert value["type"] == "copy"
    text = _CATALOG["copy." + value["id"]]
    return re.sub(r"\{\{(\w+)\}\}", lambda match: str(value["params"][match[1]]), text)


def english_tree(value: object) -> object:
    if isinstance(value, dict):
        if value.get("type") in {"copy", "parts"}:
            return english_text(value)
        return {key: english_tree(child) for key, child in value.items()}
    if isinstance(value, list):
        return [english_tree(child) for child in value]
    return value
