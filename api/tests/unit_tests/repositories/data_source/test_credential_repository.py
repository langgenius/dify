from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.credential_permission import CredentialPermission, CredentialType
from models.enums import PermissionEnum
from models.oauth import DatasourceProvider
from repositories.data_source.credential_repository import SQLAlchemyDatasourceCredentialRepository


def _provider(
    *,
    workspace_id: str = "workspace-1",
    owner_id: str = "owner-1",
    provider: str = "notion_datasource",
    plugin_id: str = "langgenius/notion_datasource",
    visibility: PermissionEnum = PermissionEnum.ONLY_ME,
) -> DatasourceProvider:
    return DatasourceProvider(
        tenant_id=workspace_id,
        name="Notion",
        provider=provider,
        plugin_id=plugin_id,
        auth_type="oauth2",
        encrypted_credentials={"integration_secret": "encrypted"},
        user_id=owner_id,
        visibility=visibility,
        expires_at=-1,
    )


def test_get_visible_scopes_workspace_provider_plugin_and_actor(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        credential = _provider(visibility=PermissionEnum.PARTIAL_TEAM)
        session.add(credential)
        session.flush()
        session.add(
            CredentialPermission(
                credential_id=credential.id,
                credential_type=CredentialType.DATASOURCE_PROVIDER,
                account_id="member-1",
                tenant_id="workspace-1",
            )
        )
        credential_id = credential.id

    record = repository.get_visible(
        workspace_id="workspace-1",
        actor_id="member-1",
        credential_id=credential_id,
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )

    assert record is not None
    assert record.encrypted_credentials == {"integration_secret": "encrypted"}
    assert (
        repository.get_visible(
            workspace_id="workspace-2",
            actor_id="member-1",
            credential_id=credential_id,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )
        is None
    )
    assert (
        repository.get_visible(
            workspace_id="workspace-1",
            actor_id="member-1",
            credential_id=credential_id,
            provider="other",
            plugin_id="langgenius/notion_datasource",
        )
        is None
    )
    assert (
        repository.get_visible(
            workspace_id="workspace-1",
            actor_id="member-1",
            credential_id=credential_id,
            provider="notion_datasource",
            plugin_id="other/plugin",
        )
        is None
    )
    assert (
        repository.get_visible(
            workspace_id="workspace-1",
            actor_id="outsider-1",
            credential_id=credential_id,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )
        is None
    )


def test_get_visible_ignores_revoked_partial_permission(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        credential = _provider(visibility=PermissionEnum.PARTIAL_TEAM)
        session.add(credential)
        session.flush()
        session.add(
            CredentialPermission(
                credential_id=credential.id,
                credential_type=CredentialType.DATASOURCE_PROVIDER,
                account_id="member-1",
                tenant_id="workspace-1",
                has_permission=False,
            )
        )
        credential_id = credential.id

    assert (
        repository.get_visible(
            workspace_id="workspace-1",
            actor_id="member-1",
            credential_id=credential_id,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )
        is None
    )


def test_get_visible_does_not_apply_stale_share_to_private_credential(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        credential = _provider(visibility=PermissionEnum.ONLY_ME)
        session.add(credential)
        session.flush()
        session.add(
            CredentialPermission(
                credential_id=credential.id,
                credential_type=CredentialType.DATASOURCE_PROVIDER,
                account_id="member-1",
                tenant_id="workspace-1",
            )
        )
        credential_id = credential.id

    assert (
        repository.get_visible(
            workspace_id="workspace-1",
            actor_id="member-1",
            credential_id=credential_id,
            provider="notion_datasource",
            plugin_id="langgenius/notion_datasource",
        )
        is None
    )


def test_update_if_unchanged_detects_concurrent_change(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        credential = _provider()
        session.add(credential)
        session.flush()
        credential_id = credential.id

    record = repository.get_visible(
        workspace_id="workspace-1",
        actor_id="owner-1",
        credential_id=credential_id,
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )
    assert record is not None

    with sqlite_session_factory.begin() as session:
        stored = session.scalar(select(DatasourceProvider).where(DatasourceProvider.id == credential_id))
        assert stored is not None
        stored.encrypted_credentials = {"integration_secret": "concurrent"}
        stored.expires_at = 200

    assert not repository.update_if_unchanged(
        record=record,
        encrypted_credentials={"integration_secret": "new"},
        expires_at=100,
    )


def test_update_if_unchanged_persists_refreshed_snapshot(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        credential = _provider()
        session.add(credential)
        session.flush()
        credential_id = credential.id

    record = repository.get_visible(
        workspace_id="workspace-1",
        actor_id="owner-1",
        credential_id=credential_id,
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )
    assert record is not None
    assert repository.update_if_unchanged(
        record=record,
        encrypted_credentials={"integration_secret": "new"},
        expires_at=100,
    )

    with sqlite_session_factory() as session:
        stored = session.get(DatasourceProvider, credential_id)
        assert stored is not None
        assert stored.encrypted_credentials == {"integration_secret": "new"}
        assert stored.expires_at == 100
        assert stored.updated_at >= record.updated_at
