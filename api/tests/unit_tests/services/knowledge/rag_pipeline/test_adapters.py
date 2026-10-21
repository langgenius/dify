import json
from collections.abc import Generator, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import cast, override

import pytest
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.apps.pipeline.pipeline_generator import PipelineGenerator
from core.app.apps.pipeline.pipeline_runner import PipelineDocumentStore
from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.docstore.dataset_docstore import SegmentAttachmentWriter
from machinery.context import RequestContext
from models.dataset import Dataset, Pipeline
from models.enums import DatasetRuntimeMode
from models.workflow import Workflow, WorkflowType
from repositories.knowledge.rag_pipeline_repository import (
    SQLAlchemyRagPipelineDatasetProjectionWriter,
    SQLAlchemyRagPipelineRepository,
)
from services.credentials.query import CredentialQuery, DatasourceCredentialListItem
from services.data_source.credential_gateway import ActorDatasourceCredentialResolver
from services.data_source.provider_service import DatasourceProviderService
from services.errors.app import WorkflowHashNotEqualError
from services.file_service import FileService, FileUploadActor, FileUploadResult
from services.knowledge.documents.contracts import DocumentCreationEnvironment, DocumentCreationLimits
from services.knowledge.entities.pipeline_workflows import (
    DatasourceNodeRun,
    PipelineFileUpload,
    PipelineInvocationScope,
    PipelineRun,
    PreparedDatasourceWorkflowNode,
)
from services.knowledge.rag_pipeline import adapters
from services.knowledge.rag_pipeline.adapters import (
    ActorAwarePipelineCredentialGateway,
    SQLAlchemyPipelineWorkflowOperations,
)
from services.knowledge.rag_pipeline.application import (
    PipelineConfigurationError,
    PipelineDatasetNotFoundError,
    PipelineDatasetSettings,
    PipelineWorkflowApplicationService,
)
from services.rag_pipeline.workflow_snapshot import capture_workflow, restore_workflow
from services.workflow_run_agg import WorkflowRunAgg
from tests.unit_tests.model_factories import make_dataset


class RecordingSession:
    def __init__(self) -> None:
        self.commits = 0
        self.rollbacks = 0
        self.closed = False
        self.actor = RecordingActor()

    def get(self, _model: type[object], _object_id: str) -> object:
        return self.actor

    def scalar(self, _statement: object) -> object:
        return RecordingPipeline()

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1

    def close(self) -> None:
        self.closed = True

    def __enter__(self) -> "RecordingSession":
        return self

    def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
        self.close()


class RecordingSessionFactory:
    def __init__(self, fixed_session: RecordingSession | None = None) -> None:
        self.sessions: list[RecordingSession] = []
        self.fixed_session = fixed_session

    def __call__(self) -> RecordingSession:
        session = self.fixed_session or RecordingSession()
        self.sessions.append(session)
        return session


@dataclass
class RecordingActor:
    id: str = "account-1"
    workspace_id: str | None = None

    def set_tenant_id_with_session(self, tenant_id: str, *, session: object) -> None:  # noqa: ARG002
        self.workspace_id = tenant_id


@dataclass
class RecordingPipeline:
    id: str = "pipeline-1"
    tenant_id: str = "workspace-1"


class FakeRagPipelineService:
    def __init__(self, session: object, _session_factory: object) -> None:
        self.session = session

    def get_pipeline(self, tenant_id: str, dataset_id: str) -> object:
        del dataset_id
        return RecordingPipeline(tenant_id=tenant_id)

    @staticmethod
    def datasource_plugin_specs(_workflow: object) -> list[dict[str, object]]:
        return [{"provider_name": "provider-1", "plugin_id": "plugin-1", "node_id": "node-1"}]

    def prepare_datasource_workflow_node(self, **_kwargs: object) -> PreparedDatasourceWorkflowNode:
        return PreparedDatasourceWorkflowNode(
            tenant_id="workspace-1",
            account_id="account-1",
            plugin_id="plugin-1",
            provider_name="provider-1",
            datasource_name="datasource-1",
            variables_map={},
            user_inputs={},
            datasource_type="website_crawl",
            credential_id=None,
        )

    @staticmethod
    def run_prepared_datasource_workflow_node(
        prepared: object,  # noqa: ARG004
        *,
        credentials: Mapping[str, object],  # noqa: ARG004
    ) -> Iterable[Mapping[str, object]]:
        yield {"event": "started"}
        yield {"event": "finished"}


class RecordingPipelineRepository:
    @staticmethod
    def get_actor(session: RecordingSession, *, tenant_id: str, actor_id: str) -> RecordingActor:
        session.actor.id = actor_id
        session.actor.set_tenant_id_with_session(tenant_id, session=session)
        return session.actor

    @staticmethod
    def get_pipeline_for_dataset(_session: object, *, tenant_id: str, dataset_id: str) -> RecordingPipeline:
        del dataset_id
        return RecordingPipeline(tenant_id=tenant_id)

    @staticmethod
    def get_pipeline(_session: object, *, tenant_id: str, pipeline_id: str) -> RecordingPipeline:
        return RecordingPipeline(id=pipeline_id, tenant_id=tenant_id)

    @staticmethod
    def get_pipeline_dataset_id(_session: object, *, tenant_id: str, pipeline_id: str) -> str:
        del tenant_id, pipeline_id
        return "dataset-1"


