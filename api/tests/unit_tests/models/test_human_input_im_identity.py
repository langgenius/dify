import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import sqlite

from models.human_input_v2 import IMIdentityRawPayload
from models.types import FrozenPydanticModelColumn


def test_im_identity_raw_payload_accepts_only_a_strict_json_object_and_is_frozen() -> None:
    raw_payload = IMIdentityRawPayload({"provider_user": {"id": "provider-user-1"}})

    assert raw_payload.root == {"provider_user": {"id": "provider-user-1"}}
    assert raw_payload.model_config["frozen"] is True
    assert raw_payload.model_config["strict"] is True
    assert raw_payload.model_config["validate_default"] is True
    with pytest.raises(ValidationError):
        IMIdentityRawPayload.model_validate([("provider_user", {"id": "provider-user-1"})])
    with pytest.raises(ValidationError):
        raw_payload.root = {}


def test_im_identity_raw_payload_round_trips_through_its_persistence_column() -> None:
    raw_payload = IMIdentityRawPayload(
        {
            "provider_user": {"id": "provider-user-1"},
            "roles": ["reviewer"],
        }
    )
    column_type = FrozenPydanticModelColumn(IMIdentityRawPayload)

    serialized = column_type.process_bind_param(raw_payload, sqlite.dialect())
    restored = column_type.process_result_value(serialized, sqlite.dialect())

    assert restored == raw_payload
