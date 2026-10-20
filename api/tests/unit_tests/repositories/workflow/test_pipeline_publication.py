"""Pipeline publication prepares externally and commits all persistent changes together."""

import json
from collections.abc import Callable, Generator
from typing import Literal, override

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from machinery.context import RequestContext
from models.dataset import Dataset, DatasetCollectionBinding, Pipeline
from models.workflow import Workflow, WorkflowType
from repositories.workflow.pipeline_publication_repository import PipelinePublicationRepository
from services.errors.app import WorkflowHashNotEqualError, WorkflowNotFoundError
from services.rag_pipeline.publication_contracts import EmbeddingModel
from services.rag_pipeline.publication_gateway import PipelinePublicationModelGateway
from services.rag_pipeline.publication_service import PipelinePublicationService
from services.workflow.contracts import WorkflowSnapshot
from tests.unit_tests.model_factories import make_dataset, make_workflow

CONTEXT = RequestContext("publish", None, "account-1", "tenant-1")


def required[T](session: Session, model: type[T], identity: str | None) -> T:
    assert identity is not None
    row = session.get(model, identity)
    assert row is not None
    return row


def configuration(**changes: object) -> dict[str, object]:
    return {
        "type": "knowledge-index",
        "chunk_structure": "text_model",
        "indexing_technique": "economy",
        "keyword_number": 23,
        "embedding_model_provider": "openai",
        "embedding_model": "embedding-new",
        "retrieval_model": {"search_method": "semantic_search", "top_k": 4, "reranking_enable": False},
        "summary_index_setting": {"enable": True},
        **changes,
    }


class ModelGateway(PipelinePublicationModelGateway):
    def __init__(self, boundary: Callable[[], None]) -> None:
        self.boundary = boundary
        self.prepared: list[tuple[str, str, str, bool]] = []
        self.available = True
        self.on_prepare: Callable[[], None] = lambda: None

    @override
    def validate_workflow(self, draft: WorkflowSnapshot) -> None:
        self.boundary()
        self.on_prepare()
        super().validate_workflow(draft)

    @override
    def embedding(self, tenant_id: str, provider: str, name: str, *, allow_missing: bool) -> EmbeddingModel | None:
        self.boundary()
        self.prepared.append((tenant_id, provider, name, allow_missing))
        if not self.available:
            if allow_missing:
                return None
            raise ValueError("Model credentials unavailable")
        return EmbeddingModel(str(self.provider_id(provider)), name, True)


class IndexUpdates:
    def __init__(self, sessions: sessionmaker[Session], boundary: Callable[[], None]) -> None:
        self.sessions = sessions
        self.boundary = boundary
        self.dispatched: list[tuple[str, str]] = []

    def dispatch(self, dataset_id: str, action: Literal["add", "update"]) -> None:
        self.boundary()
        with self.sessions() as session:
            pipeline = required(session, Pipeline, "pipeline-1")
            assert pipeline is not None
            assert pipeline.is_published
            published = required(session, Workflow, pipeline.workflow_id)
            assert published is not None
            assert published.version != "draft"
        self.dispatched.append((dataset_id, action))


type Publication = tuple[PipelinePublicationService, ModelGateway, IndexUpdates]


@pytest.fixture
def publication(sqlite_session_factory: sessionmaker[Session]) -> Generator[Publication, None, None]:
    sessions = sqlite_session_factory
    with sessions.begin() as session:
        pipeline = Pipeline(tenant_id="tenant-1", name="Pipeline", created_by="account-1", is_published=False)
        pipeline.id = "pipeline-1"
        pipeline.workflow_id = "draft-1"
        draft = make_workflow(workflow_id="draft-1", app_id=pipeline.id, graph={"nodes": [{"data": configuration()}]})
        draft.type = WorkflowType.RAG_PIPELINE
        dataset = make_dataset(dataset_id="dataset-1", tenant_id="tenant-1", created_by="account-1")
        dataset.pipeline_id = pipeline.id
        dataset.chunk_structure = "text_model"
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
        dataset.embedding_model_provider = "openai"
        dataset.embedding_model = "embedding-old"
        session.add_all([pipeline, draft, dataset])
    checked_out = 0

    def checkout(*_args: object) -> None:
        nonlocal checked_out
        checked_out += 1

    def checkin(*_args: object) -> None:
        nonlocal checked_out
        checked_out -= 1

    def boundary() -> None:
        assert checked_out == 0, "External preparation or dispatch held a database connection"

    engine = sessions.kw["bind"]
    event.listen(engine, "checkout", checkout)
    event.listen(engine, "checkin", checkin)
    models = ModelGateway(boundary)
    indexes = IndexUpdates(sessions, boundary)
    service = PipelinePublicationService(PipelinePublicationRepository(sessions), models, indexes)
    try:
        yield service, models, indexes
    finally:
        event.remove(engine, "checkout", checkout)
        event.remove(engine, "checkin", checkin)


