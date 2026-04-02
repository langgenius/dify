import json
from typing import Any


def parse_json_object(value: str | None, *, field_name: str) -> dict[str, Any]:
    if not value:
        return {}
    try:
        data = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field_name} must be valid JSON") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{field_name} must be a JSON object")
    return data


def to_int(value: Any, *, default: int) -> int:
    if value is None or value == "":
        return default
    return int(value)
