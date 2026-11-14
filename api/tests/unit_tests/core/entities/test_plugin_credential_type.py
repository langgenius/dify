"""Regression tests for ``core.entities.plugin_credential_type.PluginCredentialType``.

The numeric values of this enum are part of the plugin API contract (see the
inline comments in the source): ``MODEL`` must stay ``0`` and ``TOOL`` must
stay ``1``. Reordering members or switching to ``auto()`` would silently break
clients, so the contract is pinned here.
"""

import enum

import pytest

from core.entities.plugin_credential_type import PluginCredentialType


def test_model_value_is_zero_by_api_contract() -> None:
    assert PluginCredentialType.MODEL.value == 0


def test_tool_value_is_one_by_api_contract() -> None:
    assert PluginCredentialType.TOOL.value == 1


def test_to_number_returns_the_wire_value() -> None:
    assert PluginCredentialType.MODEL.to_number() == 0
    assert PluginCredentialType.TOOL.to_number() == 1


def test_to_number_returns_int() -> None:
    assert isinstance(PluginCredentialType.MODEL.to_number(), int)
    assert isinstance(PluginCredentialType.TOOL.to_number(), int)


def test_construction_from_wire_values() -> None:
    assert PluginCredentialType(0) == PluginCredentialType.MODEL
    assert PluginCredentialType(1) == PluginCredentialType.TOOL


def test_exactly_two_members_exist() -> None:
    assert len(PluginCredentialType) == 2


def test_member_names() -> None:
    assert {member.name for member in PluginCredentialType} == {"MODEL", "TOOL"}


def test_member_values() -> None:
    assert {member.value for member in PluginCredentialType} == {0, 1}


def test_lookup_by_name() -> None:
    assert PluginCredentialType["MODEL"] == PluginCredentialType.MODEL
    assert PluginCredentialType["TOOL"] == PluginCredentialType.TOOL


def test_unknown_name_raises_key_error() -> None:
    # build the name at runtime: a literal is a static `bad-index` error in pyrefly
    unknown = "UNK" + "NOWN"
    with pytest.raises(KeyError):
        PluginCredentialType[unknown]


def test_invalid_wire_value_raises_value_error() -> None:
    with pytest.raises(ValueError, match="not a valid"):
        PluginCredentialType(99)


def test_is_standard_enum() -> None:
    assert issubclass(PluginCredentialType, enum.Enum)


def test_members_are_hashable_and_distinct() -> None:
    assert len({PluginCredentialType.MODEL, PluginCredentialType.TOOL}) == 2


def test_members_are_not_equal_to_their_raw_values() -> None:
    # enum.Enum (not IntEnum): identity is distinct from the underlying int
    assert PluginCredentialType.MODEL != 0
    assert PluginCredentialType.TOOL != 1


def test_repr_contains_member_name() -> None:
    assert "MODEL" in repr(PluginCredentialType.MODEL)
    assert "TOOL" in repr(PluginCredentialType.TOOL)


def test_str_contains_member_name() -> None:
    assert "MODEL" in str(PluginCredentialType.MODEL)
    assert "TOOL" in str(PluginCredentialType.TOOL)