def change_config(sessions: sessionmaker[Session], **changes: object) -> None:
    with sessions.begin() as session:
        draft = required(session, Workflow, "draft-1")
        assert draft is not None
        draft.graph = json.dumps({"nodes": [{"data": configuration(**changes)}]})


@pytest.mark.parametrize("published", [False, True])
@pytest.mark.parametrize("technique", ["economy", "high_quality"])
def test_publish_commits_version_pointer_and_settings(
    publication: Publication, sqlite_session_factory: sessionmaker[Session], published: bool, technique: str
) -> None:
    service, models, indexes = publication
    with sqlite_session_factory.begin() as session:
        pipeline = required(session, Pipeline, "pipeline-1")
        pipeline.is_published = published
    change_config(sqlite_session_factory, indexing_technique=technique)
    result = service.publish(CONTEXT, "pipeline-1")
    with sqlite_session_factory() as session:
        pipeline = required(session, Pipeline, "pipeline-1")
        dataset = required(session, Dataset, "dataset-1")
        draft = required(session, Workflow, "draft-1")
        assert pipeline.workflow_id == result.id
        assert pipeline.is_published
        assert result.graph == draft.graph
        assert result.version != "draft"
        assert result.created_by == CONTEXT.account_id
        assert dataset.indexing_technique == technique
        assert dataset.summary_index_setting == {"enable": True}
        assert dataset.retrieval_model["top_k"] == 4
        if technique == "economy":
            assert dataset.keyword_number == 23
            assert models.prepared == []
        else:
            binding = required(session, DatasetCollectionBinding, dataset.collection_binding_id)
            assert binding is not None
            assert binding.provider_name == dataset.embedding_model_provider == "langgenius/openai/openai"
            assert binding.model_name == dataset.embedding_model == "embedding-new"
            assert dataset.is_multimodal
    assert indexes.dispatched == ([("dataset-1", "add")] if published and technique == "high_quality" else [])


@pytest.mark.parametrize("model_case", ["changed", "alias", "missing"])
def test_published_embedding_policy(
    publication: Publication, sqlite_session_factory: sessionmaker[Session], model_case: str
) -> None:
    service, models, indexes = publication
    with sqlite_session_factory.begin() as session:
        required(session, Pipeline, "pipeline-1").is_published = True
        dataset = required(session, Dataset, "dataset-1")
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.embedding_model_provider = "langgenius/openai/openai"
    models.available = model_case != "missing"
    change_config(
        sqlite_session_factory,
        indexing_technique="high_quality",
        embedding_model="embedding-old" if model_case == "alias" else "embedding-new",
    )
    service.publish(CONTEXT, "pipeline-1")
    with sqlite_session_factory() as session:
        dataset = required(session, Dataset, "dataset-1")
        assert dataset.embedding_model == ("embedding-new" if model_case == "changed" else "embedding-old")
    assert len(models.prepared) == (0 if model_case == "alias" else 1)
    assert indexes.dispatched == ([] if model_case == "alias" else [("dataset-1", "update")])


@pytest.mark.parametrize("conflict", ["draft", "dataset", "pipeline"])
def test_preparation_race_rejects_without_partial_publication(
    publication: Publication, sqlite_session_factory: sessionmaker[Session], conflict: str
) -> None:
    service, models, indexes = publication

    def modify() -> None:
        with sqlite_session_factory.begin() as session:
            if conflict == "draft":
                required(session, Workflow, "draft-1").graph = '{"nodes": []}'
            elif conflict == "dataset":
                required(session, Dataset, "dataset-1").keyword_number = 99
            else:
                required(session, Pipeline, "pipeline-1").is_published = True

    models.on_prepare = modify
    with pytest.raises(WorkflowHashNotEqualError):
        service.publish(CONTEXT, "pipeline-1")
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(Workflow.id))) == ["draft-1"]
        assert required(session, Pipeline, "pipeline-1").workflow_id == "draft-1"
    assert indexes.dispatched == []


def test_publication_failure_rolls_back_collection_and_dataset(
    publication: Publication, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, _, indexes = publication
    change_config(sqlite_session_factory, indexing_technique="high_quality")

    def reject(_session: Session) -> None:
        raise RuntimeError("commit failed")

    event.listen(sqlite_session_factory, "before_commit", reject)
    try:
        with pytest.raises(RuntimeError, match="commit failed"):
            service.publish(CONTEXT, "pipeline-1")
    finally:
        event.remove(sqlite_session_factory, "before_commit", reject)
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(Workflow.id))) == ["draft-1"]
        assert list(session.scalars(select(DatasetCollectionBinding.id))) == []
        pipeline = required(session, Pipeline, "pipeline-1")
        dataset = required(session, Dataset, "dataset-1")
        assert pipeline.workflow_id == "draft-1"
        assert not pipeline.is_published
        assert dataset.indexing_technique == "economy"
        assert dataset.embedding_model == "embedding-old"
    assert indexes.dispatched == []