class FakePipelineRunPreparer:
    response: Mapping[str, object] | Iterable[str] = {"batch": "batch-1"}
    invoke_from: InvokeFrom | None = None
    workflow_invoke_from: InvokeFrom | None = None

    def __init__(self, **_kwargs: object) -> None:
        pass

    @classmethod
    def get_workflow(cls, _pipeline: object, invoke_from: InvokeFrom, _session: object) -> "RecordingWorkflow":
        cls.workflow_invoke_from = invoke_from
        return RecordingWorkflow()

    @staticmethod
    def snapshot_workflow(workflow: "RecordingWorkflow") -> "RecordingWorkflow":
        return workflow

    @staticmethod
    def expand_datasource_info_list(**_kwargs: object) -> list[Mapping[str, object]]:
        return []

    @classmethod
    def prepare(cls, **kwargs: object) -> Mapping[str, object] | Iterable[str]:
        cls.invoke_from = cast("InvokeFrom", kwargs["invoke_from"])
        return cls.response

    @staticmethod
    def execute(prepared: Mapping[str, object] | Iterable[str]) -> Mapping[str, object] | Iterable[str]:
        return prepared


@dataclass
class RecordingWorkflow:
    id: str = "workflow-1"
    graph_dict: Mapping[str, object] = field(default_factory=dict)


@dataclass
class RecordingFiles:
    upload: tuple[FileUploadActor, str, str, bytes, str, int] | None = None

    def upload_file_for_actor(
        self,
        *,
        actor: FileUploadActor,
        resource_tenant_id: str,
        filename: str,
        content: bytes,
        mimetype: str,
        default_file_size_limit: int,
    ) -> FileUploadResult:
        self.upload = (actor, resource_tenant_id, filename, content, mimetype, default_file_size_limit)
        return FileUploadResult(
            id="file-1",
            name=filename,
            size=len(content),
            extension="txt",
            mime_type=mimetype,
            created_by="account-1",
            created_at=datetime.now(UTC),
            tenant_id=resource_tenant_id,
            source_url="",
        )


class RecordingDatasetSettingsWriter:
    def stage_rag_pipeline_dataset_settings(self, session: Session, *, change: object) -> bool:
        del session, change
        return True


@dataclass(frozen=True, slots=True)
class RecordingImportResult:
    values: Mapping[str, object]

    def model_dump(self) -> dict[str, object]:
        return dict(self.values)


@dataclass(slots=True)
class RecordingDslService:
    session: object
    calls: list[dict[str, object]] = field(default_factory=list)

    def import_rag_pipeline(self, **kwargs: object) -> RecordingImportResult:
        self.calls.append(dict(kwargs))
        return RecordingImportResult(
            {
                "id": "import-1",
                "status": "completed",
                "pipeline_id": "pipeline-1",
                "dataset_id": "dataset-1",
            }
        )


def _creation_environment() -> DocumentCreationEnvironment:
    return DocumentCreationEnvironment(
        limits=DocumentCreationLimits(
            enabled=False,
            sandbox=False,
            batch_upload_limit=10,
            upload_quota_limit=0,
            upload_quota_size=0,
        ),
        priority_indexing=True,
        initial_permission="only_me",
    )


def _context() -> RequestContext:
    return RequestContext("request-1", None, "account-1", "workspace-1")


def _scope() -> PipelineInvocationScope:
    return PipelineInvocationScope(workspace_id="workspace-1", actor_id="account-1", dataset_id="dataset-1")


def _pipeline_scope() -> PipelineInvocationScope:
    return PipelineInvocationScope(workspace_id="workspace-1", actor_id="account-1", pipeline_id="pipeline-1")


def _operations(
    sessions: RecordingSessionFactory,
    files: RecordingFiles | None = None,
) -> SQLAlchemyPipelineWorkflowOperations:
    return SQLAlchemyPipelineWorkflowOperations(
        session_factory=cast("sessionmaker[Session]", sessions),
        generator=cast("PipelineGenerator", object()),
        files=cast("FileService", files or RecordingFiles()),
        file_size_limit=lambda _workspace_id: 15,
        document_creation_environment=lambda _workspace_id: _creation_environment(),
        dataset_settings_writer=RecordingDatasetSettingsWriter(),
        pipelines=cast("SQLAlchemyRagPipelineRepository", RecordingPipelineRepository()),
    )


def test_plugin_specs_are_detached_before_read_session_closes(monkeypatch: pytest.MonkeyPatch) -> None:
    session = RecordingSession()
    sessions = RecordingSessionFactory(fixed_session=session)
    monkeypatch.setattr(adapters, "RagPipelineService", FakeRagPipelineService)
    monkeypatch.setattr(adapters, "SQLAlchemyPipelineRunPreparer", FakePipelineRunPreparer)
    operations = _operations(sessions)

    result = operations.list_datasource_plugin_specs(_scope(), is_published=True)

    assert result == [{"provider_name": "provider-1", "plugin_id": "plugin-1", "node_id": "node-1"}]
    assert session.closed is True


def test_yaml_import_uses_request_identity_without_a_preexisting_resource_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = RecordingSession()
    sessions = RecordingSessionFactory(fixed_session=session)
    dsl_service = RecordingDslService(session)
    monkeypatch.setattr(adapters, "RagPipelineDslService", lambda actual_session: _same(dsl_service, actual_session))
    operations = _operations(sessions)

    result = operations.import_dataset(_context(), yaml_content="kind: rag-pipeline")

    assert result == {
        "id": "import-1",
        "status": "completed",
        "pipeline_id": "pipeline-1",
        "dataset_id": "dataset-1",
    }
    assert session.actor.workspace_id == "workspace-1"
    assert session.closed is True
    assert len(dsl_service.calls) == 1
    call = dsl_service.calls[0]
    assert call["account"] is session.actor
    assert call["import_mode"] == adapters.ImportMode.YAML_CONTENT
    assert call["yaml_content"] == "kind: rag-pipeline"


