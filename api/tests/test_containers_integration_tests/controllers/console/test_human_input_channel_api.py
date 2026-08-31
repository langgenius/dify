"""Console Channel API through the real service and PostgreSQL transaction boundary."""

from __future__ import annotations

from typing import Never

import pytest
import sqlalchemy as sa
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from configs import dify_config
from configs.deploy import IMEventTransportMode
from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration.adapters.credentials import IMProviderCredentials
from core.human_input_v2.im_integration.adapters.entities import CredentialTestSuccess
from core.human_input_v2.shared import AccountId, TenantId
from models.human_input_v2 import HumanInputIMChannel
from repositories.human_input_v2.im_channel_repository import IMChannel, IMChannelId
from repositories.human_input_v2.sqlalchemy_im_channel_repository import WorkspaceIMChannelWriter
from services.human_input_v2 import im_channel_service as service_module
from services.human_input_v2.im_channel_service_composition import build_workspace_im_channel_service
from services.human_input_v2.im_tenant_credential_cipher import TenantBoundCredentialCipher
from tests.test_containers_integration_tests.controllers.console.helpers import (
    authenticate_console_client,
    create_console_account_and_tenant,
)

_BASE_PATH = "/console/api/workspace/current/human-input/v2/channels/im"
_SLACK_CREDENTIALS = {
    "provider": "slack",
    "client_id": "slack-client-1",
    "client_secret": "client-secret",
    "signing_secret": "signing-secret",
    "bot_token": "xoxb-bot-token",
    "app_token": None,
}


class _StaticAdapter:
    def __init__(self, credentials: IMProviderCredentials) -> None:
        assert credentials.provider is IMProvider.SLACK

    def test_credentials(self) -> CredentialTestSuccess:
        return CredentialTestSuccess(IMProvider.SLACK, "slack-tenant-1")

    def close(self) -> None:
        return None


@pytest.fixture(autouse=True)
def static_provider_and_cipher(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_module, "build_im_provider_adapter", _StaticAdapter)
    monkeypatch.setattr(
        TenantBoundCredentialCipher,
        "encrypt",
        lambda _self, _plaintext: b"opaque-slack-ciphertext",
    )
    monkeypatch.setattr(
        dify_config,
        "HUMAN_INPUT_IM_EVENT_TRANSPORT_MODE",
        IMEventTransportMode.STREAM,
    )


def test_im_update_wires_opaque_version_through_real_service_and_postgresql_cas(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(test_client_with_containers, account)

    created_response = test_client_with_containers.post(
        _BASE_PATH,
        json={"credentials": _SLACK_CREDENTIALS},
        headers=headers,
    )
    assert created_response.status_code == 200
    created_summary = created_response.get_json()["summary"]
    channel_id = IMChannelId(created_summary["id"])
    original_config_version = created_summary["config_version"]
    original_record = db_session_with_containers.scalar(
        sa.select(HumanInputIMChannel).where(HumanInputIMChannel.id == str(channel_id))
    )
    assert original_record is not None
    original_webhook_id = original_record.webhook_id

    rotated_response = test_client_with_containers.put(
        f"{_BASE_PATH}/{channel_id}",
        json={
            "credentials": _SLACK_CREDENTIALS,
            "expected_config_version": original_config_version,
        },
        headers=headers,
    )
    assert rotated_response.status_code == 200
    rotated_summary = rotated_response.get_json()["summary"]
    assert rotated_summary["id"] == str(channel_id)
    assert rotated_summary["config_version"] != original_config_version
    assert rotated_summary["webhook_url"] is None

    stale_response = test_client_with_containers.put(
        f"{_BASE_PATH}/{channel_id}",
        json={
            "credentials": _SLACK_CREDENTIALS,
            "expected_config_version": original_config_version,
        },
        headers=headers,
    )
    assert stale_response.status_code == 409
    assert stale_response.get_json()["code"] == "provider_configuration_updated"

    service = build_workspace_im_channel_service(TenantId(tenant.id), AccountId(account.id))
    persisted = service.get(channel_id)
    assert persisted.id == channel_id
    assert persisted.config_version == 2
    db_session_with_containers.expire_all()
    rotated_record = db_session_with_containers.scalar(
        sa.select(HumanInputIMChannel).where(HumanInputIMChannel.id == str(channel_id))
    )
    assert rotated_record is not None
    assert rotated_record.webhook_id == original_webhook_id


def test_service_transaction_rolls_back_a_flushed_create_on_unclassified_failure(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(test_client_with_containers, account)
    original_create = WorkspaceIMChannelWriter.create

    def create_then_fail(self: WorkspaceIMChannelWriter, channel: IMChannel) -> Never:
        original_create(self, channel)
        raise RuntimeError("sql-owner-key-secret-detail")

    monkeypatch.setattr(WorkspaceIMChannelWriter, "create", create_then_fail)

    response = test_client_with_containers.post(
        _BASE_PATH,
        json={"credentials": _SLACK_CREDENTIALS},
        headers=headers,
    )

    assert response.status_code == 500
    assert "sql-owner-key-secret-detail" not in response.get_data(as_text=True)
    db_session_with_containers.expire_all()
    persisted_count = db_session_with_containers.scalar(
        sa.select(sa.func.count(HumanInputIMChannel.id)).where(
            HumanInputIMChannel.owner_key == f"workspace:{tenant.id}"
        )
    )
    assert persisted_count == 0
