import json
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from unittest.mock import create_autospec, patch

import httpx
import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.models.document import Document
from models.dataset import Dataset, ExternalKnowledgeApis, ExternalKnowledgeBindings
from repositories.knowledge.external_repository import SQLAlchemyExternalKnowledgeRepository
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.knowledge.dataset_access import DatasetNotFoundError
from services.knowledge.entities.external import (
    ExternalKnowledgeRetrievalRequest,
    ExternalRetrievalCandidate,
    ExternalRetrievalConfig,
)
from services.knowledge.external.adapters import ExternalKnowledgeGateway
from services.knowledge.external.application import (
    ExternalDatasetRetrievalService,
    ExternalKnowledgeRepository,
    ExternalKnowledgeRetrieval,
)
from services.knowledge.retrieval.finalization import KnowledgeRetrievalFinalizer


class UnexpectedExternalKnowledgeRetrieval:
    def __init__(self) -> None:
        self.calls = 0

    def check_settings(self, settings: Mapping[str, object]) -> None:
        del settings
        self.calls += 1
        raise AssertionError("external retrieval must not validate settings")

    def retrieve(self, request: ExternalKnowledgeRetrievalRequest) -> list[ExternalRetrievalCandidate]:
        del request
        self.calls += 1
        raise AssertionError("external retrieval must not run")


@contextmanager
def _track_checked_out_connections(engine: Engine) -> Generator[set[object]]:
    checked_out: set[object] = set()

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        checked_out.add(record)

    def checkin(_connection: object, record: object) -> None:
        checked_out.discard(record)

    event.listen(engine, "checkout", checkout)
    event.listen(engine, "checkin", checkin)

    try:
        yield checked_out
    finally:
        event.remove(engine, "checkout", checkout)
        event.remove(engine, "checkin", checkin)


@pytest.mark.parametrize(
    ("stored_settings", "override_settings", "expected_settings"),
    [
        (None, None, {"top_k": 2, "score_threshold": 0.0}),
        (None, {}, {"top_k": 2, "score_threshold": 0.0}),
        ({}, None, {"top_k": 2, "score_threshold": 0.0}),
        ({"top_k": 5}, None, {"top_k": 5, "score_threshold": 0.0}),
        ({"top_k": 5}, {}, {"top_k": 5, "score_threshold": 0.0}),
        ({"top_k": 5}, {"top_k": 3}, {"top_k": 3, "score_threshold": 0.0}),
        (
            None,
            {"top_k": 3, "score_threshold_enabled": True, "score_threshold": 0.7},
            {"top_k": 3, "score_threshold": 0.7},
        ),
    ],
)
def test_runtime_retrieval_applies_settings_and_preserves_query_outside_transaction(
    sqlite_session_factory: sessionmaker[Session],
    sqlite_engine: Engine,
    stored_settings: dict[str, object] | None,
    override_settings: dict[str, object] | None,
    expected_settings: dict[str, object],
) -> None:
    with sqlite_session_factory.begin() as session:
        template = ExternalKnowledgeApis(
            tenant_id="tenant",
            created_by="actor",
            updated_by="actor",
            name="API",
            description="",
            settings=json.dumps({"endpoint": "https://example", "api_key": "secret"}),
        )
        template.id = "template"
        session.add_all(
            [
                template,
                Dataset(
                    id="dataset",
                    tenant_id="tenant",
                    created_by="actor",
                    name="Dataset",
                    provider="external",
                    retrieval_model=stored_settings,
                ),
                ExternalKnowledgeBindings(
                    tenant_id="tenant",
                    dataset_id="dataset",
                    external_knowledge_api_id="template",
                    external_knowledge_id="knowledge",
                    created_by="actor",
                ),
            ]
        )

    with _track_checked_out_connections(sqlite_engine) as checked_out:

        def send(_url: str, **_kwargs: object) -> httpx.Response:
            assert not checked_out
            return httpx.Response(200, json={"records": [{"content": "answer", "score": 0.9}]})

        adapter = ExternalDatasetRetrievalService(
            repository=SQLAlchemyExternalKnowledgeRepository(session_factory=sqlite_session_factory),
            gateway=ExternalKnowledgeGateway(),
        )
        with patch("services.knowledge.external.adapters.ssrf_proxy.post", autospec=True, side_effect=send) as request:
            result = adapter.retrieve(
                tenant_id="tenant",
                dataset_id="dataset",
                query=r'查找 "hello" C:\docs\hello',
                retrieval_model=ExternalRetrievalConfig.from_mapping(override_settings),
                metadata_filters=None,
            )

    assert len(result) == 1
    assert result[0].content == "answer"
    assert result[0].score == 0.9
    assert result[0].metadata == {}
    request.assert_called_once()
    payload = json.loads(request.call_args.kwargs["data"])
    assert payload["query"] == r'查找 "hello" C:\docs\hello'
    assert payload["retrieval_setting"] == expected_settings


