import json
from datetime import datetime
from typing import TypedDict

import pytest
from pydantic import ValidationError
from sqlalchemy.dialects import sqlite

from core.human_input_v2.entities import HumanInputApproverGrantSubjectType
from models.human_input_v2 import EmailOTPAuthorizationProof, HumanInputV2FormAuditEvent, IMIdentityRawPayload
from models.types import FrozenPydanticModelColumn

_NOW = datetime(2026, 8, 16, 8)


class _EmailOTPProofValues(TypedDict):
    otp_challenge_id: str
    tenant_id: str
    form_id: str
    approver_grant_id: str
    subject_type: HumanInputApproverGrantSubjectType
    contact_id: str
    verified_email: str
    verified_at: datetime


def _email_otp_proof_values() -> _EmailOTPProofValues:
    return {
        "otp_challenge_id": "challenge-1",
        "tenant_id": "tenant-1",
        "form_id": "form-1",
        "approver_grant_id": "grant-1",
        "subject_type": HumanInputApproverGrantSubjectType.CONTACT,
        "contact_id": "contact-1",
        "verified_email": "reviewer@example.com",
        "verified_at": _NOW,
    }


def _authorization_proof_column_type() -> FrozenPydanticModelColumn[EmailOTPAuthorizationProof]:
    column_type = HumanInputV2FormAuditEvent.__table__.c.authorization_proof.type
    assert isinstance(column_type, FrozenPydanticModelColumn)
    return column_type


def test_email_otp_authorization_proof_persists_only_tenant_id() -> None:
    proof = EmailOTPAuthorizationProof(**_email_otp_proof_values())

    assert proof.tenant_id == "tenant-1"
    assert json.loads(proof.model_dump_json()) == {
        "type": "email_otp",
        **_email_otp_proof_values(),
        "verified_at": _NOW.isoformat(),
    }

    serialized = _authorization_proof_column_type().process_bind_param(proof, sqlite.dialect())
    assert serialized is not None
    assert json.loads(serialized)["tenant_id"] == "tenant-1"
    assert "workspace_id" not in json.loads(serialized)


@pytest.mark.parametrize(
    "owner_values",
    [
        {"workspace_id": "tenant-1"},
        {},
    ],
)
def test_email_otp_authorization_proof_rejects_noncanonical_owner(owner_values: dict[str, str]) -> None:
    values: dict[str, object] = dict(_email_otp_proof_values())
    values.pop("tenant_id")
    values.update(owner_values)

    with pytest.raises(ValidationError):
        EmailOTPAuthorizationProof.model_validate(values)

    with pytest.raises(ValidationError):
        _authorization_proof_column_type().process_result_value(json.dumps(values, default=str), sqlite.dialect())


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
