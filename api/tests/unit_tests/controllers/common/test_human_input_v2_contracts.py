from __future__ import annotations

from collections.abc import Mapping

import pytest
from pydantic import TypeAdapter, ValidationError

from controllers.common import human_input_v2_contracts as contracts
from controllers.common.human_input import HumanInputFormSubmitPayload
from controllers.common.human_input_v2_contracts import (
    BatchGetContactsQuery,
    ExternalContactCreateRequest,
    FormAccessRequestResponse,
    HumanInputV2ServiceFormSubmitRequest,
    IMSyncResultItem,
    IMSyncRun,
    ListIMIdentitiesQuery,
    MessageTemplateTestRequest,
    NodeDataMigrationFailureResponse,
    NodeDataMigrationPayload,
    NodeDataMigrationResponse,
)
from controllers.common.human_input_v2_migration import preflight_legacy_human_input_node_data
from core.workflow.nodes.human_input_v2.entities import RecipientConfig


def _as_mapping(value: object) -> Mapping[str, object]:
    assert isinstance(value, Mapping)
    return value


def test_request_dto_coerces_enum_values_and_forbids_extra_fields() -> None:
    request_body = MessageTemplateTestRequest.model_validate({"channel": "email", "inputs": {}})

    assert request_body.channel.value == "email"

    with pytest.raises(ValidationError):
        MessageTemplateTestRequest.model_validate({"channel": "email", "inputs": {}, "unexpected": True})


def test_sync_run_exposes_captured_revision() -> None:
    sync_run = IMSyncRun.model_validate(
        {
            "id": "run-id",
            "status": "queued",
            "result_counts": {"added": 0, "not_matched": 0, "failed": 0, "removed": 0, "skipped": 0},
            "provider": "feishu",
            "integration_id": "integration-id",
            "integration_config_version": 4,
        }
    )

    assert sync_run.integration_id == "integration-id"
    assert sync_run.integration_config_version == 4


def test_external_contact_avatar_is_optional() -> None:
    request_body = ExternalContactCreateRequest.model_validate(
        {
            "name": "External Approver",
            "email": "approver@example.com",
        }
    )

    assert request_body.avatar is None


def test_node_data_migration_contract_matches_frontend_adapter_boundary() -> None:
    request_body = NodeDataMigrationPayload.model_validate(
        {
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "version": "1",
                        "future_legacy_field": "ignored",
                    },
                    "future_envelope_field": "ignored",
                }
            ],
            "future_request_field": "ignored",
        }
    )

    assert request_body.nodes[0].node_data.version == "1"
    assert not hasattr(request_body.nodes[0].node_data, "future_legacy_field")
    assert set(NodeDataMigrationResponse.model_json_schema()["properties"]) == {"data"}
    assert contracts.LegacyHITLv1NodeData.model_json_schema()["properties"]["version"]["const"] == "1"

    failure = NodeDataMigrationFailureResponse.model_validate(
        {
            "message": "Migration failed",
            "status": 400,
            "blockers": [
                {
                    "node_id": "node-1",
                    "node_title": "Approval",
                    "code": "unresolved-member",
                    "method_id": "email-1",
                    "value": "member-1",
                }
            ],
        }
    )

    assert failure.blockers[0].code == "unresolved-member"

    with pytest.raises(ValidationError):
        NodeDataMigrationPayload.model_validate(
            {
                "nodes": [
                    {
                        "node_id": "node-1",
                        "node_data": {"title": "Approval", "version": "2"},
                    }
                ]
            }
        )

    with pytest.raises(ValidationError):
        NodeDataMigrationPayload.model_validate(
            {
                "nodes": [
                    {"node_id": "node-1", "node_data": {"title": "Approval", "version": "1"}},
                    {"node_id": "node-1", "node_data": {"title": "Approval", "version": "1"}},
                ]
            }
        )


def test_node_data_migration_transport_defers_raw_delivery_semantics_to_preflight() -> None:
    request_body = NodeDataMigrationPayload.model_validate(
        {
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "delivery_methods": [
                            {"id": "33333333-3333-4333-8333-333333333333", "type": "sms", "config": {}},
                            {
                                "id": "11111111-1111-4111-8111-111111111111",
                                "type": "email",
                                "config": {
                                    "subject": "Subject",
                                    "body": 7,
                                    "recipients": {"items": [{"type": "external", "email": "invalid-email"}]},
                                },
                            },
                        ],
                    },
                }
            ]
        }
    )

    methods = request_body.nodes[0].node_data.delivery_methods
    first_method = _as_mapping(methods[0])
    second_method = _as_mapping(methods[1])
    second_config = _as_mapping(second_method["config"])
    assert [first_method["type"], second_method["type"]] == ["sms", "email"]
    assert second_config["body"] == 7

    preflight = preflight_legacy_human_input_node_data(request_body.nodes[0].node_data)
    assert [(issue.code, issue.value) for issue in preflight.issues] == [
        ("unsupported-delivery-method", "sms"),
        ("invalid-email-configuration", "body"),
    ]
    assert preflight.node_data.delivery_methods == []


