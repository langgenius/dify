from datetime import datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.api_based_extension import APIBasedExtension
from repositories.api_based_extension_repository import APIBasedExtensionRepository
from services.api_based_extension_application_service import (
    APIBasedExtensionInput,
    APIBasedExtensionNotFoundError,
)


def _extension(
    extension_id: str,
    *,
    workspace_id: str,
    name: str,
    created_at: datetime,
    api_key: str = "cipher-text",
) -> APIBasedExtension:
    extension = APIBasedExtension(
        tenant_id=workspace_id,
        name=name,
        api_endpoint=f"https://{name}.example.com",
        api_key=api_key,
    )
    extension.id = extension_id
    extension.created_at = created_at
    return extension


def test_list_extensions_is_workspace_scoped_and_newest_first(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _extension("ext-1", workspace_id="workspace-1", name="older", created_at=datetime(2024, 1, 1, 12, 0)),
                _extension("ext-2", workspace_id="workspace-1", name="newer", created_at=datetime(2024, 1, 2, 12, 0)),
                _extension("ext-3", workspace_id="workspace-2", name="other", created_at=datetime(2024, 1, 3, 12, 0)),
            ]
        )

    repository = APIBasedExtensionRepository(session_factory=sqlite_session_factory)

    records = repository.list_extensions("workspace-1")

    assert [record.id for record in records] == ["ext-2", "ext-1"]
    assert records[0].api_key == "cipher-text"
    assert records[0].api_endpoint == "https://newer.example.com"


def test_find_extension_does_not_cross_workspaces(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_extension("ext-1", workspace_id="workspace-1", name="mine", created_at=datetime(2024, 1, 1)))

    repository = APIBasedExtensionRepository(session_factory=sqlite_session_factory)

    found = repository.find_extension("workspace-1", "ext-1")
    assert found is not None
    assert found.name == "mine"
    assert repository.find_extension("workspace-2", "ext-1") is None
    assert repository.find_extension("workspace-1", "missing") is None


def test_name_exists_honours_workspace_and_exclusion(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_extension("ext-1", workspace_id="workspace-1", name="taken", created_at=datetime(2024, 1, 1)))

    repository = APIBasedExtensionRepository(session_factory=sqlite_session_factory)

    assert repository.name_exists("workspace-1", "taken") is True
    assert repository.name_exists("workspace-1", "taken", exclude_id="ext-1") is False
    assert repository.name_exists("workspace-1", "taken", exclude_id="ext-9") is True
    assert repository.name_exists("workspace-2", "taken") is False
    assert repository.name_exists("workspace-1", "free") is False


def test_create_extension_persists_the_given_ciphertext(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = APIBasedExtensionRepository(session_factory=sqlite_session_factory)

    record = repository.create_extension(
        "workspace-1",
        APIBasedExtensionInput(name="Docs", api_endpoint="https://docs.example.com", api_key="cipher-text"),
    )

    assert record.name == "Docs"
    assert record.api_key == "cipher-text"
    assert isinstance(record.created_at, datetime)
    with sqlite_session_factory() as session:
        stored = session.scalar(select(APIBasedExtension).where(APIBasedExtension.id == record.id))
        assert stored is not None
        assert stored.tenant_id == "workspace-1"
        assert stored.api_key == "cipher-text"


def test_update_extension_overwrites_fields_within_the_workspace(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_extension("ext-1", workspace_id="workspace-1", name="old", created_at=datetime(2024, 1, 1)))

    repository = APIBasedExtensionRepository(session_factory=sqlite_session_factory)

    record = repository.update_extension(
        "workspace-1",
        "ext-1",
        APIBasedExtensionInput(name="new", api_endpoint="https://new.example.com", api_key="new-cipher"),
    )

    assert (record.name, record.api_endpoint, record.api_key) == ("new", "https://new.example.com", "new-cipher")
    with sqlite_session_factory() as session:
        stored = session.get(APIBasedExtension, "ext-1")
        assert stored is not None
        assert stored.name == "new"

    with pytest.raises(APIBasedExtensionNotFoundError):
        repository.update_extension(
            "workspace-2",
            "ext-1",
            APIBasedExtensionInput(name="x", api_endpoint="https://x.example.com", api_key="x"),
        )


def test_delete_extension_requires_a_scoped_match(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_extension("ext-1", workspace_id="workspace-1", name="doomed", created_at=datetime(2024, 1, 1)))

    repository = APIBasedExtensionRepository(session_factory=sqlite_session_factory)

    with pytest.raises(APIBasedExtensionNotFoundError):
        repository.delete_extension("workspace-2", "ext-1")

    repository.delete_extension("workspace-1", "ext-1")

    with sqlite_session_factory() as session:
        assert session.get(APIBasedExtension, "ext-1") is None
