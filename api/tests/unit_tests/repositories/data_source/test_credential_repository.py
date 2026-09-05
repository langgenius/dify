import json

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.credential_permission import CredentialPermission, CredentialType
from models.dataset import Dataset, Document
from models.enums import DataSourceType, DocumentCreatedFrom, PermissionEnum
from models.oauth import DatasourceOauthParamConfig, DatasourceOauthTenantParamConfig, DatasourceProvider
from repositories.data_source.credential_repository import SQLAlchemyDatasourceCredentialRepository


def _provider(
    *,
    workspace_id: str = "workspace-1",
    owner_id: str = "owner-1",
    provider: str = "notion_datasource",
    plugin_id: str = "langgenius/notion_datasource",
    visibility: PermissionEnum = PermissionEnum.ONLY_ME,
    is_default: bool = False,
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
        is_default=is_default,
        expires_at=-1,
    )


def _notion_source(*, workspace_id: str, credential_id: str | None) -> tuple[Dataset, Document]:
    dataset = Dataset(
        id="dataset-1",
        tenant_id=workspace_id,
        name="Notion dataset",
        data_source_type=DataSourceType.NOTION_IMPORT,
        created_by="owner-1",
    )
    document = Document(
        id="document-1",
        tenant_id=workspace_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.NOTION_IMPORT,
        data_source_info=json.dumps(
            {
                **({"credential_id": credential_id} if credential_id is not None else {}),
                "notion_workspace_id": "notion-workspace-1",
                "notion_page_id": "notion-page-1",
                "type": "page",
            }
        ),
        batch="batch-1",
        name="Page",
        created_from=DocumentCreatedFrom.API,
        created_by="owner-1",
    )
    return dataset, document


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


def test_get_oauth_client_config_returns_detached_tenant_and_system_rows(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                DatasourceOauthTenantParamConfig(
                    tenant_id="workspace-1",
                    provider="notion_datasource",
                    plugin_id="langgenius/notion_datasource",
                    client_params={"client_secret": "tenant-cipher"},
                    enabled=True,
                ),
                DatasourceOauthTenantParamConfig(
                    tenant_id="workspace-2",
                    provider="notion_datasource",
                    plugin_id="langgenius/notion_datasource",
                    client_params={"client_secret": "other-cipher"},
                    enabled=True,
                ),
                DatasourceOauthParamConfig(
                    provider="notion_datasource",
                    plugin_id="langgenius/notion_datasource",
                    system_credentials={"client_secret": "system-secret"},
                ),
            ]
        )

    record = repository.get_oauth_client_config(
        workspace_id="workspace-1",
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )

    assert record.encrypted_tenant_params == {"client_secret": "tenant-cipher"}
    assert record.system_credentials == {"client_secret": "system-secret"}


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


def test_get_for_stored_document_reconstructs_complete_owner_chain(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        credential = _provider(visibility=PermissionEnum.ONLY_ME)
        session.add(credential)
        session.flush()
        dataset, document = _notion_source(workspace_id="workspace-1", credential_id=credential.id)
        session.add_all([dataset, document])
        credential_id = credential.id

    record = repository.get_for_stored_document(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        document_id="document-1",
        credential_id=credential_id,
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )

    assert record is not None
    assert record.id == credential_id


def test_get_for_legacy_stored_document_uses_tenant_default_credential(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add(_provider(is_default=False))
        default_credential = _provider(is_default=True)
        default_credential.name = "Default Notion"
        session.add(default_credential)
        session.flush()
        dataset, document = _notion_source(workspace_id="workspace-1", credential_id=None)
        session.add_all([dataset, document])
        default_credential_id = default_credential.id

    record = repository.get_for_stored_document(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        document_id="document-1",
        credential_id=None,
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )

    assert record is not None
    assert record.id == default_credential_id


def test_get_for_legacy_stored_document_does_not_use_non_default_credential(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.add(_provider(is_default=False))
        dataset, document = _notion_source(workspace_id="workspace-1", credential_id=None)
        session.add_all([dataset, document])

    record = repository.get_for_stored_document(
        workspace_id="workspace-1",
        dataset_id="dataset-1",
        document_id="document-1",
        credential_id=None,
        provider="notion_datasource",
        plugin_id="langgenius/notion_datasource",
    )

    assert record is None


@pytest.mark.parametrize(
    ("workspace_id", "provider", "plugin_id"),
    [
        ("workspace-2", "notion_datasource", "langgenius/notion_datasource"),
        ("workspace-1", "other", "langgenius/notion_datasource"),
        ("workspace-1", "notion_datasource", "other/plugin"),
    ],
)
def test_get_for_stored_document_rejects_owner_provider_and_plugin_mismatch(
    sqlite_session_factory: sessionmaker[Session],
    workspace_id: str,
    provider: str,
    plugin_id: str,
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        credential = _provider()
        session.add(credential)
        session.flush()
        dataset, document = _notion_source(workspace_id="workspace-1", credential_id=credential.id)
        session.add_all([dataset, document])
        credential_id = credential.id

    assert (
        repository.get_for_stored_document(
            workspace_id=workspace_id,
            dataset_id="dataset-1",
            document_id="document-1",
            credential_id=credential_id,
            provider=provider,
            plugin_id=plugin_id,
        )
        is None
    )


def test_get_for_stored_document_rejects_deleted_or_different_stored_credential(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDatasourceCredentialRepository(session_factory=sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        credential = _provider()
        session.add(credential)
        session.flush()
        dataset, document = _notion_source(workspace_id="workspace-1", credential_id="different-credential")
        session.add_all([dataset, document])
        credential_id = credential.id

    kwargs = {
        "workspace_id": "workspace-1",
        "dataset_id": "dataset-1",
        "document_id": "document-1",
        "credential_id": credential_id,
        "provider": "notion_datasource",
        "plugin_id": "langgenius/notion_datasource",
    }
    assert repository.get_for_stored_document(**kwargs) is None

    with sqlite_session_factory.begin() as session:
        stored_document = session.get(Document, "document-1")
        assert stored_document is not None
        source_info = stored_document.data_source_info_dict
        source_info["credential_id"] = credential_id
        stored_document.data_source_info = json.dumps(source_info)
        stored_credential = session.get(DatasourceProvider, credential_id)
        assert stored_credential is not None
        session.delete(stored_credential)

    assert repository.get_for_stored_document(**kwargs) is None
