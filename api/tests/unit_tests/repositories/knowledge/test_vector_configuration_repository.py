import json
from collections.abc import Iterator
from typing import Protocol

import pytest
from sqlalchemy import Table, create_engine
from sqlalchemy.orm import Session, sessionmaker

from core.rag.datasource.vdb.vector_type import VectorType
from models.base import TypeBase
from models.dataset import Dataset, Whitelist
from repositories.knowledge.vector_configuration_repository import (
    resolve_vector_type,
    resolve_vector_type_for_tenant,
)

_TENANT_ID = "00000000-0000-0000-0000-000000000001"
_FOREIGN_TENANT_ID = "00000000-0000-0000-0000-000000000002"


class ConfigOverrides(Protocol):
    def __call__(self, **values: object) -> None: ...


@pytest.fixture
def whitelist_sessions() -> Iterator[sessionmaker[Session]]:
    engine = create_engine("sqlite://")
    table = Whitelist.__table__
    assert isinstance(table, Table)
    TypeBase.metadata.create_all(engine, tables=[table])
    sessions = sessionmaker(engine, expire_on_commit=False)
    yield sessions
    engine.dispose()


def test_resolve_vector_type_for_tenant_uses_configured_default(
    config_overrides: ConfigOverrides,
    whitelist_sessions: sessionmaker[Session],
) -> None:
    config_overrides(VECTOR_STORE=VectorType.QDRANT, VECTOR_STORE_WHITELIST_ENABLE=True)

    with whitelist_sessions() as session:
        vector_type = resolve_vector_type_for_tenant(tenant_id=_TENANT_ID, session=session)

    assert vector_type == VectorType.QDRANT


def test_resolve_vector_type_for_tenant_uses_whitelist_override(
    config_overrides: ConfigOverrides,
    whitelist_sessions: sessionmaker[Session],
) -> None:
    config_overrides(VECTOR_STORE=VectorType.QDRANT, VECTOR_STORE_WHITELIST_ENABLE=True)
    with whitelist_sessions.begin() as session:
        session.add(Whitelist(tenant_id=_TENANT_ID, category="vector_db"))

    with whitelist_sessions() as session:
        vector_type = resolve_vector_type_for_tenant(tenant_id=_TENANT_ID, session=session)

    assert vector_type == VectorType.TIDB_ON_QDRANT


@pytest.mark.parametrize(
    ("whitelist_tenant_id", "category"),
    [
        (_FOREIGN_TENANT_ID, "vector_db"),
        (_TENANT_ID, "unrelated"),
    ],
)
def test_resolve_vector_type_for_tenant_ignores_unrelated_whitelist(
    config_overrides: ConfigOverrides,
    whitelist_sessions: sessionmaker[Session],
    whitelist_tenant_id: str,
    category: str,
) -> None:
    config_overrides(VECTOR_STORE=VectorType.QDRANT, VECTOR_STORE_WHITELIST_ENABLE=True)
    with whitelist_sessions.begin() as session:
        session.add(Whitelist(tenant_id=whitelist_tenant_id, category=category))

    with whitelist_sessions() as session:
        vector_type = resolve_vector_type_for_tenant(tenant_id=_TENANT_ID, session=session)

    assert vector_type == VectorType.QDRANT


def test_resolve_vector_type_prefers_dataset_index_struct(
    config_overrides: ConfigOverrides,
    whitelist_sessions: sessionmaker[Session],
) -> None:
    config_overrides(VECTOR_STORE=VectorType.QDRANT, VECTOR_STORE_WHITELIST_ENABLE=True)
    with whitelist_sessions.begin() as session:
        session.add(Whitelist(tenant_id=_TENANT_ID, category="vector_db"))
    dataset = Dataset(
        id="00000000-0000-0000-0000-000000000003",
        tenant_id=_TENANT_ID,
        index_struct=json.dumps({"type": VectorType.WEAVIATE}),
    )

    with whitelist_sessions() as session:
        vector_type = resolve_vector_type(dataset, session=session)

    assert vector_type == VectorType.WEAVIATE


def test_resolve_vector_type_for_tenant_requires_configured_backend(
    config_overrides: ConfigOverrides,
    whitelist_sessions: sessionmaker[Session],
) -> None:
    config_overrides(VECTOR_STORE=None, VECTOR_STORE_WHITELIST_ENABLE=True)

    with whitelist_sessions() as session, pytest.raises(ValueError, match="Vector store must be specified"):
        resolve_vector_type_for_tenant(tenant_id=_TENANT_ID, session=session)
