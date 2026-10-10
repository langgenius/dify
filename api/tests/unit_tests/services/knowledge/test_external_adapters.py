import json
from collections.abc import Iterator
from unittest.mock import patch

import httpx
import pytest
from sqlalchemy import Engine, event, func, select
from sqlalchemy.orm import Session, sessionmaker

from constants import HIDDEN_VALUE
from controllers.console.datasets.external import ExternalKnowledgeApiListResponse
from machinery.context import RequestContext
from models.dataset import Dataset, DatasetQuery, ExternalKnowledgeApis, ExternalKnowledgeBindings
from services.entities.external_knowledge_entities.external_knowledge_entities import ExternalDatasetCreatePayload
from services.errors.knowledge_retrieval import ExternalKnowledgeRetrievalError
from services.knowledge.dataset_access import DatasetNotFoundError
from services.knowledge.external.adapters import SQLAlchemyExternalKnowledgeOperations
from services.knowledge.external.application import ExternalTemplateNotFoundError
from services.knowledge.resource_scope import DatasetRef

CONTEXT = RequestContext("request", None, "actor", "tenant")
REF = DatasetRef("tenant", "dataset")


@pytest.fixture
def operations(sqlite_session_factory: sessionmaker[Session]) -> SQLAlchemyExternalKnowledgeOperations:
    with sqlite_session_factory.begin() as session:
        for workspace, template_id, dataset_id in [
            ("tenant", "template", "dataset"),
            ("other", "foreign", "foreign-dataset"),
        ]:
            template = ExternalKnowledgeApis(
                tenant_id=workspace,
                created_by="actor",
                updated_by="actor",
                name="API",
                description="",
                settings=json.dumps({"endpoint": "https://example", "api_key": "secret"}),
            )
            template.id = template_id
            session.add_all(
                [
                    template,
                    Dataset(
                        id=dataset_id, tenant_id=workspace, created_by="actor", name="Dataset", provider="external"
                    ),
                    ExternalKnowledgeBindings(
                        tenant_id=workspace,
                        dataset_id=dataset_id,
                        external_knowledge_api_id=template_id,
                        external_knowledge_id="knowledge",
                        created_by="actor",
                    ),
                ]
            )
    return SQLAlchemyExternalKnowledgeOperations(session_factory=sqlite_session_factory)


@pytest.fixture
def checked_out(sqlite_engine: Engine) -> Iterator[set[object]]:
    active: set[object] = set()

    def checkout(_connection: object, record: object, _proxy: object) -> None:
        active.add(record)

    def checkin(_connection: object, record: object) -> None:
        active.discard(record)

    event.listen(sqlite_engine, "checkout", checkout)
    event.listen(sqlite_engine, "checkin", checkin)
    try:
        yield active
    finally:
        event.remove(sqlite_engine, "checkout", checkout)
        event.remove(sqlite_engine, "checkin", checkin)


def test_template_list_materializes_bindings_and_settings(
    operations: SQLAlchemyExternalKnowledgeOperations,
) -> None:
    result = ExternalKnowledgeApiListResponse.model_validate(
        operations.list_templates("tenant", page=0, limit=0, keyword=None)
    ).model_dump(mode="json")
    assert result["total"] == 1
    assert result["limit"] == 1
    assert result["has_more"] is False
    assert result["data"][0]["settings"] == {"endpoint": "https://example", "api_key": "secret"}
    assert result["data"][0]["dataset_bindings"] == [{"id": "dataset", "name": "Dataset"}]


@pytest.mark.parametrize("method", ["get_template", "update_template", "delete_template"])
def test_template_read_write_scope(operations: SQLAlchemyExternalKnowledgeOperations, method: str) -> None:
    if method == "update_template":
        with pytest.raises(ExternalTemplateNotFoundError):
            operations.update_template(
                CONTEXT, "foreign", name="changed", settings={"api_key": "key", "endpoint": "https://example"}
            )
    else:
        operation = operations.get_template if method == "get_template" else operations.delete_template
        with pytest.raises(ExternalTemplateNotFoundError):
            operation("tenant", "foreign")
    assert operations.template_usage("tenant", "foreign") == (False, 0)


