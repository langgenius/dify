from __future__ import annotations

import pytest

from libs.emoji_normalization import (
    is_emoji_icon_type,
    normalize_icon_for_storage,
    normalize_icon_info_dict,
    normalize_legacy_emoji_id,
    normalize_legacy_emoji_value,
    resolve_emoji_for_display,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("rabbit", "🐰"),
        ("robot_face", "🤖"),
        ("satisfied", "😆"),
        (":+1:", "👍"),
        ("🐻", "🐻"),
        ("👩🏽‍💻", "👩🏽‍💻"),
        ("unknown-id", "unknown-id"),
    ],
)
def test_normalize_legacy_emoji_id(value: str, expected: str) -> None:
    assert normalize_legacy_emoji_id(value) == expected


def test_normalize_legacy_emoji_value_preserves_empty_and_none() -> None:
    assert normalize_legacy_emoji_value(None) is None
    assert normalize_legacy_emoji_value("") == ""


def test_resolve_emoji_for_display_default() -> None:
    assert resolve_emoji_for_display(None) == "🤖"
    assert resolve_emoji_for_display("") == "🤖"
    assert resolve_emoji_for_display("rabbit") == "🐰"


def test_normalize_icon_for_storage_skips_non_emoji_types() -> None:
    assert normalize_icon_for_storage("image", "file-id") == "file-id"
    assert normalize_icon_for_storage(None, "not-a-legacy-emoji-id") == "not-a-legacy-emoji-id"
    assert normalize_icon_for_storage(None, "rabbit") == "🐰"


def test_normalize_icon_for_storage_resolves_emoji() -> None:
    assert normalize_icon_for_storage("emoji", "robot_face") == "🤖"


def test_normalize_icon_info_dict() -> None:
    assert normalize_icon_info_dict({"icon_type": "emoji", "icon": "rabbit"}) == {
        "icon_type": "emoji",
        "icon": "🐰",
    }
    assert normalize_icon_info_dict({"icon_type": "image", "icon": "rabbit"}) == {
        "icon_type": "image",
        "icon": "rabbit",
    }


def test_is_emoji_icon_type() -> None:
    assert is_emoji_icon_type("emoji") is True
    assert is_emoji_icon_type("EMOJI") is True
    assert is_emoji_icon_type("image") is False
