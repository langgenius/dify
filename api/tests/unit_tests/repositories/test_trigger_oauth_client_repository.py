from uuid import uuid4

import pytest
from sqlalchemy import Engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from models.provider_ids import TriggerProviderID
from models.trigger import TriggerOAuthSystemClient, TriggerOAuthTenantClient
from repositories.trigger.oauth_client_repository import TriggerOAuthClientRepository
from services.trigger.oauth_client_service import (
    TriggerOAuthClientChangedError,
    TriggerOAuthClientSnapshot,
    TriggerOAuthTenantClientRecord,
)


@pytest.fixture
def repository(sqlite_session_factory: sessionmaker[Session]) -> TriggerOAuthClientRepository:
    return TriggerOAuthClientRepository(session_factory=sqlite_session_factory)


def _custom(*, tenant_id: str, plugin_id: str, provider: str) -> TriggerOAuthTenantClient:
    return TriggerOAuthTenantClient(
        tenant_id=tenant_id,
        plugin_id=plugin_id,
        provider=provider,
        encrypted_oauth_params='{"client_secret": "original-ciphertext"}',
        enabled=False,
    )


def test_missing_clients_return_empty_snapshot(repository: TriggerOAuthClientRepository) -> None:
    assert repository.get(
        tenant_id=str(uuid4()), provider_id=TriggerProviderID("langgenius/github/github")
    ) == TriggerOAuthClientSnapshot(custom=None, system_configured=False)


def test_repository_returns_its_connection_after_every_operation(
    repository: TriggerOAuthClientRepository,
    sqlite_engine: Engine,
) -> None:
    tenant_id = str(uuid4())
    provider_id = TriggerProviderID("langgenius/github/github")
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)

    repository.save(
        tenant_id=tenant_id,
        provider_id=provider_id,
        encrypted_oauth_params="{}",
        enabled=None,
        existing_client_id=None,
    )
    assert pool.checkedout() == 0
    repository.get(tenant_id=tenant_id, provider_id=provider_id)
    assert pool.checkedout() == 0
    repository.delete(tenant_id=tenant_id, provider_id=provider_id)
    assert pool.checkedout() == 0


@pytest.mark.parametrize("other_scope", ["tenant", "plugin", "provider"])
def test_custom_lookup_uses_complete_owner_scope(
    repository: TriggerOAuthClientRepository,
    sqlite_session_factory: sessionmaker[Session],
    other_scope: str,
) -> None:
    tenant_id = str(uuid4())
    with sqlite_session_factory.begin() as session:
        session.add(
            _custom(
                tenant_id=str(uuid4()) if other_scope == "tenant" else tenant_id,
                plugin_id="langgenius/other" if other_scope == "plugin" else "langgenius/github",
                provider="other" if other_scope == "provider" else "github",
            )
        )

    assert repository.get(
        tenant_id=tenant_id, provider_id=TriggerProviderID("langgenius/github/github")
    ) == TriggerOAuthClientSnapshot(custom=None, system_configured=False)


@pytest.mark.parametrize("other_scope", ["plugin", "provider"])
def test_system_lookup_uses_plugin_and_provider(
    repository: TriggerOAuthClientRepository,
    sqlite_session_factory: sessionmaker[Session],
    other_scope: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            TriggerOAuthSystemClient(
                plugin_id="langgenius/other" if other_scope == "plugin" else "langgenius/github",
                provider="other" if other_scope == "provider" else "github",
                encrypted_oauth_params="system-ciphertext",
            )
        )

    assert (
        repository.get(
            tenant_id=str(uuid4()), provider_id=TriggerProviderID("langgenius/github/github")
        ).system_configured
        is False
    )