def test_runtime_retrieval_missing_fields_map_and_rank_safely(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        template = ExternalKnowledgeApis(
            tenant_id="tenant",
            created_by="actor",
            updated_by="actor",
            name="API",
            description="",
            settings=json.dumps({"endpoint": "https://example", "api_key": "secret"}),
        )
        template.id = "template"
        session.add_all(
            [
                template,
                Dataset(
                    id="dataset",
                    tenant_id="tenant",
                    created_by="actor",
                    name="Dataset",
                    provider="external",
                ),
                ExternalKnowledgeBindings(
                    tenant_id="tenant",
                    dataset_id="dataset",
                    external_knowledge_api_id="template",
                    external_knowledge_id="knowledge",
                    created_by="actor",
                ),
            ]
        )

    adapter = ExternalDatasetRetrievalService(
        repository=SQLAlchemyExternalKnowledgeRepository(session_factory=sqlite_session_factory),
        gateway=ExternalKnowledgeGateway(),
    )
    with patch(
        "services.knowledge.external.adapters.ssrf_proxy.post",
        autospec=True,
        return_value=httpx.Response(
            200,
            json={"records": [{}, {"content": "ranked", "score": 0.6, "title": "Ranked"}]},
        ),
    ):
        records = adapter.retrieve(
            tenant_id="tenant",
            dataset_id="dataset",
            query="question",
            retrieval_model=None,
            metadata_filters=None,
        )

    documents: list[Document] = []
    for record in records:
        document = Document.model_validate(
            {
                "page_content": record.content,
                "metadata": record.metadata,
                "provider": "external",
            }
        )
        document.metadata["score"] = record.score
        documents.append(document)

    selected = KnowledgeRetrievalFinalizer(session_factory=sqlite_session_factory).finalize_response(
        candidates=documents,
        tenant_id="tenant",
        dataset_ids=["dataset"],
        top_k=2,
        retriever_from="workflow",
    )
    assert [source.content for source in selected.sources] == ["ranked", ""]
    assert documents[0].metadata["score"] == 0.0


@pytest.mark.parametrize("status", ["missing", "not_external"])
def test_runtime_retrieval_empty_repository_outcomes_skip_provider(status: str) -> None:
    repository = create_autospec(ExternalKnowledgeRepository, instance=True, spec_set=True)
    gateway = create_autospec(ExternalKnowledgeRetrieval, instance=True, spec_set=True)
    if status == "missing":
        repository.get_retrieval_request.side_effect = DatasetNotFoundError()
    else:
        repository.get_retrieval_request.return_value = None
    service = ExternalDatasetRetrievalService(repository=repository, gateway=gateway)

    assert (
        service.retrieve(
            tenant_id="tenant",
            dataset_id="dataset",
            query="question",
            retrieval_model=None,
            metadata_filters=None,
        )
        == []
    )
    gateway.retrieve.assert_not_called()


def test_runtime_retrieval_prepared_repository_outcome_calls_provider() -> None:
    repository = create_autospec(ExternalKnowledgeRepository, instance=True, spec_set=True)
    gateway = create_autospec(ExternalKnowledgeRetrieval, instance=True, spec_set=True)
    request = ExternalKnowledgeRetrievalRequest(
        endpoint="https://example.com",
        api_key=None,
        knowledge_id="knowledge",
        query="question",
        retrieval_model=ExternalRetrievalConfig(top_k=2),
        metadata_filters=None,
    )
    repository.get_retrieval_request.return_value = request
    gateway.retrieve.return_value = list[ExternalRetrievalCandidate]()
    service = ExternalDatasetRetrievalService(repository=repository, gateway=gateway)

    assert (
        service.retrieve(
            tenant_id="tenant",
            dataset_id="dataset",
            query="question",
            retrieval_model=None,
            metadata_filters=None,
        )
        == []
    )
    gateway.retrieve.assert_called_once_with(request)


@pytest.mark.parametrize(
    ("template_settings", "with_binding", "with_template"),
    [
        (None, False, False),
        (None, True, False),
        (None, True, True),
        ("{", True, True),
        (json.dumps([]), True, True),
    ],
    ids=["binding-missing", "template-missing", "settings-missing", "settings-malformed", "settings-not-object"],
)
def test_runtime_retrieval_surfaces_configuration_failures(
    sqlite_session_factory: sessionmaker[Session],
    template_settings: str | None,
    with_binding: bool,
    with_template: bool,
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(
            Dataset(
                id="dataset",
                tenant_id="tenant",
                created_by="actor",
                name="Dataset",
                provider="external",
            )
        )
        if with_template:
            template = ExternalKnowledgeApis(
                tenant_id="tenant",
                created_by="actor",
                updated_by="actor",
                name="API",
                description="",
                settings=template_settings,
            )
            template.id = "template"
            session.add(template)
        if with_binding:
            session.add(
                ExternalKnowledgeBindings(
                    tenant_id="tenant",
                    dataset_id="dataset",
                    external_knowledge_api_id="template",
                    external_knowledge_id="knowledge",
                    created_by="actor",
                )
            )

    gateway = UnexpectedExternalKnowledgeRetrieval()
    service = ExternalDatasetRetrievalService(
        repository=SQLAlchemyExternalKnowledgeRepository(session_factory=sqlite_session_factory),
        gateway=gateway,
    )

    with pytest.raises(ExternalKnowledgeRetrievalError, match="external knowledge configuration not found"):
        service.retrieve(
            tenant_id="tenant",
            dataset_id="dataset",
            query="question",
            retrieval_model=None,
            metadata_filters=None,
        )
    assert gateway.calls == 0
