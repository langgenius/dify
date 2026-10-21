"""Retrieval discards partial vectors and results crossing a rebuild boundary."""

import pytest
from flask import Flask
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.errors.error import KnowledgeIndexUnavailableError
from core.rag.datasource import retrieval_service as retrieval_module
from core.rag.datasource.retrieval_service import RetrievalService
from core.rag.models.document import Document
from core.rag.retrieval.retrieval_methods import RetrievalMethod
from models.dataset import Dataset
from models.knowledge_task import KnowledgeTaskOutbox
from repositories.knowledge.dataset_retrieval_repository import (
    get_dataset_retrieval_target,
    verify_dataset_retrieval_target,
)


def _intent(*, status: str, superseded: bool | None = False, action: str = "update") -> KnowledgeTaskOutbox:
    return KnowledgeTaskOutbox(
        tenant_id="tenant",
        dataset_id="dataset",
        resource_id="dataset",
        task_kind="dataset_vector_index_update",
        status=status,
        payload={
            "action": action,
            "superseded": superseded,
            "expected_indexing_technique": "high_quality",
            "expected_embedding_model_provider": "provider",
            "expected_embedding_model": "embedding",
        },
    )


@pytest.fixture
def dataset(sqlite_session_factory: sessionmaker[Session]) -> Dataset:
    dataset = Dataset(
        id="dataset",
        tenant_id="tenant",
        name="Knowledge",
        created_by="actor",
        provider="vendor",
        indexing_technique="high_quality",
        embedding_model_provider="provider",
        embedding_model="embedding",
    )
    with sqlite_session_factory.begin() as session:
        session.add(dataset)
    return dataset


@pytest.mark.parametrize(
    ("status", "reason"),
    [("pending", "indexing"), ("dispatched", "indexing"), ("executing", "indexing"), ("failed", "failed")],
)
def test_current_unfinished_target_is_unavailable(
    sqlite_session_factory: sessionmaker[Session],
    dataset: Dataset,
    status: str,
    reason: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_intent(status=status))
    with sqlite_session_factory() as session, pytest.raises(KnowledgeIndexUnavailableError) as failure:
        get_dataset_retrieval_target(session, dataset)
    assert failure.value.reason == reason


@pytest.mark.parametrize("case", ["legacy", "unmarked", "historical", "remove", "economy", "completed"])
def test_usable_target_is_not_blocked_by_unrelated_work(
    sqlite_session_factory: sessionmaker[Session],
    dataset: Dataset,
    case: str,
) -> None:
    with sqlite_session_factory.begin() as session:
        if case == "economy":
            dataset.indexing_technique = "economy"
            session.get_one(Dataset, dataset.id).indexing_technique = "economy"
        if case != "legacy":
            session.add(
                _intent(
                    status="completed" if case == "completed" else "failed",
                    superseded=None if case == "unmarked" else case == "historical",
                    action="remove" if case == "remove" else "update",
                )
            )
    with sqlite_session_factory() as session:
        target = get_dataset_retrieval_target(session, dataset)
    with sqlite_session_factory() as session:
        verify_dataset_retrieval_target(session, target)


def test_even_a_completed_same_configuration_rebuild_invalidates_inflight_results(
    sqlite_session_factory: sessionmaker[Session],
    dataset: Dataset,
) -> None:
    with sqlite_session_factory.begin() as session:
        old_intent = _intent(status="completed")
        session.add(old_intent)
    with sqlite_session_factory() as session:
        target = get_dataset_retrieval_target(session, dataset)
    with sqlite_session_factory.begin() as session:
        session.get_one(KnowledgeTaskOutbox, old_intent.id).payload = {**old_intent.payload, "superseded": True}
        session.add(_intent(status="completed"))
    with sqlite_session_factory() as session, pytest.raises(KnowledgeIndexUnavailableError):
        verify_dataset_retrieval_target(session, target)


def test_retrieval_discards_results_if_provider_call_crosses_a_rebuild(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    dataset: Dataset,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(type(retrieval_module.db), "engine", property(lambda _db: sqlite_engine))
    calls: list[str] = []

    def retrieve_provider(_self: RetrievalService, *, all_documents: list[Document], **_kwargs: object) -> None:
        calls.append("provider")
        all_documents.append(Document(page_content="partial vectors", metadata={}))
        with sqlite_session_factory.begin() as session:
            session.add(_intent(status="pending"))

    monkeypatch.setattr(RetrievalService, "_retrieve", retrieve_provider)
    with Flask(__name__).app_context(), pytest.raises(KnowledgeIndexUnavailableError) as failure:
        RetrievalService.retrieve(RetrievalMethod.SEMANTIC_SEARCH, dataset.id, "query")
    assert failure.value.reason == "indexing"
    assert calls == ["provider"]
