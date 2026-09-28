"""Normalize persisted Emoji Mart shortcodes to Unicode for storage and API responses."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Final

_LEGACY_JSON_PATH = Path(__file__).with_name("emoji_legacy.json")
_DEFAULT_DISPLAY_EMOJI: Final = "🤖"


@lru_cache(maxsize=1)
def legacy_emoji_map() -> dict[str, str]:
    with _LEGACY_JSON_PATH.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("emoji legacy map must be a JSON object")
    return data


def strip_leading_trailing_colons(value: str) -> str:
    """Match ``web/utils/emoji.ts`` colon trimming for shortcode-style values."""
    while value.startswith(":"):
        value = value[1:]
    while value.endswith(":"):
        value = value[:-1]
    return value


def normalize_legacy_emoji_id(value: str) -> str:
    """Resolve a legacy Emoji Mart id/alias to Unicode; preserve Unicode and unknown ids."""
    if not value:
        return value
    emoji_id = strip_leading_trailing_colons(value)
    resolved = legacy_emoji_map().get(emoji_id)
    if resolved is not None:
        return resolved
    return value


def normalize_legacy_emoji_value(value: str | None) -> str | None:
    if value is None:
        return None
    if not value:
        return value
    return normalize_legacy_emoji_id(value)


def resolve_emoji_for_display(value: str | None, *, default: str = _DEFAULT_DISPLAY_EMOJI) -> str:
    if not value:
        return default
    return normalize_legacy_emoji_id(value)


def is_emoji_icon_type(icon_type: Any | None) -> bool:
    if icon_type is None:
        return False
    if hasattr(icon_type, "value"):
        icon_type = icon_type.value
    return str(icon_type).lower() == "emoji"


def normalize_icon_for_storage(icon_type: Any | None, icon: str | None) -> str | None:
    if icon is None:
        return None
    if icon_type is not None and not is_emoji_icon_type(icon_type):
        return icon
    if icon_type is None and icon not in legacy_emoji_map():
        return icon
    return normalize_legacy_emoji_value(icon)


def ensure_model_emoji_icon_normalized(model: Any) -> Any:
    """Normalize emoji icons on pydantic response models after validation."""
    icon = getattr(model, "icon", None)
    if icon is None:
        return model
    icon_type = getattr(model, "icon_type", None)
    normalized = normalize_icon_for_storage(icon_type, icon)
    if normalized is not None and normalized != icon:
        model.icon = normalized
    return model


def normalize_icon_info_dict(icon_info: dict[str, Any] | None) -> dict[str, Any] | None:
    if not icon_info:
        return icon_info
    icon_type = icon_info.get("icon_type", "emoji")
    icon = icon_info.get("icon")
    if not isinstance(icon, str) or not is_emoji_icon_type(icon_type):
        return icon_info
    normalized = normalize_legacy_emoji_value(icon)
    if normalized == icon:
        return icon_info
    return {**icon_info, "icon": normalized}
