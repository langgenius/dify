import pytest

from models.enums import CreatorUserRole


def test_creator_user_role_missing_maps_hyphen_to_enum():
    # given an alias with hyphen
    value = "end-user"

    # when converting to enum (invokes StrEnum._missing_ override)
    role = CreatorUserRole(value)

    # then it should map to END_USER
    assert role is CreatorUserRole.END_USER


def test_creator_user_role_missing_raises_for_unknown():
    with pytest.raises(ValueError):
        CreatorUserRole("unknown")