def test_node_data_migration_transport_normalizes_real_and_compatibility_member_ids() -> None:
    request_body = NodeDataMigrationPayload.model_validate(
        {
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "delivery_methods": [
                            {
                                "id": "11111111-1111-4111-8111-111111111111",
                                "type": "email",
                                "config": {
                                    "subject": "Review",
                                    "body": "Please review",
                                    "recipients": {
                                        "items": [
                                            {"type": "member", "user_id": "member-real"},
                                            {"type": "member", "reference_id": "member-compat"},
                                        ]
                                    },
                                },
                            }
                        ],
                    },
                }
            ]
        }
    )

    preflight = preflight_legacy_human_input_node_data(request_body.nodes[0].node_data)
    assert preflight.issues == ()
    method = preflight.node_data.delivery_methods[0]
    assert method.type == "email"
    assert [source.user_id for source in method.config.recipients.items] == ["member-real", "member-compat"]


def test_node_data_migration_transport_preserves_real_im_configuration_for_preflight_blockers() -> None:
    request_body = NodeDataMigrationPayload.model_validate(
        {
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "delivery_methods": [
                            {
                                "id": "im-1",
                                "type": "im",
                                "enabled": True,
                                "config": {
                                    "provider": "slack",
                                    "message": "Please review",
                                    "recipients": {
                                        "items": [
                                            {"type": "channel", "channel_id": "channel-1"},
                                            {"type": "user", "user_id": "user-1"},
                                        ]
                                    },
                                },
                            },
                            {
                                "id": "future-1",
                                "type": "future-channel",
                                "enabled": False,
                                "config": {"message": "Configured"},
                            },
                        ],
                    },
                }
            ]
        }
    )

    methods = request_body.nodes[0].node_data.delivery_methods
    first_method = _as_mapping(methods[0])
    first_config = _as_mapping(first_method["config"])
    second_method = _as_mapping(methods[1])
    second_config = _as_mapping(second_method["config"])
    assert first_config["recipients"] == {
        "items": [
            {"type": "channel", "channel_id": "channel-1"},
            {"type": "user", "user_id": "user-1"},
        ]
    }
    assert first_config["message"] == "Please review"
    assert second_config["message"] == "Configured"

    preflight = preflight_legacy_human_input_node_data(request_body.nodes[0].node_data)
    assert [(issue.code, issue.value) for issue in preflight.issues] == [
        ("unsupported-delivery-method", "im"),
        ("unsupported-delivery-method", "future-channel"),
    ]


@pytest.mark.parametrize("version", ["2", "v1", 1, None])
def test_node_data_migration_rejects_every_explicit_non_v1_version(version: object) -> None:
    with pytest.raises(ValidationError):
        NodeDataMigrationPayload.model_validate(
            {"nodes": [{"node_id": "node-1", "node_data": {"title": "Approval", "version": version}}]}
        )


def test_node_data_migration_defaults_missing_version_and_requires_non_empty_batch() -> None:
    request_body = NodeDataMigrationPayload.model_validate(
        {"nodes": [{"node_id": "node-1", "node_data": {"title": "Approval"}}]}
    )

    assert request_body.nodes[0].node_data.version == "1"
    with pytest.raises(ValidationError):
        NodeDataMigrationPayload.model_validate({"nodes": []})


def test_node_data_migration_failure_envelope_never_serializes_partial_data() -> None:
    failure = NodeDataMigrationFailureResponse.model_validate(
        {
            "message": "Migration failed",
            "status": 400,
            "blockers": [
                {
                    "node_id": "node-1",
                    "node_title": "Approval",
                    "code": "missing-recipients",
                }
            ],
            "data": [{"node_id": "node-valid", "node_data": {}}],
        }
    )

    assert set(failure.model_dump(mode="json")) == {"code", "message", "status", "blockers"}


def test_node_data_migration_failure_contract_exposes_invalid_default_value_blocker() -> None:
    failure = NodeDataMigrationFailureResponse.model_validate(
        {
            "message": "Migration failed",
            "status": 400,
            "blockers": [
                {
                    "node_id": "node-1",
                    "node_title": "Approval",
                    "code": "invalid-default-value",
                    "value": "default_value",
                }
            ],
        }
    )

    assert failure.blockers[0].code == "invalid-default-value"


