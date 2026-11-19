from collections.abc import Callable, Sequence

import pytest
from sqlalchemy import event, select, text
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Dataset, DatasetPermission
from models.enums import ApiTokenType
from models.model import ApiToken, DatasetApiTokenBinding
from repositories.knowledge import dataset_repository as module
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from services.knowledge.entities.resource_scope import DatasetRef


def _persist_scope(session_factory: sessionmaker[Session]) -> tuple[DatasetRef, str]:
    ref = DatasetRef("tenant", "dataset")
    with session_factory.begin() as session:
        session.execute(text("PRAGMA foreign_keys = ON"))
        dataset = Dataset(id=ref.dataset_id, tenant_id=ref.tenant_id, name="Dataset", created_by="owner")
        key = ApiToken(
            id="key",
            tenant_id=ref.tenant_id,
            type=ApiTokenType.DATASET,
            token="dataset-secret",
        )
        session.add_all([dataset, key])
        session.flush()
        session.add_all(
            [
                DatasetApiTokenBinding(api_token_id=key.id, dataset_id=dataset.id),
                DatasetPermission(tenant_id=ref.tenant_id, dataset_id=ref.dataset_id, account_id="owner"),
            ]
        )
    return ref, key.token


def _after_commit_recorder(calls: list[tuple[str, ...]]) -> Callable[[Session, Sequence[str]], None]:
    def register(session: Session, tokens: Sequence[str]) -> None:
        captured = tuple(tokens)
        event.listen(session, "after_commit", lambda _session: calls.append(captured), once=True)

    return register


def _repository(
    session_factory: sessionmaker[Session],
    *,
    revoked: list[tuple[str, ...]],
) -> SQLAlchemyDatasetRepository:
    return SQLAlchemyDatasetRepository(
        session_factory=session_factory,
        revoke_keys_after_commit=_after_commit_recorder(revoked),
    )


def test_delete_dataset_commits_key_cleanup_and_returns_cleanup_record(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    ref, token = _persist_scope(sqlite_session_factory)
    revoked: list[tuple[str, ...]] = []
    repository = _repository(sqlite_session_factory, revoked=revoked)

    cleanup = repository.delete_with_relations(ref)
    assert cleanup is not None
    assert cleanup.id == ref.dataset_id
    assert cleanup.workspace_id == ref.tenant_id

    with sqlite_session_factory() as session:
        assert session.get(Dataset, ref.dataset_id) is None
        assert session.get(ApiToken, "key") is None
        assert session.scalar(select(DatasetApiTokenBinding)) is None
        assert session.scalar(select(DatasetPermission)) is None
    assert revoked == [(token,)]


def test_delete_dataset_rolls_back_key_cleanup_with_relation_failure(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ref, _ = _persist_scope(sqlite_session_factory)
    revoked: list[tuple[str, ...]] = []
    repository = _repository(sqlite_session_factory, revoked=revoked)

    def fail_relations(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("relation cleanup failed")

    monkeypatch.setattr(module.ResourceAccessTokenCleanupRepository, "delete_resource_relations", fail_relations)

    with pytest.raises(RuntimeError, match="relation cleanup failed"):
        repository.delete_with_relations(ref)

    with sqlite_session_factory() as session:
        assert session.get(Dataset, ref.dataset_id) is not None
        assert session.get(ApiToken, "key") is not None
        assert session.scalar(select(DatasetApiTokenBinding)) is not None
        assert session.scalar(select(DatasetPermission)) is not None
    assert revoked == []


def test_delete_dataset_commit_failure_rolls_back_relations(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    ref, _ = _persist_scope(sqlite_session_factory)
    revoked: list[tuple[str, ...]] = []
    repository = _repository(sqlite_session_factory, revoked=revoked)

    def fail_commit(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(Session, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            repository.delete_with_relations(ref)
    finally:
        event.remove(Session, "before_commit", fail_commit)

    with sqlite_session_factory() as session:
        assert session.get(Dataset, ref.dataset_id) is not None
    assert revoked == []