def test_masked_update_preserves_secret_without_mutating_request(
    operations: SQLAlchemyExternalKnowledgeOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    settings = {"endpoint": "https://changed", "api_key": HIDDEN_VALUE}
    operations.update_template(CONTEXT, "template", name="Renamed", settings=settings)
    assert settings["api_key"] == HIDDEN_VALUE
    with sqlite_session_factory() as session:
        template = session.get(ExternalKnowledgeApis, "template")
        assert template is not None
        assert template.name == "Renamed"
        settings = template.settings_dict
        assert settings is not None
        assert settings["api_key"] == "secret"


def test_creation_probes_outside_transaction_then_commits(
    operations: SQLAlchemyExternalKnowledgeOperations,
    checked_out: set[object],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    def probe(_settings: dict[str, object]) -> None:
        assert not checked_out

    with patch(
        "services.knowledge.external.service.ExternalDatasetService.check_endpoint_and_api_key", side_effect=probe
    ):
        result = operations.create_template(
            CONTEXT, name="New", settings={"endpoint": "https://example", "api_key": "secret"}
        )
    with sqlite_session_factory() as session:
        assert session.get(ExternalKnowledgeApis, result["id"]) is not None


def test_external_dataset_cannot_bind_foreign_template(operations: SQLAlchemyExternalKnowledgeOperations) -> None:
    with pytest.raises(ExternalTemplateNotFoundError):
        operations.create_dataset(
            CONTEXT,
            ExternalDatasetCreatePayload(
                name="New", external_knowledge_api_id="foreign", external_knowledge_id="knowledge"
            ),
        )


def test_retrieval_releases_read_session_before_http_and_commits_query(
    operations: SQLAlchemyExternalKnowledgeOperations,
    checked_out: set[object],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    def send(_request: object, _files: object) -> httpx.Response:
        assert not checked_out
        return httpx.Response(
            200,
            json={"records": [{"content": "answer", "title": "title", "score": 0.9, "metadata": {"source": "doc"}}]},
        )

    with patch(
        "services.knowledge.external.service.ExternalDatasetService.process_external_api", side_effect=send
    ) as request:
        result = operations.retrieve(
            CONTEXT, REF, query='"question"', retrieval_model={"top_k": 3}, metadata_filters=None
        )
    assert result["query"] == {"content": '"question"'}
    assert result["records"][0]["content"] == "answer"
    prepared = request.call_args.args[0]
    assert prepared.params["query"] == '\\"question\\"'
    assert prepared.params["knowledge_id"] == "knowledge"
    assert prepared.params["retrieval_setting"] == {"top_k": 3, "score_threshold": 0.0}
    with sqlite_session_factory() as session:
        saved = session.scalar(select(DatasetQuery))
        assert saved is not None
        assert saved.created_by == "actor"
        assert saved.content == '"question"'
        assert saved.dataset_id == "dataset"


def test_retrieval_failure_does_not_record_query(
    operations: SQLAlchemyExternalKnowledgeOperations, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with patch(
        "services.knowledge.external.service.ExternalDatasetService.process_external_api",
        return_value=httpx.Response(502, text="unavailable"),
    ):
        with pytest.raises(ExternalKnowledgeRetrievalError):
            operations.retrieve(CONTEXT, REF, query="query", retrieval_model=None, metadata_filters=None)
    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(DatasetQuery)) == 0


def test_retrieval_rejects_foreign_dataset_before_network(operations: SQLAlchemyExternalKnowledgeOperations) -> None:
    with patch("services.knowledge.external.service.ExternalDatasetService.process_external_api") as request:
        with pytest.raises(DatasetNotFoundError):
            operations.retrieve(
                CONTEXT,
                DatasetRef("tenant", "foreign-dataset"),
                query="query",
                retrieval_model=None,
                metadata_filters=None,
            )
        request.assert_not_called()
