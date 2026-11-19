"""Persisted known variants tolerate additive fields without weakening their schema."""

import json

import pytest
from pydantic import BaseModel, JsonValue, ValidationError
from sqlalchemy.dialects import postgresql

from models.human_input_v2 import (
    HumanInputAuditEvent,
    HumanInputIMReconciliationChange,
    HumanInputIMSyncResult,
    HumanInputRecipient,
)
from models.types import FrozenPydanticModelColumn
from repositories.human_input_v2.channel_credentials import ChannelEncryptedCredentials


@pytest.mark.parametrize(
    ("codec", "payload"),
    [
        (HumanInputIMSyncResult.contact_snapshot.type, {"contact_id": "contact", "name": "Contact"}),
        (
            HumanInputIMSyncResult.identity_snapshot.type,
            {"identity_id": "identity", "provider": "slack", "provider_user_id": "U1"},
        ),
        (
            HumanInputIMReconciliationChange.before_snapshot.type,
            {"subject_kind": "identity", "identity_id": "identity", "provider": "slack", "provider_user_id": "U1"},
        ),
        (
            HumanInputIMReconciliationChange.after_snapshot.type,
            {"subject_kind": "binding", "identity_id": "identity", "binding_id": "binding", "contact_id": "contact"},
        ),
        (HumanInputAuditEvent.payload.type, {"type": "form_view", "viewer_ip_address": None}),
        (
            HumanInputAuditEvent.payload.type,
            {
                "type": "otp_send",
                "recipient_id": "recipient",
                "recipient_email": "a@example.com",
                "sender_ip_address": None,
            },
        ),
        (
            HumanInputAuditEvent.payload.type,
            {
                "type": "otp_verification",
                "recipient_id": "recipient",
                "recipient_email": "a@example.com",
                "succeeded": False,
                "submitter_ip_address": None,
                "reason": "wrong code",
            },
        ),
        (
            HumanInputAuditEvent.payload.type,
            {"type": "im_callback_verification", "succeeded": True, "request_ip_address": None, "reason": "accepted"},
        ),
        (
            HumanInputAuditEvent.payload.type,
            {"type": "form_submission", "recipient_id": "recipient", "end_user_id": "end-user"},
        ),
        *[
            (HumanInputRecipient.sources.type, [source])
            for source in [
                {"type": "all_workspace_contacts"},
                {"type": "contact", "contact_id": "contact"},
                {"type": "dynamic_email", "selector": ["node", "email"]},
                {"type": "onetime_email", "email": "a@example.com"},
                {"type": "initiator"},
            ]
        ],
    ],
)
def test_json_columns_read_historical_and_additive_known_variants(
    codec: FrozenPydanticModelColumn[BaseModel], payload: dict[str, JsonValue] | list[dict[str, JsonValue]]
) -> None:
    historical = codec.process_result_value(json.dumps(payload), postgresql.dialect())
    extension: dict[str, JsonValue] = {"future_optional": None, "future_extension": {"nested": [1, {"optional": None}]}}
    extended = payload | extension if isinstance(payload, dict) else [payload[0] | extension]

    assert codec.process_result_value(json.dumps(extended), postgresql.dialect()) == historical


@pytest.mark.parametrize(
    "payload",
    [
        {"version": 1, "ciphertext": "encrypted", "future_extension": None},
        {"version": 2, "ciphertext": "encrypted"},
    ],
)
def test_credential_envelope_requires_its_exact_supported_format(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ChannelEncryptedCredentials.model_validate_json(json.dumps(payload))


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "im_callback_verification", "succeeded": "yes", "request_ip_address": None, "reason": "accepted"},
        {"type": "future_audit_event"},
    ],
)
def test_audit_known_fields_and_discriminators_remain_validated(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        HumanInputAuditEvent.payload.type.process_result_value(json.dumps(payload), postgresql.dialect())