def _same(service: RecordingDslService, actual_session: object) -> RecordingDslService:
    assert actual_session is service.session
    return service


def test_pipeline_dataset_lookup_is_tenant_scoped(sqlite_engine: Engine) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        session.add(make_dataset(tenant_id="workspace-1", pipeline_id="pipeline-1"))
    operations = SQLAlchemyPipelineWorkflowOperations(
        session_factory=sessions,
        generator=cast("PipelineGenerator", object()),
        files=cast("FileService", RecordingFiles()),
        file_size_limit=lambda _workspace_id: 15,
        document_creation_environment=lambda _workspace_id: _creation_environment(),
        dataset_settings_writer=RecordingDatasetSettingsWriter(),
    )

    assert operations.get_pipeline_dataset_id(_pipeline_scope()) == "dataset-1"
    with pytest.raises(PipelineDatasetNotFoundError):
        operations.get_pipeline_dataset_id(
            PipelineInvocationScope(workspace_id="other-workspace", actor_id="account-1", pipeline_id="pipeline-1")
        )


def _add_publication_rows(session: Session) -> None:
    pipeline = Pipeline(tenant_id="workspace-1", name="Pipeline", description="", created_by="account-1")
    pipeline.id = "pipeline-1"
    workflow = Workflow(
        id="workflow-1",
        tenant_id="workspace-1",
        app_id="pipeline-1",
        type=WorkflowType.RAG_PIPELINE,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by="account-1",
    )
    session.add_all((pipeline, make_dataset(tenant_id="workspace-1", pipeline_id="pipeline-1"), workflow))


def _dataset_projection_graph(*, embedding_model: str) -> str:
    return json.dumps(
        {
            "nodes": [
                {
                    "id": "knowledge-1",
                    "data": {
                        "type": "knowledge-index",
                        "embedding_model": embedding_model,
                        "embedding_model_provider": "provider-old",
                        "retrieval_model": {"search_method": "keyword_search"},
                        "chunk_structure": "paragraph",
                        "indexing_technique": "economy",
                        "keyword_number": 3,
                        "summary_index_setting": {"enable": False},
                    },
                },
                {"id": "start-1", "data": {"type": "start", "embedding_model": "untouched"}},
            ],
            "edges": [],
        }
    )


def _add_dataset_projection_rows(session: Session) -> None:
    pipeline = Pipeline(
        tenant_id="workspace-1",
        name="Pipeline",
        description="",
        workflow_id="published-old",
        is_published=True,
        created_by="account-1",
    )
    pipeline.id = "pipeline-1"
    dataset = make_dataset(
        tenant_id="workspace-1",
        pipeline_id="pipeline-1",
        indexing_technique="high_quality",
        embedding_model="embedding-new",
        embedding_model_provider="provider-new",
        keyword_number=8,
        chunk_structure="parent_child_index",
    )
    dataset.runtime_mode = DatasetRuntimeMode.RAG_PIPELINE
    dataset.retrieval_model = {"search_method": "semantic_search"}
    dataset.summary_index_setting = {"enable": True}
    workflows = (
        Workflow(
            id="draft-1",
            tenant_id="workspace-1",
            app_id="pipeline-1",
            type=WorkflowType.RAG_PIPELINE,
            version=Workflow.VERSION_DRAFT,
            graph=_dataset_projection_graph(embedding_model="embedding-old"),
            features='{"draft": true}',
            created_by="account-1",
        ),
        Workflow(
            id="published-old",
            tenant_id="workspace-1",
            app_id="pipeline-1",
            type=WorkflowType.RAG_PIPELINE,
            version="published-v1",
            graph=_dataset_projection_graph(embedding_model="embedding-old"),
            features='{"published": true}',
            created_by="account-1",
        ),
    )
    session.add_all((pipeline, dataset, *workflows))


def _knowledge_node(workflow: Workflow) -> Mapping[str, object]:
    return cast(
        "Mapping[str, object]",
        next(node["data"] for node in workflow.graph_dict["nodes"] if node["data"]["type"] == "knowledge-index"),
    )