def test_get_materializes_ciphertext_and_enabled_before_closing_session(
    repository: TriggerOAuthClientRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    provider_id = TriggerProviderID("langgenius/github/github")
    custom = _custom(tenant_id=tenant_id, plugin_id=provider_id.plugin_id, provider=provider_id.provider_name)
    with sqlite_session_factory.begin() as session:
        session.add(custom)
        session.add(
            TriggerOAuthSystemClient(
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                encrypted_oauth_params="system-ciphertext",
            )
        )

    snapshot = repository.get(tenant_id=tenant_id, provider_id=provider_id)
    repository.delete(tenant_id=tenant_id, provider_id=provider_id)

    assert snapshot == TriggerOAuthClientSnapshot(
        custom=TriggerOAuthTenantClientRecord(
            id=custom.id,
            encrypted_oauth_params='{"client_secret": "original-ciphertext"}',
            enabled=False,
        ),
        system_configured=True,
    )


@pytest.mark.parametrize(("enabled", "expected"), [(None, True), (False, False), (True, True)])
def test_save_creates_committed_client_with_default_or_explicit_enabled(
    repository: TriggerOAuthClientRepository,
    sqlite_session_factory: sessionmaker[Session],
    enabled: bool | None,
    expected: bool,
) -> None:
    tenant_id = str(uuid4())
    provider_id = TriggerProviderID("langgenius/github/github")

    repository.save(
        tenant_id=tenant_id,
        provider_id=provider_id,
        encrypted_oauth_params='{"client_secret": "new-ciphertext"}',
        enabled=enabled,
        existing_client_id=None,
    )

    with sqlite_session_factory() as session:
        clients = session.scalars(select(TriggerOAuthTenantClient)).all()
        assert len(clients) == 1
        client = clients[0]
        assert (client.tenant_id, client.plugin_id, client.provider) == (tenant_id, "langgenius/github", "github")
        assert client.encrypted_oauth_params == '{"client_secret": "new-ciphertext"}'
        assert client.enabled is expected


@pytest.mark.parametrize(("enabled", "expected"), [(None, False), (False, False), (True, True)])
def test_save_updates_only_matching_client_and_preserves_enabled_when_omitted(
    repository: TriggerOAuthClientRepository,
    sqlite_session_factory: sessionmaker[Session],
    enabled: bool | None,
    expected: bool,
) -> None:
    tenant_id = str(uuid4())
    provider_id = TriggerProviderID("langgenius/github/github")
    target = _custom(tenant_id=tenant_id, plugin_id=provider_id.plugin_id, provider=provider_id.provider_name)
    decoys = [
        _custom(tenant_id=str(uuid4()), plugin_id=provider_id.plugin_id, provider=provider_id.provider_name),
        _custom(tenant_id=tenant_id, plugin_id="langgenius/other", provider=provider_id.provider_name),
        _custom(tenant_id=tenant_id, plugin_id=provider_id.plugin_id, provider="other"),
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all([*decoys, target])

    repository.save(
        tenant_id=tenant_id,
        provider_id=provider_id,
        encrypted_oauth_params="{}",
        enabled=enabled,
        existing_client_id=target.id,
    )

    with sqlite_session_factory() as session:
        clients = {client.id: client for client in session.scalars(select(TriggerOAuthTenantClient))}
        assert len(clients) == 4
        assert clients[target.id].encrypted_oauth_params == "{}"
        assert clients[target.id].enabled is expected
        for decoy in decoys:
            assert clients[decoy.id].encrypted_oauth_params == decoy.encrypted_oauth_params
            assert clients[decoy.id].enabled is False


@pytest.mark.parametrize("recreate", [False, True])
def test_save_rejects_deleted_snapshot_without_resurrecting_or_overwriting_client(
    repository: TriggerOAuthClientRepository,
    sqlite_session_factory: sessionmaker[Session],
    recreate: bool,
) -> None:
    tenant_id = str(uuid4())
    provider_id = TriggerProviderID("langgenius/github/github")
    with sqlite_session_factory.begin() as session:
        session.add(_custom(tenant_id=tenant_id, plugin_id=provider_id.plugin_id, provider=provider_id.provider_name))
    snapshot = repository.get(tenant_id=tenant_id, provider_id=provider_id)
    assert snapshot.custom is not None

    repository.delete(tenant_id=tenant_id, provider_id=provider_id)
    if recreate:
        repository.save(
            tenant_id=tenant_id,
            provider_id=provider_id,
            encrypted_oauth_params='{"client_secret": "replacement-ciphertext"}',
            enabled=False,
            existing_client_id=None,
        )

    with pytest.raises(TriggerOAuthClientChangedError):
        repository.save(
            tenant_id=tenant_id,
            provider_id=provider_id,
            encrypted_oauth_params='{"client_secret": "stale-ciphertext"}',
            enabled=None,
            existing_client_id=snapshot.custom.id,
        )

    with sqlite_session_factory() as session:
        clients = session.scalars(select(TriggerOAuthTenantClient)).all()
        if recreate:
            assert len(clients) == 1
            assert clients[0].id != snapshot.custom.id
            assert clients[0].encrypted_oauth_params == '{"client_secret": "replacement-ciphertext"}'
            assert clients[0].enabled is False
        else:
            assert clients == []


@pytest.mark.parametrize("other_scope", ["tenant", "plugin", "provider"])
def test_save_requires_owner_scope_even_with_existing_client_id(
    repository: TriggerOAuthClientRepository,
    sqlite_session_factory: sessionmaker[Session],
    other_scope: str,
) -> None:
    tenant_id = str(uuid4())
    target = _custom(tenant_id=tenant_id, plugin_id="langgenius/github", provider="github")
    with sqlite_session_factory.begin() as session:
        session.add(target)

    provider_ids = {
        "tenant": "langgenius/github/github",
        "plugin": "langgenius/other/github",
        "provider": "langgenius/github/other",
    }
    provider_id = TriggerProviderID(provider_ids[other_scope])
    with pytest.raises(TriggerOAuthClientChangedError):
        repository.save(
            tenant_id=str(uuid4()) if other_scope == "tenant" else tenant_id,
            provider_id=provider_id,
            encrypted_oauth_params="{}",
            enabled=True,
            existing_client_id=target.id,
        )

    with sqlite_session_factory() as session:
        stored = session.get(TriggerOAuthTenantClient, target.id)
        assert stored is not None
        assert stored.encrypted_oauth_params == target.encrypted_oauth_params
        assert stored.enabled is False


def test_delete_is_idempotent_and_preserves_other_workspaces_providers_and_system_client(
    repository: TriggerOAuthClientRepository,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    tenant_id = str(uuid4())
    provider_id = TriggerProviderID("langgenius/github/github")
    target = _custom(tenant_id=tenant_id, plugin_id=provider_id.plugin_id, provider=provider_id.provider_name)
    decoys = [
        _custom(tenant_id=str(uuid4()), plugin_id=provider_id.plugin_id, provider=provider_id.provider_name),
        _custom(tenant_id=tenant_id, plugin_id="langgenius/other", provider=provider_id.provider_name),
        _custom(tenant_id=tenant_id, plugin_id=provider_id.plugin_id, provider="other"),
    ]
    with sqlite_session_factory.begin() as session:
        session.add_all([*decoys, target])
        session.add(
            TriggerOAuthSystemClient(
                plugin_id=provider_id.plugin_id,
                provider=provider_id.provider_name,
                encrypted_oauth_params="system-ciphertext",
            )
        )

    repository.delete(tenant_id=tenant_id, provider_id=provider_id)
    repository.delete(tenant_id=tenant_id, provider_id=provider_id)

    with sqlite_session_factory() as session:
        assert set(session.scalars(select(TriggerOAuthTenantClient.id))) == {decoy.id for decoy in decoys}
        assert session.scalar(select(TriggerOAuthSystemClient.encrypted_oauth_params)) == "system-ciphertext"
