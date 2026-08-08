from __future__ import annotations

import base64
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from clients.a2a import A2AAgentCard
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentKind,
    ExternalAgentAuthType,
    ExternalAgentConfigSnapshot,
    ExternalAgentConnection,
)
from services.agent import external_agent_service as service_module
from services.agent.composer_service import AgentComposerService
from services.agent.errors import (
    AgentVersionConflictError,
    ExternalAgentConfigurationError,
    ExternalAgentNotFoundError,
    ExternalAgentOperationNotSupportedError,
)
from services.agent.external_agent_service import ExternalAgentDiscovery, ExternalAgentService
from services.agent.roster_service import AgentRosterService


def _card(
    *,
    name: str = "Local Codex",
    version: str = "1.0.0",
    url: str = "http://host.docker.internal:8765/a2a",
) -> A2AAgentCard:
    return A2AAgentCard.model_validate(
        {
            "name": name,
            "description": "Codex running on this workstation",
            "supportedInterfaces": [
                {
                    "url": url,
                    "protocolBinding": "HTTP+JSON",
                    "protocolVersion": "1.0",
                }
            ],
            "version": version,
            "capabilities": {"streaming": True},
            "defaultInputModes": ["text/plain"],
            "defaultOutputModes": ["text/plain"],
            "skills": [
                {
                    "id": "coding",
                    "name": "Coding",
                    "description": "Work in a local repository",
                    "tags": ["code"],
                }
            ],
        }
    )


def _discovery(*, card: A2AAgentCard | None = None) -> ExternalAgentDiscovery:
    return ExternalAgentDiscovery(
        agent_card=card or _card(),
        protocol_version="1.0",
        remote_agent_id="local-codex",
    )


@pytest.fixture(autouse=True)
def _fake_tenant_encryption(monkeypatch: pytest.MonkeyPatch) -> None:
    def _encrypt(tenant_id: str, value: str) -> str:
        return base64.b64encode(f"{tenant_id}:{value}".encode()).decode()

    def _decrypt(tenant_id: str, value: str) -> str:
        decoded = base64.b64decode(value).decode()
        return decoded.removeprefix(f"{tenant_id}:")

    monkeypatch.setattr(service_module.encrypter, "encrypt_token", _encrypt)
    monkeypatch.setattr(
        service_module.encrypter,
        "decrypt_token",
        _decrypt,
    )


def test_external_agent_kind_and_bearer_validation() -> None:
    assert AgentKind.EXTERNAL_AGENT.value == "external_agent"

    with pytest.raises(ExternalAgentConfigurationError):
        ExternalAgentService.discover(
            endpoint="http://host.docker.internal:8765",
            auth_type=ExternalAgentAuthType.BEARER,
            bearer_token=None,
        )


