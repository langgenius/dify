"""Production composition contracts for IM Contact synchronization."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from core.human_input_v2.entities import IMProvider
from core.human_input_v2.im_integration import (
    EncryptedCredentials,
    IMIntegration,
    ProviderTenantIdentity,
)
from core.human_input_v2.im_integration.adapters.feishu_lark import (
    FeishuIMIntegrationCredentials,
    LarkIMIntegrationCredentials,
)
from core.human_input_v2.im_provider import (
    DingTalkIMIntegrationCredentials,
    MSTeamsIMIntegrationCredentials,
    SlackIMIntegrationCredentials,
    WeComIMIntegrationCredentials,
)
from core.human_input_v2.shared import DeploymentScope, IntegrationId, TenantId, WorkspaceScope
from models.model import DifySetup
from repositories.human_input_v2.im_integration import SQLAlchemyOrganizationIMWriteUnitOfWork
from services.human_input_v2.im_contact_sync import (
    ContactIMBindingService,
    IMContactSyncWorker,
    IMSyncService,
    composition,
)
from services.human_input_v2.im_contact_sync.composition import DifyIMProviderAdapterFactory

_NOW = datetime(2026, 8, 11, 8)


class _SlackAdapter:
    provider = IMProvider.SLACK


def test_slack_adapter_factory_uses_workspace_owner_and_reveals_every_secret() -> None:
    integration = IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-team-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {
                "client_id": "client-1",
                "encrypted_client_secret": "cipher-client",
                "encrypted_signing_secret": "cipher-signing",
                "encrypted_bot_token": "cipher-bot",
                "encrypted_app_token": "cipher-app",
            }
        ),
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )
    decryptions: list[tuple[str, str]] = []
    captured_credentials: list[SlackIMIntegrationCredentials] = []
    plaintext_by_ciphertext = {
        "cipher-client": "plain-client",
        "cipher-signing": "plain-signing",
        "cipher-bot": "xoxb-plain-bot",
        "cipher-app": "xapp-plain-app",
    }

    def decrypt(owner_key: str, ciphertext: str) -> str:
        decryptions.append((owner_key, ciphertext))
        return plaintext_by_ciphertext[ciphertext]

    def build_slack(credentials: SlackIMIntegrationCredentials) -> _SlackAdapter:
        captured_credentials.append(credentials)
        return _SlackAdapter()

    factory = DifyIMProviderAdapterFactory(
        decrypt_token=decrypt,
        deployment_owner_key_loader=lambda: "deployment-1",
        slack_adapter_factory=build_slack,
    )

    adapter = factory(integration)

    assert adapter.provider is IMProvider.SLACK
    assert captured_credentials == [
        SlackIMIntegrationCredentials(
            provider=IMProvider.SLACK,
            client_id="client-1",
            client_secret="plain-client",
            signing_secret="plain-signing",
            bot_token="xoxb-plain-bot",
            app_token="xapp-plain-app",
        )
    ]
    assert decryptions == [
        ("workspace-1", "cipher-client"),
        ("workspace-1", "cipher-signing"),
        ("workspace-1", "cipher-bot"),
        ("workspace-1", "cipher-app"),
    ]


def test_slack_adapter_factory_preserves_missing_optional_app_token() -> None:
    integration = IMIntegration.create(
        integration_id=IntegrationId("integration-1"),
        tenant_id=TenantId("workspace-1"),
        provider_tenant=ProviderTenantIdentity(IMProvider.SLACK, "provider-team-1"),
        encrypted_credentials=EncryptedCredentials.from_mapping(
            {
                "client_id": "client-1",
                "encrypted_client_secret": "cipher-client",
                "encrypted_signing_secret": "cipher-signing",
                "encrypted_bot_token": "cipher-bot",
            }
        ),
        configured_by_account_id=None,
        callback_url=None,
        now=_NOW,
    )
    decryptions: list[str] = []
    captured_credentials: list[SlackIMIntegrationCredentials] = []

    def decrypt(_owner_key: str, ciphertext: str) -> str:
        decryptions.append(ciphertext)
        return {
            "cipher-client": "plain-client",
            "cipher-signing": "plain-signing",
            "cipher-bot": "xoxb-plain-bot",
        }[ciphertext]

    def build_slack(credentials: SlackIMIntegrationCredentials) -> _SlackAdapter:
        captured_credentials.append(credentials)
        return _SlackAdapter()

    factory = DifyIMProviderAdapterFactory(
        decrypt_token=decrypt,
        deployment_owner_key_loader=lambda: "deployment-1",
        slack_adapter_factory=build_slack,
    )

    factory(integration)

    assert captured_credentials[0].app_token is None
    assert decryptions == ["cipher-client", "cipher-signing", "cipher-bot"]


def test_adapter_factory_supports_every_non_slack_provider_with_deployment_owned_credentials() -> None:
    encrypted_credentials_by_provider = {
        IMProvider.FEISHU: {
            "app_id": "feishu-app",
            "encrypted_app_secret": "cipher-feishu-secret",
            "encrypted_verification_token": "cipher-feishu-verification",
            "encrypted_encrypt_key": None,
        },
        IMProvider.LARK: {
            "app_id": "lark-app",
            "encrypted_app_secret": "cipher-lark-secret",
            "encrypted_verification_token": None,
            "encrypted_encrypt_key": "cipher-lark-encrypt-key",
        },
        IMProvider.DING_TALK: {
            "corp_id": "ding-corp",
            "client_id": "ding-client",
            "encrypted_client_secret": "cipher-ding-secret",
        },
        IMProvider.MS_TEAMS: {
            "tenant_id": "00000000-0000-0000-0000-000000000701",
            "client_id": "00000000-0000-0000-0000-000000000702",
            "encrypted_client_secret": "cipher-teams-secret",
        },
        IMProvider.WE_COM: {
            "corp_id": "wecom-corp",
            "agent_id": "1000001",
            "encrypted_secret": "cipher-wecom-secret",
        },
    }
    captured_credentials: dict[IMProvider, object] = {}
    deployment_owner_key_loads = 0

    def load_deployment_owner_key() -> str:
        nonlocal deployment_owner_key_loads
        deployment_owner_key_loads += 1
        return "deployment-1"

    def decrypt(owner_key: str, ciphertext: str) -> str:
        assert owner_key == "deployment-1"
        return f"plain:{ciphertext}"

    def capture_adapter(credentials):
        captured_credentials[credentials.provider] = credentials
        return _SlackAdapter()

    factory = DifyIMProviderAdapterFactory(
        decrypt_token=decrypt,
        deployment_owner_key_loader=load_deployment_owner_key,
        feishu_adapter_factory=capture_adapter,
        lark_adapter_factory=capture_adapter,
        dingtalk_adapter_factory=capture_adapter,
        ms_teams_adapter_factory=capture_adapter,
        wecom_adapter_factory=capture_adapter,
    )

    for provider, encrypted_credentials in encrypted_credentials_by_provider.items():
        integration = IMIntegration.create(
            integration_id=IntegrationId(f"integration-{provider.value}"),
            tenant_id=None,
            provider_tenant=ProviderTenantIdentity(provider, "provider-tenant-1"),
            encrypted_credentials=EncryptedCredentials.from_mapping(encrypted_credentials),
            configured_by_account_id=None,
            callback_url=None,
            now=_NOW,
        )
        factory(integration)

    assert deployment_owner_key_loads == len(encrypted_credentials_by_provider)
    assert captured_credentials == {
        IMProvider.FEISHU: FeishuIMIntegrationCredentials(
            provider=IMProvider.FEISHU,
            app_id="feishu-app",
            app_secret="plain:cipher-feishu-secret",
            verification_token="plain:cipher-feishu-verification",
            encrypt_key=None,
        ),
        IMProvider.LARK: LarkIMIntegrationCredentials(
            provider=IMProvider.LARK,
            app_id="lark-app",
            app_secret="plain:cipher-lark-secret",
            verification_token=None,
            encrypt_key="plain:cipher-lark-encrypt-key",
        ),
        IMProvider.DING_TALK: DingTalkIMIntegrationCredentials(
            provider=IMProvider.DING_TALK,
            corp_id="ding-corp",
            client_id="ding-client",
            client_secret="plain:cipher-ding-secret",
        ),
        IMProvider.MS_TEAMS: MSTeamsIMIntegrationCredentials(
            provider=IMProvider.MS_TEAMS,
            tenant_id="00000000-0000-0000-0000-000000000701",
            client_id="00000000-0000-0000-0000-000000000702",
            client_secret="plain:cipher-teams-secret",
        ),
        IMProvider.WE_COM: WeComIMIntegrationCredentials(
            provider=IMProvider.WE_COM,
            corp_id="wecom-corp",
            agent_id="1000001",
            secret="plain:cipher-wecom-secret",
        ),
    }


def test_application_composition_wires_commands_queries_and_worker_without_controllers(sqlite_engine: Engine) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    application = composition.build_im_contact_sync_application(
        session_maker=sessions,
        adapter_factory=lambda _integration: _SlackAdapter(),
    )

    assert isinstance(application.sync_service, IMSyncService)
    assert isinstance(application.binding_service, ContactIMBindingService)
    assert isinstance(application.worker, IMContactSyncWorker)
    assert "controllers" not in composition.__dict__


def test_composition_builders_resolve_organization_scopes_and_deployment_owner(sqlite_engine: Engine) -> None:
    DifySetup.metadata.create_all(sqlite_engine, tables=[DifySetup.__table__])
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    with pytest.raises(RuntimeError, match="deployment owner identity is unavailable"):
        composition._load_deployment_owner_key(sessions)

    with sessions.begin() as session:
        session.add(DifySetup(version="1.0.0", instance_id="deployment-1"))

    worker = composition.build_im_contact_sync_worker(
        session_maker=sessions,
        adapter_factory=lambda _integration: _SlackAdapter(),
    )
    sync_service = composition.build_im_sync_service(session_maker=sessions)
    write_unit_of_work_factory = composition._write_unit_of_work_factory(sessions)

    assert isinstance(worker, IMContactSyncWorker)
    assert isinstance(sync_service, IMSyncService)
    assert isinstance(
        write_unit_of_work_factory(WorkspaceScope(id=TenantId("workspace-1"))),
        SQLAlchemyOrganizationIMWriteUnitOfWork,
    )
    assert isinstance(write_unit_of_work_factory(DeploymentScope()), SQLAlchemyOrganizationIMWriteUnitOfWork)
    assert composition._load_deployment_owner_key(sessions) == "deployment-1"
    assert composition._scope_payload(WorkspaceScope(id=TenantId("workspace-1"))) == ("workspace", "workspace-1")
    assert composition._scope_payload(DeploymentScope()) == ("deployment", None)