@pytest.mark.parametrize("case", ["chunk", "economy", "missing-dataset", "foreign-dataset", "missing-draft", "tenant"])
def test_rejections_preserve_publication_state(
    publication: Publication, sqlite_session_factory: sessionmaker[Session], case: str
) -> None:
    service, _, indexes = publication
    with sqlite_session_factory.begin() as session:
        pipeline = required(session, Pipeline, "pipeline-1")
        dataset = required(session, Dataset, "dataset-1")
        if case in {"chunk", "economy"}:
            pipeline.is_published = True
            if case == "chunk":
                dataset.chunk_structure = "qa_model"
            else:
                dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        elif case == "missing-dataset":
            session.delete(dataset)
        elif case == "foreign-dataset":
            dataset.tenant_id = "tenant-other"
        elif case == "missing-draft":
            session.delete(required(session, Workflow, "draft-1"))
    context = CONTEXT._replace(active_workspace_id="tenant-other") if case == "tenant" else CONTEXT
    with pytest.raises((ValueError, WorkflowNotFoundError)):
        service.publish(context, "pipeline-1")
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(Workflow.id).where(Workflow.version != "draft"))) == []
        assert required(session, Pipeline, "pipeline-1").workflow_id == "draft-1"
    assert indexes.dispatched == []


def test_graph_without_index_node_publishes_without_dataset(
    publication: Publication, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, models, indexes = publication
    with sqlite_session_factory.begin() as session:
        session.delete(required(session, Dataset, "dataset-1"))
        required(session, Workflow, "draft-1").graph = '{"nodes": []}'
    assert service.publish(CONTEXT, "pipeline-1").version != "draft"
    assert models.prepared == []
    assert indexes.dispatched == []


def test_invalid_llm_environment_reference_is_rejected(
    publication: Publication, sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, _, indexes = publication
    with sqlite_session_factory.begin() as session:
        required(session, Workflow, "draft-1").graph = json.dumps(
            {
                "nodes": [
                    {
                        "id": "llm",
                        "data": {
                            "type": "llm",
                            "model": {"provider": "openai", "name": "gpt", "mode": "chat"},
                            "model_source": "environment-variable",
                            "model_selector": ["env", "missing"],
                        },
                    }
                ]
            }
        )
    with pytest.raises(ValueError):
        service.publish(CONTEXT, "pipeline-1")
    assert indexes.dispatched == []


def test_publish_copies_ciphertext_after_external_validation(
    publication: Publication, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    from uuid import uuid4

    service, models, _ = publication
    variable_id = str(uuid4())
    stored = json.dumps(
        {
            variable_id: {
                "id": variable_id,
                "name": "token",
                "value_type": "secret",
                "value": "ciphertext",
            }
        }
    )
    with sqlite_session_factory.begin() as session:
        required(session, Workflow, "draft-1")._environment_variables = stored
    decrypted: list[str] = []

    def decrypt(tenant_id: str, token: str) -> str:
        models.boundary()
        assert tenant_id == CONTEXT.active_workspace_id
        decrypted.append(token)
        return "secret"

    def encrypt(*_args: object, **_kwargs: object) -> str:
        pytest.fail("Publishing must copy stored variables without encrypting inside the transaction")

    monkeypatch.setattr("core.helper.encrypter.decrypt_token", decrypt)
    monkeypatch.setattr("core.helper.encrypter.encrypt_token", encrypt)
    result = service.publish(CONTEXT, "pipeline-1")
    assert result.environment_variables == stored
    assert decrypted == ["ciphertext"]


@pytest.mark.parametrize("allow_missing", [False, True])
@pytest.mark.parametrize("failure", ["credentials", "model"])
def test_model_gateway_maps_provider_failures(
    monkeypatch: pytest.MonkeyPatch, allow_missing: bool, failure: str
) -> None:
    from typing import NoReturn

    from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
    from core.model_manager import ModelManager
    from services.errors.rag_pipeline import RagPipelinePublicationError

    class UnavailableModels:
        def get_model_instance(self, **_kwargs: object) -> NoReturn:
            if failure == "credentials":
                raise ProviderTokenNotInitError("Credentials missing")
            raise LLMBadRequestError("Model unavailable")

    monkeypatch.setattr(ModelManager, "for_tenant", lambda **_kwargs: UnavailableModels())
    gateway = PipelinePublicationModelGateway()
    if allow_missing and failure == "credentials":
        assert gateway.embedding("tenant-1", "openai", "embedding", allow_missing=allow_missing) is None
    else:
        with pytest.raises(RagPipelinePublicationError):
            gateway.embedding("tenant-1", "openai", "embedding", allow_missing=allow_missing)