def test_discover_validates_a2a_interface_without_database_io(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MagicMock()
    client.discover.return_value = _card()
    client_factory = MagicMock(return_value=client)
    monkeypatch.setattr(service_module, "A2AClient", client_factory)

    result = ExternalAgentService.discover(
        endpoint="http://host.docker.internal:8765/",
        auth_type=ExternalAgentAuthType.BEARER,
        bearer_token="secret",
    )

    client_factory.assert_called_once_with(
        "http://host.docker.internal:8765",
        "secret",
        connect_timeout_seconds=10.0,
        read_timeout_seconds=30.0,
    )
    assert result.agent_card.name == "Local Codex"
    assert result.protocol_version == "1.0"


def test_discover_rejects_cross_origin_agent_interface(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MagicMock()
    card = _card()
    card.supported_interfaces[0].url = "https://credential-sink.example/a2a"
    client.discover.return_value = card
    monkeypatch.setattr(service_module, "A2AClient", MagicMock(return_value=client))

    with pytest.raises(ExternalAgentConfigurationError, match="same origin"):
        ExternalAgentService.discover(
            endpoint="http://host.docker.internal:8765",
            auth_type=ExternalAgentAuthType.BEARER,
            bearer_token="secret",
        )


def test_discover_rejects_missing_auth_required_by_agent_card(monkeypatch: pytest.MonkeyPatch) -> None:
    client = MagicMock()
    card = _card()
    card.security_schemes = {
        "bearerAuth": {"httpAuthSecurityScheme": {"scheme": "Bearer"}},
    }
    card.security_requirements = [{"schemes": {"bearerAuth": {"list": []}}}]
    client.discover.return_value = card
    monkeypatch.setattr(service_module, "A2AClient", MagicMock(return_value=client))

    with pytest.raises(ExternalAgentConfigurationError, match="requires authentication"):
        ExternalAgentService.discover(
            endpoint="http://host.docker.internal:8765",
            auth_type=ExternalAgentAuthType.NONE,
            bearer_token=None,
        )

    discovery = ExternalAgentService.discover(
        endpoint="http://host.docker.internal:8765",
        auth_type=ExternalAgentAuthType.BEARER,
        bearer_token="secret",
    )
    assert discovery.agent_card.name == "Local Codex"


def test_create_persists_app_backed_roster_agent_and_encrypted_snapshot(sqlite_session: Session) -> None:
    result = ExternalAgentService(sqlite_session).create_external_agent(
        tenant_id="tenant-1",
        account_id="account-1",
        endpoint="http://host.docker.internal:8765",
        auth_type=ExternalAgentAuthType.BEARER,
        bearer_token="top-secret",
        discovery=_discovery(),
    )

    agent = sqlite_session.scalar(select(Agent).where(Agent.id == result["id"]))
    assert agent is not None
    assert agent.agent_kind == AgentKind.EXTERNAL_AGENT
    assert agent.app_id is not None
    assert agent.backing_app_id == agent.app_id
    assert agent.active_config_has_model is True
    assert agent.active_config_is_published is True

    connection = sqlite_session.scalar(
        select(ExternalAgentConnection).where(ExternalAgentConnection.agent_id == agent.id)
    )
    assert connection is not None
    assert connection.encrypted_endpoint != "http://host.docker.internal:8765"
    assert connection.encrypted_bearer_token != "top-secret"

    snapshot = sqlite_session.scalar(
        select(ExternalAgentConfigSnapshot).where(
            ExternalAgentConfigSnapshot.agent_config_snapshot_id == agent.active_config_snapshot_id
        )
    )
    assert snapshot is not None
    assert "host.docker.internal" not in snapshot.encrypted_agent_card
    assert result["has_bearer_token"] is True
    assert "bearer_token" not in result

    invite_options = AgentRosterService(sqlite_session).list_invite_options(tenant_id="tenant-1")
    assert [item["id"] for item in invite_options["data"]] == [agent.id]


def test_external_agent_is_excluded_from_native_editor_and_runtime_surfaces(sqlite_session: Session) -> None:
    created = ExternalAgentService(sqlite_session).create_external_agent(
        tenant_id="tenant-1",
        account_id="account-1",
        endpoint="http://host.docker.internal:8765",
        auth_type=ExternalAgentAuthType.NONE,
        bearer_token=None,
        discovery=_discovery(),
    )

    with pytest.raises(ExternalAgentOperationNotSupportedError):
        AgentComposerService.load_agent_composer(
            session=sqlite_session,
            tenant_id="tenant-1",
            agent_id=created["id"],
        )
    with pytest.raises(ExternalAgentOperationNotSupportedError):
        AgentRosterService(sqlite_session).get_agent_runtime_app_model(
            tenant_id="tenant-1",
            agent_id=created["id"],
            native_only=True,
        )

    # Generic detail resolution remains available for Agent Roster routing.
    runtime_app = AgentRosterService(sqlite_session).get_agent_runtime_app_model(
        tenant_id="tenant-1",
        agent_id=created["id"],
    )
    assert runtime_app.id == created["app_id"]


def test_external_agent_versions_show_connection_revisions_but_cannot_restore(sqlite_session: Session) -> None:
    created = ExternalAgentService(sqlite_session).create_external_agent(
        tenant_id="tenant-1",
        account_id="account-1",
        endpoint="http://host.docker.internal:8765",
        auth_type=ExternalAgentAuthType.NONE,
        bearer_token=None,
        discovery=_discovery(),
    )
    roster = AgentRosterService(sqlite_session)

    versions = roster.list_agent_versions(tenant_id="tenant-1", agent_id=created["id"])
    assert [version["id"] for version in versions] == [created["active_config_snapshot_id"]]
    with pytest.raises(ExternalAgentOperationNotSupportedError):
        roster.restore_agent_version(
            tenant_id="tenant-1",
            agent_id=created["id"],
            version_id=created["active_config_snapshot_id"],
            account_id="account-1",
        )


def test_runtime_config_is_snapshot_and_tenant_scoped(sqlite_session: Session) -> None:
    service = ExternalAgentService(sqlite_session)
    created = service.create_external_agent(
        tenant_id="tenant-1",
        account_id="account-1",
        endpoint="http://host.docker.internal:8765",
        auth_type=ExternalAgentAuthType.BEARER,
        bearer_token="top-secret",
        discovery=_discovery(),
    )

    runtime = service.get_runtime_config(
        tenant_id="tenant-1",
        agent_id=created["id"],
        agent_config_snapshot_id=created["active_config_snapshot_id"],
    )

    assert runtime.endpoint == "http://host.docker.internal:8765"
    assert runtime.decrypted_bearer_token == "top-secret"
    assert runtime.agent_card.name == "Local Codex"
    assert service.validate_snapshot_available(
        tenant_id="tenant-1",
        agent_id=created["id"],
        agent_config_snapshot_id=created["active_config_snapshot_id"],
    )
    assert not service.validate_snapshot_available(
        tenant_id="tenant-2",
        agent_id=created["id"],
        agent_config_snapshot_id=created["active_config_snapshot_id"],
    )
    with pytest.raises(ExternalAgentNotFoundError):
        service.get_runtime_config(
            tenant_id="tenant-2",
            agent_id=created["id"],
            agent_config_snapshot_id=created["active_config_snapshot_id"],
        )


def test_update_creates_new_native_and_external_card_snapshots(sqlite_session: Session) -> None:
    service = ExternalAgentService(sqlite_session)
    created = service.create_external_agent(
        tenant_id="tenant-1",
        account_id="account-1",
        endpoint="http://host.docker.internal:8765",
        auth_type=ExternalAgentAuthType.NONE,
        bearer_token=None,
        discovery=_discovery(),
    )
    previous_snapshot_id = created["active_config_snapshot_id"]

    updated = service.update_external_agent(
        tenant_id="tenant-1",
        agent_id=created["id"],
        account_id="account-1",
        endpoint="http://host.docker.internal:8765",
        auth_type=ExternalAgentAuthType.NONE,
        bearer_token=None,
        discovery=_discovery(card=_card(name="Local Codex v2", version="2.0.0")),
        expected_active_config_snapshot_id=previous_snapshot_id,
        name="My Codex",
    )

    assert updated["active_config_snapshot_id"] != previous_snapshot_id
    assert updated["name"] == "My Codex"
    assert updated["agent_card"]["name"] == "Local Codex v2"
    native_snapshots = sqlite_session.scalars(
        select(AgentConfigSnapshot).where(AgentConfigSnapshot.agent_id == created["id"])
    ).all()
    external_snapshots = sqlite_session.scalars(
        select(ExternalAgentConfigSnapshot).where(ExternalAgentConfigSnapshot.agent_id == created["id"])
    ).all()
    assert len(native_snapshots) == 2
    assert len(external_snapshots) == 2
    connections = sqlite_session.scalars(
        select(ExternalAgentConnection).where(ExternalAgentConnection.agent_id == created["id"])
    ).all()
    assert len(connections) == 2

    pinned_previous = service.get_runtime_config(
        tenant_id="tenant-1",
        agent_id=created["id"],
        agent_config_snapshot_id=previous_snapshot_id,
    )
    assert pinned_previous.agent_card.name == "Local Codex"


def test_update_keeps_old_snapshot_connection_credentials_pinned(sqlite_session: Session) -> None:
    service = ExternalAgentService(sqlite_session)
    created = service.create_external_agent(
        tenant_id="tenant-1",
        account_id="account-1",
        endpoint="http://old-agent.example",
        auth_type=ExternalAgentAuthType.BEARER,
        bearer_token="old-token",
        discovery=_discovery(card=_card(url="http://old-agent.example/a2a")),
    )
    previous_snapshot_id = created["active_config_snapshot_id"]

    updated = service.update_external_agent(
        tenant_id="tenant-1",
        agent_id=created["id"],
        account_id="account-1",
        endpoint="https://new-agent.example",
        auth_type=ExternalAgentAuthType.BEARER,
        bearer_token="new-token",
        discovery=_discovery(card=_card(name="New Agent", url="https://new-agent.example/a2a")),
        expected_active_config_snapshot_id=previous_snapshot_id,
    )

    previous = service.get_runtime_config(
        tenant_id="tenant-1",
        agent_id=created["id"],
        agent_config_snapshot_id=previous_snapshot_id,
    )
    current = service.get_runtime_config(
        tenant_id="tenant-1",
        agent_id=created["id"],
        agent_config_snapshot_id=updated["active_config_snapshot_id"],
    )
    assert previous.endpoint == "http://old-agent.example"
    assert previous.decrypted_bearer_token == "old-token"
    assert previous.agent_card.name == "Local Codex"
    assert current.endpoint == "https://new-agent.example"
    assert current.decrypted_bearer_token == "new-token"
    assert current.agent_card.name == "New Agent"


def test_update_rejects_stale_snapshot_compare_and_swap(sqlite_session: Session) -> None:
    service = ExternalAgentService(sqlite_session)
    created = service.create_external_agent(
        tenant_id="tenant-1",
        account_id="account-1",
        endpoint="https://agent.example",
        auth_type=ExternalAgentAuthType.BEARER,
        bearer_token="token-v1",
        discovery=_discovery(card=_card(url="https://agent.example/a2a")),
    )
    stale_snapshot_id = created["active_config_snapshot_id"]
    first_update = service.update_external_agent(
        tenant_id="tenant-1",
        agent_id=created["id"],
        account_id="account-1",
        endpoint="https://agent.example",
        auth_type=ExternalAgentAuthType.BEARER,
        bearer_token="token-v2",
        discovery=_discovery(card=_card(name="Agent v2", url="https://agent.example/a2a")),
        expected_active_config_snapshot_id=stale_snapshot_id,
    )

    with pytest.raises(AgentVersionConflictError):
        service.update_external_agent(
            tenant_id="tenant-1",
            agent_id=created["id"],
            account_id="account-1",
            endpoint="https://agent.example",
            auth_type=ExternalAgentAuthType.BEARER,
            bearer_token="token-v1",
            discovery=_discovery(card=_card(name="Stale Agent", url="https://agent.example/a2a")),
            expected_active_config_snapshot_id=stale_snapshot_id,
        )

    current = service.get_runtime_config(
        tenant_id="tenant-1",
        agent_id=created["id"],
        agent_config_snapshot_id=first_update["active_config_snapshot_id"],
    )
    assert current.decrypted_bearer_token == "token-v2"
