"""Unit tests for core.tools.entities.values.

The module is the single source of truth for the built-in tool labels that the
marketplace and tool pickers render. The tests pin the contract that every
``ToolLabelEnum`` member has exactly one icon and one default label, that label
names stay in sync with the enum values, and that the exported ``default_tool_*``
helpers reflect the dictionary verbatim.
"""

import pytest

from core.tools.entities.tool_entities import ToolLabelEnum
from core.tools.entities.values import (
    ICONS,
    default_tool_label_dict,
    default_tool_label_name_list,
    default_tool_labels,
)

ALL_LABELS = sorted(ToolLabelEnum, key=lambda label: label.value)


def test_every_tool_label_enum_has_an_icon() -> None:
    assert set(ICONS) == set(ToolLabelEnum)


def test_every_tool_label_enum_has_a_default_label() -> None:
    assert set(default_tool_label_dict) == set(ToolLabelEnum)


def test_icons_are_self_contained_svg_documents() -> None:
    for label, icon in ICONS.items():
        assert icon.startswith("<svg"), f"{label.value} icon is not an svg element"
        assert icon.rstrip().endswith("</svg>"), f"{label.value} icon is not closed"


def test_label_name_matches_enum_value() -> None:
    for tool_label_enum, tool_label in default_tool_label_dict.items():
        assert tool_label.name == tool_label_enum.value


def test_labels_are_translated_for_english_and_chinese() -> None:
    for tool_label in default_tool_labels:
        assert tool_label.label.en_US
        assert tool_label.label.zh_Hans


def test_label_icon_is_the_matching_icon() -> None:
    for tool_label_enum, tool_label in default_tool_label_dict.items():
        assert tool_label.icon == ICONS[tool_label_enum]


def test_default_tool_labels_follow_the_dictionary() -> None:
    assert default_tool_labels == list(default_tool_label_dict.values())


def test_default_tool_label_name_list_follows_the_labels() -> None:
    assert default_tool_label_name_list == [label.name for label in default_tool_labels]


def test_default_tool_label_name_covers_every_enum_value() -> None:
    assert sorted(default_tool_label_name_list) == [label.value for label in ALL_LABELS]


@pytest.mark.parametrize("tool_label_enum", ALL_LABELS, ids=lambda label: label.value)
def test_individual_label_has_complete_metadata(tool_label_enum: ToolLabelEnum) -> None:
    tool_label = default_tool_label_dict[tool_label_enum]

    assert tool_label.name
    assert tool_label.label.en_US
    assert tool_label.label.zh_Hans
    assert tool_label.icon
