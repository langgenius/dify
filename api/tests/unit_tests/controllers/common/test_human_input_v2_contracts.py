from __future__ import annotations

import pytest
from pydantic import ValidationError

from controllers.common import human_input_v2_contracts as contracts
from controllers.common.human_input import HumanInputFormSubmitPayload
from controllers.common.human_input_v2_contracts import (
    BatchGetContactsQuery,
    ExternalContactCreateRequest,
    FormAccessRequestResponse,
    HumanInputV2ServiceFormSubmitRequest,
    IMIntegration,
    IMSyncResultItem,
    IMSyncRun,
    ListIMIdentitiesQuery,
    MessageTemplateTestRequest,
    NodeDataMigrationFailureResponse,
    NodeDataMigrationPayload,
    NodeDataMigrationResponse,
    UpdateIMIntegrationRequest,
)


def test_request_dto_coerces_enum_values_and_forbids_extra_fields() -> None:
    request_body = MessageTemplateTestRequest.model_validate({"channel": "email", "inputs": {}})

    assert request_body.channel.value == "email"

    with pytest.raises(ValidationError):
        MessageTemplateTestRequest.model_validate({"channel": "email", "inputs": {}, "unexpected": True})


def test_update_im_integration_cas_fields_are_both_present_or_both_absent() -> None:
    credentials = {
        "provider": "feishu",
        "app_id": "app-id",
        "app_secret": "app-secret",
    }

    create_request = UpdateIMIntegrationRequest.model_validate({"credentials": credentials})
    update_request = UpdateIMIntegrationRequest.model_validate(
        {
            "credentials": credentials,
            "expected_integration_id": "integration-id",
            "expected_config_version": 3,
        }
    )

    assert create_request.expected_integration_id is None
    assert create_request.expected_config_version is None
    assert update_request.expected_integration_id == "integration-id"
    assert update_request.expected_config_version == 3

    with pytest.raises(ValidationError):
        UpdateIMIntegrationRequest.model_validate(
            {
                "credentials": credentials,
                "expected_integration_id": "integration-id",
            }
        )


def test_im_integration_and_sync_run_expose_captured_revision() -> None:
    integration = IMIntegration.model_validate(
        {
            "provider": "feishu",
            "status": "connected",
            "integration_id": "integration-id",
            "config_version": 4,
        }
    )
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

    assert integration.integration_id == "integration-id"
    assert integration.config_version == 4
    assert sync_run.integration_id == "integration-id"
    assert sync_run.integration_config_version == 4


def test_delete_im_integration_requires_complete_cas_token() -> None:
    delete_query_model = getattr(contracts, "DeleteIMIntegrationQuery", None)
    assert delete_query_model is not None

    query = delete_query_model.model_validate(
        {
            "expected_integration_id": "integration-id",
            "expected_config_version": "4",
        }
    )

    assert query.expected_integration_id == "integration-id"
    assert query.expected_config_version == 4

    with pytest.raises(ValidationError):
        delete_query_model.model_validate({"expected_integration_id": "integration-id"})


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
                        "node_data": {"version": "2"},
                    }
                ]
            }
        )

    with pytest.raises(ValidationError):
        NodeDataMigrationPayload.model_validate(
            {
                "nodes": [
                    {"node_id": "node-1", "node_data": {"version": "1"}},
                    {"node_id": "node-1", "node_data": {"version": "1"}},
                ]
            }
        )


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
    payload = {
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
    base_payload = {"inputs": {}, "action": "approve"}

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
