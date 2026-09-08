from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from models.source import DataSourceOauthBinding
from repositories.data_source.oauth_binding_repository import SQLAlchemyDataSourceOAuthBindingRepository
from services.entities.data_source.oauth import DataSourceOAuthAuthorization


def test_upsert_authorization_inserts_and_reenables_existing_binding(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDataSourceOAuthBindingRepository(sqlite_session_factory)
    authorization = DataSourceOAuthAuthorization(access_token="token", source_info={"pages": []})

    repository.upsert_authorization(
        workspace_id="workspace-1",
        provider="notion",
        authorization=authorization,
    )
    with sqlite_session_factory.begin() as session:
        binding = session.scalar(select(DataSourceOauthBinding))
        assert binding is not None
        binding.disabled = True

    updated_authorization = DataSourceOAuthAuthorization(
        access_token="token",
        source_info={"pages": [{"page_id": "page-1"}]},
    )
    repository.upsert_authorization(
        workspace_id="workspace-1",
        provider="notion",
        authorization=updated_authorization,
    )

    with sqlite_session_factory() as session:
        bindings = session.scalars(select(DataSourceOauthBinding)).all()
        assert len(bindings) == 1
        assert bindings[0].disabled is False
        assert bindings[0].source_info == updated_authorization.source_info


def test_get_enabled_scopes_by_workspace_provider_and_state(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDataSourceOAuthBindingRepository(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        enabled = DataSourceOauthBinding(
            tenant_id="workspace-1",
            provider="notion",
            access_token="enabled-token",
            source_info={"pages": []},
            disabled=False,
        )
        disabled = DataSourceOauthBinding(
            tenant_id="workspace-1",
            provider="notion",
            access_token="disabled-token",
            source_info={"pages": []},
            disabled=True,
        )
        session.add_all([enabled, disabled])

    record = repository.get_enabled(
        workspace_id="workspace-1",
        provider="notion",
        binding_id=enabled.id,
    )

    assert record is not None
    assert record.id == enabled.id
    assert record.access_token == "enabled-token"
    assert (
        repository.get_enabled(
            workspace_id="workspace-2",
            provider="notion",
            binding_id=enabled.id,
        )
        is None
    )
    assert (
        repository.get_enabled(
            workspace_id="workspace-1",
            provider="other",
            binding_id=enabled.id,
        )
        is None
    )
    assert (
        repository.get_enabled(
            workspace_id="workspace-1",
            provider="notion",
            binding_id=disabled.id,
        )
        is None
    )


def test_update_source_info_only_updates_matching_enabled_binding(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDataSourceOAuthBindingRepository(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        binding = DataSourceOauthBinding(
            tenant_id="workspace-1",
            provider="notion",
            access_token="token",
            source_info={"pages": []},
            disabled=False,
        )
        session.add(binding)

    assert repository.update_source_info(
        workspace_id="workspace-1",
        provider="notion",
        binding_id=binding.id,
        source_info={"pages": [{"page_id": "page-1"}]},
    )
    assert not repository.update_source_info(
        workspace_id="workspace-2",
        provider="notion",
        binding_id=binding.id,
        source_info={"pages": []},
    )
    assert not repository.update_source_info(
        workspace_id="workspace-1",
        provider="other",
        binding_id=binding.id,
        source_info={"pages": []},
    )

    with sqlite_session_factory() as session:
        updated = session.get(DataSourceOauthBinding, binding.id)
        assert updated is not None
        assert updated.source_info == {"pages": [{"page_id": "page-1"}]}

    with sqlite_session_factory.begin() as session:
        stored = session.get(DataSourceOauthBinding, binding.id)
        assert stored is not None
        stored.disabled = True

    assert not repository.update_source_info(
        workspace_id="workspace-1",
        provider="notion",
        binding_id=binding.id,
        source_info={"pages": []},
    )


def test_binding_management_lists_enabled_and_changes_state_atomically(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDataSourceOAuthBindingRepository(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        enabled = DataSourceOauthBinding(
            tenant_id="workspace-1",
            provider="notion",
            access_token="enabled-token",
            source_info={"workspace_id": "notion-workspace"},
            disabled=False,
        )
        disabled = DataSourceOauthBinding(
            tenant_id="workspace-1",
            provider="notion",
            access_token="disabled-token",
            source_info={},
            disabled=True,
        )
        session.add_all([enabled, disabled])

    summaries = repository.list_enabled_bindings(workspace_id="workspace-1")

    assert [summary.id for summary in summaries] == [enabled.id]
    assert (
        repository.change_disabled_state(workspace_id="workspace-1", binding_id=enabled.id, disabled=True) == "updated"
    )
    assert (
        repository.change_disabled_state(workspace_id="workspace-1", binding_id=enabled.id, disabled=True)
        == "already_disabled"
    )
    assert (
        repository.change_disabled_state(workspace_id="workspace-1", binding_id=disabled.id, disabled=False)
        == "updated"
    )
    assert (
        repository.change_disabled_state(workspace_id="workspace-2", binding_id=disabled.id, disabled=False)
        == "not_found"
    )


def test_null_disabled_state_is_treated_as_enabled(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = SQLAlchemyDataSourceOAuthBindingRepository(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        binding = DataSourceOauthBinding(
            tenant_id="workspace-1",
            provider="notion",
            access_token="token",
            source_info={"workspace_id": "notion-workspace"},
            disabled=False,
        )
        session.add(binding)
        session.flush()
        binding_id = binding.id
        session.execute(
            update(DataSourceOauthBinding).where(DataSourceOauthBinding.id == binding_id).values(disabled=None)
        )

    assert (
        repository.get_enabled(
            workspace_id="workspace-1",
            provider="notion",
            binding_id=binding_id,
        )
        is not None
    )
    assert [summary.id for summary in repository.list_enabled_bindings(workspace_id="workspace-1")] == [binding_id]
    assert (
        repository.change_disabled_state(
            workspace_id="workspace-1",
            binding_id=binding_id,
            disabled=False,
        )
        == "already_enabled"
    )
    assert repository.update_source_info(
        workspace_id="workspace-1",
        provider="notion",
        binding_id=binding_id,
        source_info={"workspace_id": "updated-workspace"},
    )
    assert (
        repository.change_disabled_state(
            workspace_id="workspace-1",
            binding_id=binding_id,
            disabled=True,
        )
        == "updated"
    )
    assert (
        repository.get_enabled(
            workspace_id="workspace-1",
            provider="notion",
            binding_id=binding_id,
        )
        is None
    )
