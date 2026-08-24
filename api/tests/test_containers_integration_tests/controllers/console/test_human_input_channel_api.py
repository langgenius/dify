"""Console Channel API wiring against real owner services and PostgreSQL persistence."""

from __future__ import annotations

import pytest
from flask.testing import FlaskClient
from sqlalchemy.orm import Session

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    ConfirmedIMConfiguration,
    EncryptedCredentials,
    IMProviderCredentials,
    IMProviderTestResult,
    IntegrationRevisionToken,
)
from core.human_input_v2.shared import DirectoryScope, IntegrationId, TenantId, WorkspaceScope
from services.human_input_v2 import im_integration_management_composition as composition
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


class _StaticIMProviderPort:
    def available_providers(self) -> tuple[IMProvider, ...]:
        return (IMProvider.SLACK,)

    def prepare(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> ConfirmedIMConfiguration:
        assert isinstance(scope, WorkspaceScope)
        assert credentials.provider is IMProvider.SLACK
        return ConfirmedIMConfiguration(
            provider=IMProvider.SLACK,
            provider_tenant_id="slack-tenant-1",
            encrypted_credentials=EncryptedCredentials.from_mapping(
                {
                    "client_id": "slack-client-1",
                    "encrypted_client_secret": "cipher-client-secret",
                    "encrypted_signing_secret": "cipher-signing-secret",
                    "encrypted_bot_token": "cipher-bot-token",
                }
            ),
            callback_url=None,
            provider_tenant_display=None,
        )

    def test(
        self,
        scope: DirectoryScope,
        credentials: IMProviderCredentials,
    ) -> IMProviderTestResult:
        assert isinstance(scope, WorkspaceScope)
        assert credentials.provider is IMProvider.SLACK
        return IMProviderTestResult(IMProvider.SLACK, "slack-tenant-1")


def test_im_update_wires_opaque_version_through_real_service_and_postgresql_cas(
    db_session_with_containers: Session,
    test_client_with_containers: FlaskClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account, tenant = create_console_account_and_tenant(db_session_with_containers)
    headers = authenticate_console_client(test_client_with_containers, account)
    provider_port = _StaticIMProviderPort()
    monkeypatch.setattr(composition, "DifyIMProviderConfigurationService", lambda: provider_port)

    created_response = test_client_with_containers.post(
        _BASE_PATH,
        json={"credentials": _SLACK_CREDENTIALS},
        headers=headers,
    )
    assert created_response.status_code == 200
    created_summary = created_response.get_json()["summary"]
    channel_id = IntegrationId(created_summary["id"])
    original_config_version = created_summary["config_version"]

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

    service = composition.build_human_input_im_integration_management_service()
    persisted = service.get(WorkspaceScope(TenantId(tenant.id)), channel_id)
    assert persisted.revision == IntegrationRevisionToken(channel_id, 2)