def test_node_data_migration_marker_has_exact_typed_wire_shape() -> None:
    recipient_adapter = TypeAdapter(RecipientConfig)

    marker = recipient_adapter.validate_python({"type": "all_workspace_contacts"})

    assert marker.model_dump(mode="json") == {"type": "all_workspace_contacts"}
    with pytest.raises(ValidationError):
        recipient_adapter.validate_python({"type": "all_workspace_contacts", "contact_ids": []})

    response_schema = NodeDataMigrationResponse.model_json_schema()
    marker_schema = response_schema["$defs"]["AllWorkspaceContacts"]
    assert marker_schema["additionalProperties"] is False
    assert marker_schema["properties"]["type"]["const"] == "all_workspace_contacts"


def test_node_data_migration_success_schema_forces_human_input_node_type() -> None:
    request_body = NodeDataMigrationPayload.model_validate(
        {
            "nodes": [
                {
                    "node_id": "node-1",
                    "node_data": {
                        "title": "Approval",
                        "type": "code",
                        "delivery_methods": [
                            {"id": "22222222-2222-4222-8222-222222222222", "type": "webapp", "config": {}}
                        ],
                    },
                }
            ]
        }
    )
    response_schema = NodeDataMigrationResponse.model_json_schema()

    assert not hasattr(request_body.nodes[0].node_data, "type")
    assert response_schema["$defs"]["HumanInputNodeData"]["properties"]["type"]["const"] == "human-input"


@pytest.mark.parametrize(
    "recipient_value",
    [
        {"type": "contact", "contact_id": "contact-1"},
        {"type": "dynamic_email", "selector": ["node-1", "email"]},
        {"type": "onetime_email", "email": "approver@example.com"},
        {"type": "initiator"},
        {"type": "all_workspace_contacts"},
    ],
)
def test_recipient_union_preserves_existing_and_migration_variants(recipient_value: dict[str, object]) -> None:
    recipient = TypeAdapter(RecipientConfig).validate_python(recipient_value)

    assert recipient.model_dump(mode="json") == recipient_value


def test_v1_and_v2_submit_payloads_are_independent() -> None:
    v2_submit_model = getattr(contracts, "HumanInputV2FormSubmitRequest", None)
    assert v2_submit_model is not None

    v1_schema = HumanInputFormSubmitPayload.model_json_schema()
    v2_schema = v2_submit_model.model_json_schema()

    assert "challenge_token" not in v1_schema["properties"]
    assert "otp_code" not in v1_schema["properties"]
    assert "challenge_token" in v2_schema["properties"]
    assert "otp_code" in v2_schema["properties"]


def test_service_v2_submit_payload_does_not_accept_public_otp_fields() -> None:
    payload: dict[str, object] = {
        "user": "end-user",
        "inputs": {},
        "action": "approve",
    }

    request_body = HumanInputV2ServiceFormSubmitRequest.model_validate(payload)

    assert request_body.user == "end-user"
    with pytest.raises(ValidationError):
        HumanInputV2ServiceFormSubmitRequest.model_validate({**payload, "otp_code": "123456"})


def test_public_v2_submit_requires_complete_email_proof() -> None:
    submit_model = contracts.HumanInputV2FormSubmitRequest
    base_payload: dict[str, object] = {"inputs": {}, "action": "approve"}

    submit_model.model_validate(base_payload)
    submit_model.model_validate(
        {
            **base_payload,
            "challenge_token": "challenge-token",
            "otp_code": "123456",
        }
    )

    with pytest.raises(ValidationError):
        submit_model.model_validate({**base_payload, "otp_code": "123456"})

    with pytest.raises(ValidationError):
        submit_model.model_validate({**base_payload, "challenge_token": "challenge-token"})


def test_access_request_response_exposes_resend_cooldown() -> None:
    schema = FormAccessRequestResponse.model_json_schema()

    assert "resend_after_seconds" in schema["properties"]


def test_batch_get_contacts_query_forbids_extra_fields() -> None:
    with pytest.raises(ValidationError):
        BatchGetContactsQuery.model_validate({"contact_ids": ["contact-1"], "unexpected": True})


def test_sync_result_item_has_no_contact_type() -> None:
    schema = IMSyncResultItem.model_json_schema()

    assert "type" not in schema["properties"]


def test_im_identity_search_includes_provider_user_id() -> None:
    keyword_description = ListIMIdentitiesQuery.model_json_schema()["properties"]["keyword"]["description"]

    assert "provider user ID" in keyword_description
