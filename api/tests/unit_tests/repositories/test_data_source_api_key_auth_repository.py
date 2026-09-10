import json
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.source import DataSourceApiKeyAuthBinding
from repositories.data_source_api_key_auth_repository import SQLAlchemyDataSourceApiKeyAuthBindingRepository
from services.entities.data_source_api_key_auth_entities import DataSourceApiKeyAuthCredentials


def _binding(
    *,
    workspace_id: str,
    binding_id: str,
    disabled: bool = False,
) -> DataSourceApiKeyAuthBinding:
    binding = DataSourceApiKeyAuthBinding(
        tenant_id=workspace_id,
        category="search",
        provider="firecrawl",
        credentials=json.dumps({"auth_type": "bearer", "config": {"api_key": "encrypted"}}),
        disabled=disabled,
    )
    binding.id = binding_id
    binding.created_at = datetime(2026, 1, 1)
    binding.updated_at = datetime(2026, 1, 2)
    return binding


def test_list_enabled_is_scoped_and_returns_detached_records(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _binding(workspace_id="workspace-1", binding_id="enabled"),
                _binding(workspace_id="workspace-1", binding_id="disabled", disabled=True),
                _binding(workspace_id="workspace-2", binding_id="foreign"),
            ]
        )

    repository = SQLAlchemyDataSourceApiKeyAuthBindingRepository(sqlite_session_factory)

    assert [binding.id for binding in repository.list_enabled("workspace-1")] == ["enabled"]


def test_create_serializes_credentials(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyDataSourceApiKeyAuthBindingRepository(sqlite_session_factory)
    credentials = DataSourceApiKeyAuthCredentials(
        auth_type="bearer",
        api_key="encrypted",
        options={"base_url": "https://example.com"},
    )

    repository.create("workspace-1", "search", "firecrawl", credentials)

    with sqlite_session_factory() as session:
        binding = session.scalar(
            select(DataSourceApiKeyAuthBinding).where(DataSourceApiKeyAuthBinding.tenant_id == "workspace-1")
        )

    assert binding is not None
    assert binding.credentials is not None
    assert json.loads(binding.credentials) == {
        "auth_type": "bearer",
        "config": {"api_key": "encrypted", "base_url": "https://example.com"},
    }


def test_delete_is_scoped_to_workspace(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_binding(workspace_id="workspace-1", binding_id="binding-1"))

    repository = SQLAlchemyDataSourceApiKeyAuthBindingRepository(sqlite_session_factory)
    repository.delete("workspace-2", "binding-1")

    with sqlite_session_factory() as session:
        assert (
            session.scalar(select(DataSourceApiKeyAuthBinding).where(DataSourceApiKeyAuthBinding.id == "binding-1"))
            is not None
        )

    repository.delete("workspace-1", "binding-1")

    with sqlite_session_factory() as session:
        assert (
            session.scalar(select(DataSourceApiKeyAuthBinding).where(DataSourceApiKeyAuthBinding.id == "binding-1"))
            is None
        )