def test_dataset_settings_projection_preserves_old_version_and_commits_draft_and_pointer(
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        _add_dataset_projection_rows(session)

    writer = SQLAlchemyRagPipelineDatasetProjectionWriter()
    with sessions.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        writer.stage_dataset_settings(session, dataset=dataset, actor_id="account-2")

    with sessions() as session:
        pipeline = session.get(Pipeline, "pipeline-1")
        draft = session.get(Workflow, "draft-1")
        old_published = session.get(Workflow, "published-old")
        assert pipeline is not None
        assert draft is not None
        assert old_published is not None
        assert pipeline.workflow_id not in {None, "published-old"}
        new_published = session.get(Workflow, pipeline.workflow_id)
        assert new_published is not None
        assert session.scalars(select(Workflow).where(Workflow.app_id == "pipeline-1")).all() == [
            draft,
            old_published,
            new_published,
        ]

        assert _knowledge_node(old_published)["embedding_model"] == "embedding-old"
        for workflow in (draft, new_published):
            node = _knowledge_node(workflow)
            assert node["embedding_model"] == "embedding-new"
            assert node["embedding_model_provider"] == "provider-new"
            assert node["retrieval_model"] == {"search_method": "semantic_search"}
            assert node["chunk_structure"] == "parent_child_index"
            assert node["indexing_technique"] == "high_quality"
            assert node["keyword_number"] == 8
            assert node["summary_index_setting"] == {"enable": True}
        assert draft.updated_by == "account-2"
        assert new_published.created_by == "account-2"


def test_dataset_settings_projection_rolls_back_graph_and_pointer_with_transaction_failure(
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        _add_dataset_projection_rows(session)

    writer = SQLAlchemyRagPipelineDatasetProjectionWriter()

    def stage_then_abort() -> None:
        with sessions.begin() as session:
            dataset = session.get(Dataset, "dataset-1")
            assert dataset is not None
            writer.stage_dataset_settings(session, dataset=dataset, actor_id="account-2")
            raise RuntimeError("abort dataset update")

    with pytest.raises(RuntimeError, match="abort dataset update"):
        stage_then_abort()

    with sessions() as session:
        pipeline = session.get(Pipeline, "pipeline-1")
        draft = session.get(Workflow, "draft-1")
        old_published = session.get(Workflow, "published-old")
        assert pipeline is not None
        assert draft is not None
        assert old_published is not None
        assert pipeline.workflow_id == "published-old"
        assert len(session.scalars(select(Workflow).where(Workflow.app_id == "pipeline-1")).all()) == 2
        assert _knowledge_node(draft)["embedding_model"] == "embedding-old"
        assert _knowledge_node(old_published)["embedding_model"] == "embedding-old"


def test_workflow_publication_rejects_a_changed_draft_snapshot(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        _add_publication_rows(session)
    monkeypatch.setattr(
        SQLAlchemyPipelineWorkflowOperations,
        "_actor",
        staticmethod(lambda _session, _scope: RecordingActor()),
    )
    operations = SQLAlchemyPipelineWorkflowOperations(
        session_factory=sessions,
        generator=cast("PipelineGenerator", object()),
        files=cast("FileService", RecordingFiles()),
        file_size_limit=lambda _workspace_id: 15,
        document_creation_environment=lambda _workspace_id: _creation_environment(),
        dataset_settings_writer=RecordingDatasetSettingsWriter(),
    )
    prepared = operations.prepare_workflow_publication(_pipeline_scope())
    with sessions.begin() as session:
        workflow = session.get(Workflow, "workflow-1")
        assert workflow is not None
        workflow.graph = json.dumps({"nodes": [], "edges": [], "revision": "changed"})

    with pytest.raises(WorkflowHashNotEqualError):
        operations.commit_workflow_publication(prepared, dataset_change=None)


def test_workflow_publication_commits_pipeline_and_workflow_together(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        _add_publication_rows(session)
    monkeypatch.setattr(
        SQLAlchemyPipelineWorkflowOperations,
        "_actor",
        staticmethod(lambda _session, _scope: RecordingActor()),
    )
    operations = SQLAlchemyPipelineWorkflowOperations(
        session_factory=sessions,
        generator=cast("PipelineGenerator", object()),
        files=cast("FileService", RecordingFiles()),
        file_size_limit=lambda _workspace_id: 15,
        document_creation_environment=lambda _workspace_id: _creation_environment(),
        dataset_settings_writer=RecordingDatasetSettingsWriter(),
    )

    prepared = operations.prepare_workflow_publication(_pipeline_scope())
    created_at = operations.commit_workflow_publication(prepared, dataset_change=None)

    with sessions() as session:
        pipeline = session.get(Pipeline, "pipeline-1")
        assert pipeline is not None
        assert pipeline.is_published is True
        assert pipeline.workflow_id is not None
        published = session.get(Workflow, pipeline.workflow_id)
        assert published is not None
        assert published.created_at == created_at


def test_datasource_stream_closes_session_before_events_are_consumed(monkeypatch: pytest.MonkeyPatch) -> None:
    sessions = RecordingSessionFactory()
    monkeypatch.setattr(adapters, "RagPipelineService", FakeRagPipelineService)
    monkeypatch.setattr(adapters, "SQLAlchemyPipelineRunPreparer", FakePipelineRunPreparer)
    operations = _operations(sessions)

    prepared = operations.prepare_datasource_node(
        _scope(),
        node_id="node-1",
        command=DatasourceNodeRun(
            inputs={},
            datasource_type="website_crawl",
            is_published=True,
        ),
    )

    session = sessions.sessions[0]
    assert session.closed is True
    result = operations.run_prepared_datasource_node(prepared, credentials={"token": "visible-secret"})
    events = list(result)
    assert len(events) == 2
    assert all(event.startswith("data:") for event in events)
    assert session.commits == 1
    assert FakePipelineRunPreparer.workflow_invoke_from == InvokeFrom.PUBLISHED_PIPELINE


def test_datasource_preview_releases_database_connection_before_provider_io(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        pipeline = Pipeline(tenant_id="workspace-1", name="Pipeline", description="")
        pipeline.id = "pipeline-1"
        session.add_all((pipeline, make_dataset(tenant_id="workspace-1", pipeline_id="pipeline-1")))

    class PreviewPoolAwareRagPipelineService(FakeRagPipelineService):
        @staticmethod
        def preview_prepared_datasource_workflow_node(
            _prepared: PreparedDatasourceWorkflowNode,
            *,
            credentials: Mapping[str, object],
        ) -> Mapping[str, object]:
            assert credentials == {}
            assert pool.checkedout() == 0
            return {"content": "preview"}

    monkeypatch.setattr(adapters, "RagPipelineService", PreviewPoolAwareRagPipelineService)
    monkeypatch.setattr(adapters, "SQLAlchemyPipelineRunPreparer", FakePipelineRunPreparer)
    monkeypatch.setattr(
        SQLAlchemyPipelineWorkflowOperations,
        "_actor",
        staticmethod(lambda _session, _context: RecordingActor()),
    )
    operations = SQLAlchemyPipelineWorkflowOperations(
        session_factory=sessions,
        generator=cast("PipelineGenerator", object()),
        files=cast("FileService", RecordingFiles()),
        file_size_limit=lambda _workspace_id: 15,
        document_creation_environment=lambda _workspace_id: _creation_environment(),
        dataset_settings_writer=RecordingDatasetSettingsWriter(),
    )
    command = DatasourceNodeRun(inputs={}, datasource_type="website_crawl", is_published=True)

    prepared = operations.prepare_datasource_node(_pipeline_scope(), node_id="node-1", command=command)
    result = operations.preview_prepared_datasource_node(prepared, credentials={})

    assert result == {"content": "preview"}
    assert pool.checkedout() == 0


@pytest.mark.parametrize(
    ("is_published", "expected_invoke_from"),
    [
        (False, InvokeFrom.DEBUGGER),
        (True, InvokeFrom.PUBLISHED_PIPELINE),
    ],
)
def test_pipeline_maps_publication_mode_at_runtime_boundary(
    monkeypatch: pytest.MonkeyPatch,
    is_published: bool,
    expected_invoke_from: InvokeFrom,
) -> None:
    sessions = RecordingSessionFactory()
    FakePipelineRunPreparer.response = {"batch": "batch-1"}
    FakePipelineRunPreparer.invoke_from = None
    monkeypatch.setattr(adapters, "RagPipelineService", FakeRagPipelineService)
    monkeypatch.setattr(adapters, "SQLAlchemyPipelineRunPreparer", FakePipelineRunPreparer)
    operations = _operations(sessions)

    command = PipelineRun(values={"inputs": {}}, is_published=is_published, streaming=False)
    prepared = operations.prepare_pipeline(_scope(), command=command)
    result = operations.run_prepared_pipeline(
        prepared,
        command=command,
    )

    assert result == {"batch": "batch-1"}
    assert FakePipelineRunPreparer.invoke_from == expected_invoke_from


def test_blocking_pipeline_executes_after_preparation_connection_is_released(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        pipeline = Pipeline(tenant_id="workspace-1", name="Pipeline", description="")
        pipeline.id = "pipeline-1"
        session.add_all((pipeline, make_dataset(tenant_id="workspace-1", pipeline_id="pipeline-1")))

    class PoolAwareGenerateService:
        def __init__(self, **_kwargs: object) -> None:
            pass

        @staticmethod
        def get_workflow(_pipeline: object, _invoke_from: InvokeFrom, _session: object) -> RecordingWorkflow:
            return RecordingWorkflow()

        @staticmethod
        def snapshot_workflow(workflow: RecordingWorkflow) -> RecordingWorkflow:
            return workflow

        @staticmethod
        def expand_datasource_info_list(**_kwargs: object) -> list[Mapping[str, object]]:
            assert pool.checkedout() == 0
            return []

        @staticmethod
        def prepare(**kwargs: object) -> object:
            session = cast("Session", kwargs["session"])
            assert session.scalar(select(1)) == 1
            assert pool.checkedout() == 1
            return object()

        @staticmethod
        def execute(_prepared: object) -> Mapping[str, object]:
            assert pool.checkedout() == 0
            with Session(sqlite_engine) as concurrent_session:
                assert concurrent_session.scalar(select(1)) == 1
            return {"batch": "batch-1"}

    monkeypatch.setattr(adapters, "RagPipelineService", FakeRagPipelineService)
    monkeypatch.setattr(adapters, "SQLAlchemyPipelineRunPreparer", PoolAwareGenerateService)
    monkeypatch.setattr(
        SQLAlchemyPipelineWorkflowOperations,
        "_actor",
        staticmethod(lambda _session, _context: RecordingActor()),
    )
    operations = SQLAlchemyPipelineWorkflowOperations(
        session_factory=sessions,
        generator=cast("PipelineGenerator", object()),
        files=cast("FileService", RecordingFiles()),
        file_size_limit=lambda _workspace_id: 15,
        document_creation_environment=lambda _workspace_id: _creation_environment(),
        dataset_settings_writer=RecordingDatasetSettingsWriter(),
    )

    command = PipelineRun(values={"inputs": {}}, is_published=False, streaming=False)
    prepared = operations.prepare_pipeline(_scope(), command=command)
    result = operations.run_prepared_pipeline(
        prepared,
        command=command,
    )

    assert result == {"batch": "batch-1"}
    assert pool.checkedout() == 0


def test_published_pipeline_loads_creation_environment_without_holding_a_connection(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        pipeline = Pipeline(tenant_id="workspace-1", name="Pipeline", description="")
        pipeline.id = "pipeline-1"
        session.add_all((pipeline, make_dataset(tenant_id="workspace-1", pipeline_id="pipeline-1")))
    environment = _creation_environment()
    environment_calls: list[str] = []

    def load_environment(workspace_id: str) -> DocumentCreationEnvironment:
        assert pool.checkedout() == 0
        environment_calls.append(workspace_id)
        return environment

    class BillingAwareGenerateService(FakePipelineRunPreparer):
        @classmethod
        @override
        def prepare(cls, **kwargs: object) -> Mapping[str, object]:
            assert pool.checkedout() == 1
            assert kwargs["document_creation_environment"] is environment
            return {"batch": "batch-1"}

    monkeypatch.setattr(adapters, "RagPipelineService", FakeRagPipelineService)
    monkeypatch.setattr(adapters, "SQLAlchemyPipelineRunPreparer", BillingAwareGenerateService)
    monkeypatch.setattr(
        SQLAlchemyPipelineWorkflowOperations,
        "_actor",
        staticmethod(lambda _session, _context: RecordingActor()),
    )
    operations = SQLAlchemyPipelineWorkflowOperations(
        session_factory=sessions,
        generator=cast("PipelineGenerator", object()),
        files=cast("FileService", RecordingFiles()),
        file_size_limit=lambda _workspace_id: 15,
        document_creation_environment=load_environment,
        dataset_settings_writer=RecordingDatasetSettingsWriter(),
    )
    command = PipelineRun(
        values={
            "inputs": {},
            "datasource_type": "local_file",
            "datasource_info_list": [],
            "start_node_id": "node-1",
        },
        is_published=True,
        streaming=False,
    )

    prepared = operations.prepare_pipeline(_scope(), command=command)
    result = operations.run_prepared_pipeline(prepared, command=command)

    assert result == {"batch": "batch-1"}
    assert environment_calls == ["workspace-1"]
    assert pool.checkedout() == 0


def test_draft_workflow_snapshot_survives_concurrent_mutation(
    monkeypatch: pytest.MonkeyPatch, sqlite_engine: Engine
) -> None:
    pool = sqlite_engine.pool
    assert isinstance(pool, QueuePool)
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    old_graph: dict[str, object] = {"revision": "old", "nodes": [], "edges": []}
    new_graph: dict[str, object] = {"revision": "new", "nodes": [], "edges": []}
    with sessions.begin() as session:
        pipeline = Pipeline(tenant_id="workspace-1", name="Pipeline", description="")
        pipeline.id = "pipeline-1"
        workflow = Workflow(
            id="workflow-1",
            tenant_id="workspace-1",
            app_id="pipeline-1",
            type=WorkflowType.RAG_PIPELINE,
            version=Workflow.VERSION_DRAFT,
            graph=json.dumps(old_graph),
            features="{}",
            created_by="account-1",
        )
        session.add_all((pipeline, workflow))

    observed_graphs: list[Mapping[str, object]] = []

    class SnapshotAwareGenerateService:
        def __init__(self, **_kwargs: object) -> None:
            pass

        @staticmethod
        def get_workflow(pipeline: Pipeline, invoke_from: InvokeFrom, session: Session) -> Workflow:
            assert invoke_from == InvokeFrom.DEBUGGER
            workflow = session.scalar(
                select(Workflow).where(
                    Workflow.tenant_id == pipeline.tenant_id,
                    Workflow.app_id == pipeline.id,
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
            )
            assert workflow is not None
            return workflow

        @staticmethod
        def snapshot_workflow(workflow: Workflow) -> Workflow:
            return restore_workflow(capture_workflow(workflow))

        @staticmethod
        def expand_datasource_info_list(**kwargs: object) -> list[Mapping[str, object]]:
            assert pool.checkedout() == 0
            workflow = cast("Workflow", kwargs["workflow"])
            observed_graphs.append(workflow.graph_dict)
            return []

        @staticmethod
        def prepare(**kwargs: object) -> object:
            assert pool.checkedout() == 1
            workflow = cast("Workflow", kwargs["workflow"])
            observed_graphs.append(workflow.graph_dict)
            return object()

        @staticmethod
        def execute(_prepared: object) -> Mapping[str, object]:
            assert pool.checkedout() == 0
            return {"batch": "batch-1"}

    monkeypatch.setattr(adapters, "SQLAlchemyPipelineRunPreparer", SnapshotAwareGenerateService)
    monkeypatch.setattr(
        SQLAlchemyPipelineWorkflowOperations,
        "_actor",
        staticmethod(lambda _session, _context: RecordingActor()),
    )
    operations = SQLAlchemyPipelineWorkflowOperations(
        session_factory=sessions,
        generator=cast("PipelineGenerator", object()),
        files=cast("FileService", RecordingFiles()),
        file_size_limit=lambda _workspace_id: 15,
        document_creation_environment=lambda _workspace_id: _creation_environment(),
        dataset_settings_writer=RecordingDatasetSettingsWriter(),
    )
    command = PipelineRun(
        values={
            "inputs": {},
            "datasource_type": "local_file",
            "datasource_info_list": [],
            "start_node_id": "node-1",
        },
        is_published=False,
        streaming=False,
    )

    prepared = operations.prepare_pipeline(_pipeline_scope(), command=command)
    with sessions.begin() as session:
        current_workflow = session.get(Workflow, "workflow-1")
        assert current_workflow is not None
        current_workflow.graph = json.dumps(new_graph)

    result = operations.run_prepared_pipeline(prepared, command=command)

    assert result == {"batch": "batch-1"}
    assert observed_graphs == [old_graph, old_graph]
    assert pool.checkedout() == 0


def test_pipeline_stream_closes_session_before_iteration_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def failing_stream() -> Generator[str]:
        yield "first"
        raise RuntimeError("stream failed")

    sessions = RecordingSessionFactory()
    FakePipelineRunPreparer.response = failing_stream()
    monkeypatch.setattr(adapters, "RagPipelineService", FakeRagPipelineService)
    monkeypatch.setattr(adapters, "SQLAlchemyPipelineRunPreparer", FakePipelineRunPreparer)
    operations = _operations(sessions)
    command = PipelineRun(values={"inputs": {}}, is_published=False, streaming=True)
    prepared = operations.prepare_pipeline(_scope(), command=command)
    result = operations.run_prepared_pipeline(
        prepared,
        command=command,
    )

    iterator = iter(result)
    session = sessions.sessions[0]
    assert session.commits == 1
    assert session.closed is True
    assert next(iterator) == "first"
    with pytest.raises(RuntimeError, match="stream failed"):
        next(iterator)
    assert session.rollbacks == 0
    assert FakePipelineRunPreparer.invoke_from == InvokeFrom.DEBUGGER


def test_file_upload_uses_admitted_identity_and_detached_result() -> None:
    sessions = RecordingSessionFactory()
    files = RecordingFiles()
    operations = _operations(sessions, files)

    result = operations.upload_file(
        _context(), upload=PipelineFileUpload(filename="notes.txt", content=b"notes", mimetype="text/plain")
    )

    assert result.id == "file-1"
    assert result.created_by == "account-1"
    assert files.upload is not None
    actor, workspace_id, filename, content, mimetype, size_limit = files.upload
    assert actor.id == "account-1"
    assert (workspace_id, filename, content, mimetype, size_limit) == (
        "workspace-1",
        "notes.txt",
        b"notes",
        "text/plain",
        15,
    )


@dataclass
class RecordingCredentialQuery:
    credentials: tuple[DatasourceCredentialListItem, ...]
    actor_ids: list[str | None] = field(default_factory=list)

    def list_datasources(
        self, *, workspace_id: str, provider: str, plugin_id: str, actor_id: str | None
    ) -> tuple[DatasourceCredentialListItem, ...]:
        del workspace_id, provider, plugin_id
        self.actor_ids.append(actor_id)
        return self.credentials


@dataclass
class RecordingCredentialResolver:
    calls: list[tuple[str, str, str, str, str]] = field(default_factory=list)

    def resolve(
        self,
        *,
        workspace_id: str,
        actor_id: str,
        credential_id: str,
        provider: str,
        plugin_id: str,
    ) -> dict[str, object]:
        self.calls.append((workspace_id, actor_id, credential_id, provider, plugin_id))
        return {"token": "visible-secret"}


@dataclass
class RecordingRuntimeCredentials:
    credentials: Mapping[str, object] | None = field(default_factory=lambda: {"stale": "secret"})


@dataclass
class RecordingDatasourceRuntime:
    runtime: RecordingRuntimeCredentials = field(default_factory=RecordingRuntimeCredentials)


@dataclass
class RecordingTrustedDatasourceProvider:
    calls: list[str | None] = field(default_factory=list)

    def get_datasource_credentials(
        self,
        *,
        tenant_id: str,
        provider: str,
        plugin_id: str,
        credential_id: str | None,
    ) -> Mapping[str, object]:
        del tenant_id, provider, plugin_id
        self.calls.append(credential_id)
        return {"token": "must-not-be-used"}


class UnusedDatasetAccess:
    @staticmethod
    def require_accessible(context: RequestContext, dataset_id: str) -> object:
        del context, dataset_id
        raise AssertionError("pipeline execution does not use the Console preview access port")


def _credential(credential_id: str, *, is_default: bool) -> DatasourceCredentialListItem:
    return DatasourceCredentialListItem(
        id=credential_id,
        name=credential_id,
        auth_type="oauth2",
        encrypted_credentials={},
        avatar_url=None,
        is_default=is_default,
    )


def test_actor_credential_gateway_resolves_only_visible_requested_credential() -> None:
    query = RecordingCredentialQuery((_credential("mine", is_default=True),))
    resolver = RecordingCredentialResolver()
    gateway = ActorAwarePipelineCredentialGateway(
        query=cast("CredentialQuery", query),
        resolver=cast("ActorDatasourceCredentialResolver", resolver),
        requires_credentials=lambda _workspace_id, _provider, _plugin_id, _datasource_type: True,
    )

    with pytest.raises(PipelineConfigurationError, match="not available"):
        gateway.resolve_visible(
            workspace_id="workspace-1",
            actor_id="account-1",
            provider="notion",
            plugin_id="plugin-1",
            datasource_type="online_document",
            credential_id="other-member-private",
        )

    assert query.actor_ids == ["account-1"]
    assert resolver.calls == []


def test_actor_credential_gateway_checks_default_visibility_before_resolving() -> None:
    query = RecordingCredentialQuery((_credential("visible-non-default", is_default=False),))
    resolver = RecordingCredentialResolver()
    gateway = ActorAwarePipelineCredentialGateway(
        query=cast("CredentialQuery", query),
        resolver=cast("ActorDatasourceCredentialResolver", resolver),
        requires_credentials=lambda _workspace_id, _provider, _plugin_id, _datasource_type: True,
    )

    with pytest.raises(PipelineConfigurationError, match="Default datasource credential"):
        gateway.resolve_visible(
            workspace_id="workspace-1",
            actor_id="account-1",
            provider="notion",
            plugin_id="plugin-1",
            datasource_type="online_document",
            credential_id=None,
        )

    assert resolver.calls == []


def test_actor_credential_gateway_resolves_visible_default_with_actor_scope() -> None:
    query = RecordingCredentialQuery((_credential("visible-default", is_default=True),))
    resolver = RecordingCredentialResolver()
    gateway = ActorAwarePipelineCredentialGateway(
        query=cast("CredentialQuery", query),
        resolver=cast("ActorDatasourceCredentialResolver", resolver),
        requires_credentials=lambda _workspace_id, _provider, _plugin_id, _datasource_type: True,
    )

    result = gateway.resolve_visible(
        workspace_id="workspace-1",
        actor_id="account-1",
        provider="notion",
        plugin_id="plugin-1",
        datasource_type="online_document",
        credential_id=None,
    )

    assert result.id == "visible-default"
    assert result.values == {"token": "visible-secret"}
    assert resolver.calls == [("workspace-1", "account-1", "visible-default", "notion", "plugin-1")]


def test_actor_credential_gateway_allows_empty_credentials_when_provider_schema_is_empty() -> None:
    query = RecordingCredentialQuery(())
    resolver = RecordingCredentialResolver()
    requirement_calls: list[tuple[str, str, str, str]] = []

    def requires_credentials(workspace_id: str, provider: str, plugin_id: str, datasource_type: str) -> bool:
        requirement_calls.append((workspace_id, provider, plugin_id, datasource_type))
        return False

    gateway = ActorAwarePipelineCredentialGateway(
        query=cast("CredentialQuery", query),
        resolver=cast("ActorDatasourceCredentialResolver", resolver),
        requires_credentials=requires_credentials,
    )

    result = gateway.resolve_visible(
        workspace_id="workspace-1",
        actor_id="account-1",
        provider="public-drive",
        plugin_id="plugin-1",
        datasource_type="online_drive",
        credential_id="obsolete-stored-credential",
    )

    assert result.id is None
    assert result.values == {}
    assert requirement_calls == [("workspace-1", "public-drive", "plugin-1", "online_drive")]
    assert query.actor_ids == []
    assert resolver.calls == []


@pytest.mark.parametrize("stored_credential_id", [None, "other-member-private"])
def test_full_pipeline_run_preserves_credentialless_authorization_through_formatter(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_engine: Engine,
    stored_credential_id: str | None,
) -> None:
    sessions = sessionmaker(bind=sqlite_engine, expire_on_commit=False)
    with sessions.begin() as session:
        pipeline = Pipeline(tenant_id="workspace-1", name="Pipeline", description="")
        pipeline.id = "pipeline-1"
        session.add_all((pipeline, make_dataset(tenant_id="workspace-1", pipeline_id="pipeline-1")))

    node_data: dict[str, object] = {
        "plugin_id": "plugin-1",
        "provider_name": "public-drive",
        "datasource_name": "files",
    }
    if stored_credential_id is not None:
        node_data["credential_id"] = stored_credential_id
    workflow = RecordingWorkflow(graph_dict={"nodes": [{"id": "node-1", "data": node_data}], "edges": []})

    def datasource_plugin_specs(_workflow: object) -> list[Mapping[str, object]]:
        return [
            {
                **node_data,
                "node_id": "node-1",
                "datasource_type": "online_drive",
            }
        ]

    prepared_kwargs: dict[str, object] = {}

    def prepare_runtime(**kwargs: object) -> Mapping[str, object]:
        prepared_kwargs.update(kwargs)
        return {"batch": "batch-1"}

    monkeypatch.setattr(adapters, "RagPipelineService", FakeRagPipelineService)
    monkeypatch.setattr(FakeRagPipelineService, "datasource_plugin_specs", staticmethod(datasource_plugin_specs))
    monkeypatch.setattr(
        SQLAlchemyPipelineWorkflowOperations,
        "_actor",
        staticmethod(lambda _session, _scope: RecordingActor()),
    )
    monkeypatch.setattr(
        adapters.SQLAlchemyPipelineRunPreparer,
        "get_workflow",
        staticmethod(lambda _pipeline, _invoke_from, _session: workflow),
    )
    monkeypatch.setattr(adapters.SQLAlchemyPipelineRunPreparer, "snapshot_workflow", staticmethod(lambda value: value))
    monkeypatch.setattr(adapters.SQLAlchemyPipelineRunPreparer, "prepare", staticmethod(prepare_runtime))
    monkeypatch.setattr(adapters.SQLAlchemyPipelineRunPreparer, "execute", staticmethod(lambda runtime: runtime))

    runtime = RecordingDatasourceRuntime()
    monkeypatch.setattr(
        "core.datasource.datasource_manager.DatasourceManager.get_datasource_runtime",
        lambda **_kwargs: runtime,
    )
    trusted_provider = RecordingTrustedDatasourceProvider()
    generator = PipelineGenerator(
        documents=cast("PipelineDocumentStore", object()),
        datasource_providers=cast("DatasourceProviderService", trusted_provider),
        attachment_writer=cast("SegmentAttachmentWriter", object()),
        execution_driver=WorkflowRunAgg.run,
    )
    query = RecordingCredentialQuery(())
    resolver = RecordingCredentialResolver()
    gateway = ActorAwarePipelineCredentialGateway(
        query=cast("CredentialQuery", query),
        resolver=cast("ActorDatasourceCredentialResolver", resolver),
        requires_credentials=lambda _workspace_id, _provider, _plugin_id, _datasource_type: False,
    )
    operations = SQLAlchemyPipelineWorkflowOperations(
        session_factory=sessions,
        generator=generator,
        files=cast("FileService", RecordingFiles()),
        file_size_limit=lambda _workspace_id: 15,
        document_creation_environment=lambda _workspace_id: _creation_environment(),
        dataset_settings_writer=RecordingDatasetSettingsWriter(),
    )
    service = PipelineWorkflowApplicationService(
        operations=operations,
        credentials=gateway,
        dataset_access=UnusedDatasetAccess(),
        dataset_settings=cast("PipelineDatasetSettings", object()),
    )

    result = service.run_pipeline(
        _context(),
        dataset_id="dataset-1",
        command=PipelineRun(
            values={
                "inputs": {},
                "datasource_type": "online_drive",
                "datasource_info_list": [{"id": "file-1", "name": "File"}],
                "start_node_id": "node-1",
            },
            is_published=False,
            streaming=False,
        ),
    )

    assert result == {"batch": "batch-1"}
    assert prepared_kwargs["datasource_info_list"] == [
        {"id": "file-1", "name": "File", "bucket": None, "credential_id": None}
    ]
    assert runtime.runtime.credentials == {}
    assert query.actor_ids == []
    assert resolver.calls == []
    assert trusted_provider.calls == []
