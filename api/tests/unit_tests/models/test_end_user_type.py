"""end user type tests."""

from pathlib import Path

import pytest

from models.enums import EndUserType
from models.model import EndUser
from models.types import EnumText

API_ROOT = Path(__file__).resolve().parents[3]


def test_end_user_type_covers_persisted_creation_values():
    assert {member.value for member in EndUserType} == {
        "app-deploy",
        "browser",
        "mcp",
        "openapi",
        "service-api",
        "trigger",
    }


def test_end_user_type_is_plain_persisted_value_enum():
    assert not hasattr(EndUserType, "from_invoke_from")


def test_end_user_type_rejects_legacy_service_api_value():
    with pytest.raises(ValueError):
        EndUserType("service_api")

    assert EndUserType("service-api") is EndUserType.SERVICE_API


def test_end_user_type_still_rejects_unknown_values():
    with pytest.raises(ValueError):
        EndUserType("not-a-real-end-user-type")


def test_end_user_type_column_uses_enum_text():
    column_type = EndUser.__table__.c.type.type

    assert isinstance(column_type, EnumText)
    assert column_type._enum_class is EndUserType
