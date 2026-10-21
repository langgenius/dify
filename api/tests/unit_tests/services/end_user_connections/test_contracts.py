from datetime import datetime
from uuid import UUID

import pytest
from pydantic import ValidationError

from constants.end_user_connections import ConnectionCredentialType, ConnectionStatus
from services.end_user_connections.contracts import (
    ConnectionOAuthStart,
    ConnectionPage,
    ConnectionSummary,
    CreateApiKeyConnectionInput,
    ListConnectionsInput,
    StartConnectionOAuthInput,
    UpdateConnectionInput,
)

WORKFLOW_ID = "019a0000-0000-7000-8000-000000000001"


def create_payload() -> dict[str, object]:
    return {
        "workflow_id": WORKFLOW_ID,
        "node_id": "1730000000000",
        "name": "My calendar",
        "credentials": {"api_key": "secret-sentinel"},
    }


@pytest.mark.parametrize(
    "field", ["tenant_id", "app_id", "account_id", "end_user_id", "owner", "provider", "oauth_client", "revision"]
)
def test_create_input_cannot_supply_authority_or_provider_configuration(field: str) -> None:
    with pytest.raises(ValidationError):
        CreateApiKeyConnectionInput.model_validate({**create_payload(), field: "forged"})


def test_create_input_keeps_credentials_out_of_repr_and_validation_messages() -> None:
    command = CreateApiKeyConnectionInput.model_validate(create_payload())
    assert command.workflow_id == UUID(WORKFLOW_ID)
    assert command.credentials == {"api_key": "secret-sentinel"}
    assert "secret-sentinel" not in repr(command)
    with pytest.raises(ValidationError) as exc:
        CreateApiKeyConnectionInput.model_validate({**create_payload(), "workflow_id": "invalid"})
    assert "secret-sentinel" not in str(exc.value)


@pytest.mark.parametrize("name", ["", "n" * 101])
def test_create_name_respects_storage_limits(name: str) -> None:
    with pytest.raises(ValidationError):
        CreateApiKeyConnectionInput.model_validate({**create_payload(), "name": name})


@pytest.mark.parametrize("node_id", ["", "n" * 256])
def test_create_node_reference_respects_storage_limits(node_id: str) -> None:
    with pytest.raises(ValidationError):
        CreateApiKeyConnectionInput.model_validate({**create_payload(), "node_id": node_id})


def test_create_rejects_empty_credentials() -> None:
    with pytest.raises(ValidationError):
        CreateApiKeyConnectionInput.model_validate({**create_payload(), "credentials": {}})


@pytest.mark.parametrize("payload", [{}, {"name": None}, {"credentials": None}, {"credentials": {}}, {"name": ""}])
def test_update_rejects_empty_changes_and_explicit_null(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        UpdateConnectionInput.model_validate(payload)


def test_update_distinguishes_omission_and_full_replacement() -> None:
    rename = UpdateConnectionInput(name="Renamed")
    assert rename.credentials is None
    assert rename.model_fields_set == {"name"}
    replacement = UpdateConnectionInput(credentials={"api_key": "secret-sentinel"})
    assert replacement.name is None
    assert replacement.model_fields_set == {"credentials"}
    assert "secret-sentinel" not in repr(replacement)


@pytest.mark.parametrize("limit", [0, 101, "20", True])
def test_list_limit_is_bounded_and_strict(limit: object) -> None:
    with pytest.raises(ValidationError):
        ListConnectionsInput.model_validate({"limit": limit})


def test_oauth_start_does_not_accept_browser_supplied_tokens_or_client() -> None:
    for field in ("credentials", "oauth_client", "client_id", "client_secret", "redirect_uri", "context_id"):
        with pytest.raises(ValidationError):
            StartConnectionOAuthInput.model_validate(
                {"workflow_id": WORKFLOW_ID, "node_id": "node", "name": "My account", field: "secret-sentinel"}
            )


def test_management_summary_cannot_serialize_internal_credential_state() -> None:
    summary = ConnectionSummary(
        id="connection",
        name="My calendar",
        provider="vendor/calendar/calendar",
        credential_type=ConnectionCredentialType.API_KEY,
        status=ConnectionStatus.CONNECTED,
        account_label=None,
        expires_at=None,
        created_at=datetime(2026, 10, 21),
        updated_at=datetime(2026, 10, 21),
        last_active_at=datetime(2026, 10, 21),
    )
    for field in ("credentials", "encrypted_credentials", "account_id", "end_user_id", "tenant_id", "oauth_client_id"):
        with pytest.raises(ValidationError):
            ConnectionSummary.model_validate({**summary.model_dump(), field: "secret-sentinel"})


def test_oauth_context_is_not_exposed_in_response_body_or_repr() -> None:
    result = ConnectionOAuthStart(authorization_url="https://provider.example/authorize", context_id="context-secret")
    assert result.model_dump() == {"authorization_url": "https://provider.example/authorize"}
    assert "context-secret" not in repr(result)


@pytest.mark.parametrize(("cursor", "has_more"), [(None, False), ("next-page", True)])
def test_page_result_keeps_cursor_and_has_more_consistent(cursor: str | None, has_more: bool) -> None:
    assert ConnectionPage(data=(), next_cursor=cursor).model_dump(mode="json") == {
        "data": [],
        "next_cursor": cursor,
        "has_more": has_more,
    }
