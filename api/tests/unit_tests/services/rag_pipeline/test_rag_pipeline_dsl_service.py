"""SQLite-backed tests for the RAG pipeline DSL service."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest
import yaml
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session

from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from graphon.enums import BuiltinNodeTypes
from models.base import TypeBase
from models.dataset import (
    Dataset,
    DatasetCollectionBinding,
    Pipeline,
    PipelineBuiltInTemplate,
    PipelineCustomizedTemplate,
)
from models.enums import DataSourceType
from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.dsl_version import check_version_compatibility
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, RagPipelineDatasetCreateEntity
from services.rag_pipeline import rag_pipeline_dsl_service as module
from services.rag_pipeline.rag_pipeline_dsl_service import (
    ImportMode,
    ImportStatus,
    RagPipelineDslService,
    RagPipelinePendingData,
)


@pytest.fixture
def orm_session(sqlite_engine: Engine) -> Iterator[Session]:
    models = (
        Pipeline,
        Workflow,
        Dataset,
        DatasetCollectionBinding,
        PipelineBuiltInTemplate,
        PipelineCustomizedTemplate,
    )
    TypeBase.metadata.create_all(sqlite_engine, tables=[model.__table__ for model in models])
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield session


@pytest.fixture
def service(orm_session: Session) -> RagPipelineDslService:
    return RagPipelineDslService(session=orm_session)


def _account(*, tenant_id: str = "tenant-1") -> SimpleNamespace:
    return SimpleNamespace(id="account-1", current_tenant_id=tenant_id)


def _pipeline(
    session: Session,
    *,
    tenant_id: str = "tenant-1",
    name: str = "Pipeline",
    published: bool = False,
) -> Pipeline:
    pipeline = Pipeline(
        tenant_id=tenant_id,
        name=name,
        description="description",
        is_published=published,
        created_by="account-1",
        updated_by="account-1",
    )
    session.add(pipeline)
    session.commit()
    return pipeline


def _workflow(session: Session, pipeline: Pipeline, *, graph: dict | None = None) -> Workflow:
    workflow = Workflow(
        id=f"workflow-{pipeline.id}",
        tenant_id=pipeline.tenant_id,
        app_id=pipeline.id,
        type=WorkflowType.RAG_PIPELINE,
        kind=WorkflowKind.STANDARD,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(graph or {"nodes": [], "edges": []}),
        features="{}",
        created_by="account-1",
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    pipeline.workflow_id = workflow.id
    session.add(workflow)
    session.commit()
    return workflow


def _dataset(session: Session, pipeline: Pipeline, *, name: str = "Dataset") -> Dataset:
    dataset = Dataset(
        tenant_id=pipeline.tenant_id,
        name=name,
        description="description",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique="high_quality",
        created_by="account-1",
        maintainer="account-1",
        chunk_structure="text_model",
        pipeline_id=pipeline.id,
        icon_info={"icon": "📙", "icon_type": "emoji"},
    )
    session.add(dataset)
    session.commit()
    return dataset


def _knowledge_configuration() -> SimpleNamespace:
    return SimpleNamespace(
        indexing_technique="high_quality",
        embedding_model="text-embedding",
        embedding_model_provider="openai",
        chunk_structure="text_model",
        retrieval_model=SimpleNamespace(model_dump=lambda: {}),
        summary_index_setting=None,
        keyword_number=10,
    )


def _valid_dsl(*, version: str = "0.1.0", name: str = "Imported") -> str:
    return f"""
version: {version}
kind: rag_pipeline
rag_pipeline:
  name: {name}
  description: description
workflow:
  graph:
    nodes:
      - id: knowledge-index
        data:
          type: {KNOWLEDGE_INDEX_NODE_TYPE}
    edges: []
"""


@contextmanager
def _raise_on_workflow_insert(engine: Engine) -> Iterator[None]:
    def raise_error(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("INSERT") and "workflows" in statement:
            raise RuntimeError("forced workflow INSERT")

    event.listen(engine, "before_cursor_execute", raise_error)
    try:
        yield
    finally:
        event.remove(engine, "before_cursor_execute", raise_error)


@pytest.mark.parametrize(
    ("version", "expected"),
    [
        ("invalid", ImportStatus.FAILED),
        ("1.0.0", ImportStatus.PENDING),
        ("0.0.9", ImportStatus.COMPLETED_WITH_WARNINGS),
        ("0.1.0", ImportStatus.COMPLETED),
    ],
)
def test_version_compatibility(version: str, expected: ImportStatus) -> None:
    assert check_version_compatibility(version, module.CURRENT_DSL_VERSION) == expected


def test_dataset_id_encryption_roundtrip_and_invalid(service: RagPipelineDslService) -> None:
    encrypted = service.encrypt_dataset_id("dataset-1", "tenant-1")
    assert service.decrypt_dataset_id(encrypted, "tenant-1") == "dataset-1"
    assert service.decrypt_dataset_id("not-base64", "tenant-1") is None


def test_dependency_helpers_keep_plugin_analysis_external(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService
) -> None:
    assert service.get_leaked_dependencies("tenant-1", []) == []
    dependency = MagicMock()
    leaked = [MagicMock()]
    analyze = Mock(return_value=leaked)
    monkeypatch.setattr(module.DependenciesAnalysisService, "get_leaked_dependencies", analyze)
    assert service.get_leaked_dependencies("tenant-1", [dependency]) == leaked
    assert service._extract_dependencies_from_model_config({}) == []
    assert service._extract_dependencies_from_workflow_graph({}) == []


def test_check_dependencies_reads_redis_for_persisted_pipeline(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService, orm_session: Session
) -> None:
    from core.plugin.entities.plugin import PluginDependency, PluginDependencyType
    from services.rag_pipeline.rag_pipeline_dsl_service import CheckDependenciesPendingData

    pipeline = _pipeline(orm_session)
    monkeypatch.setattr(module.redis_client, "get", Mock(return_value=None))
    assert service.check_dependencies(pipeline=pipeline).leaked_dependencies == []
    dependency = PluginDependency(
        type=PluginDependencyType.Marketplace,
        value=PluginDependency.Marketplace(marketplace_plugin_unique_identifier="test/plugin:0.1.0"),
    )
    pending = CheckDependenciesPendingData(dependencies=[dependency], pipeline_id=pipeline.id)
    monkeypatch.setattr(module.redis_client, "get", Mock(return_value=pending.model_dump_json()))
    monkeypatch.setattr(module.DependenciesAnalysisService, "get_leaked_dependencies", Mock(return_value=[dependency]))
    assert service.check_dependencies(pipeline=pipeline).leaked_dependencies == [dependency]


@pytest.mark.parametrize(
    ("kwargs", "error"),
    [
        ({"import_mode": ImportMode.YAML_URL.value}, "yaml_url is required"),
        ({"import_mode": ImportMode.YAML_CONTENT.value}, "yaml_content is required"),
        (
            {"import_mode": ImportMode.YAML_CONTENT.value, "yaml_content": "- item"},
            "content must be a mapping",
        ),
        (
            {"import_mode": ImportMode.YAML_CONTENT.value, "yaml_content": "version: 1\nkind: rag_pipeline"},
            "Invalid version type",
        ),
        (
            {"import_mode": ImportMode.YAML_CONTENT.value, "yaml_content": "version: 0.1.0\nkind: rag_pipeline"},
            "Missing rag_pipeline data",
        ),
    ],
)
def test_import_validation_errors(service: RagPipelineDslService, kwargs: dict[str, str], error: str) -> None:
    result = service.import_rag_pipeline(account=_account(), **kwargs)
    assert result.status == ImportStatus.FAILED
    assert error in result.error


def test_import_rejects_invalid_mode(service: RagPipelineDslService) -> None:
    with pytest.raises(ValueError, match="Invalid import_mode"):
        service.import_rag_pipeline(account=_account(), import_mode="invalid")


def test_import_url_boundary_failure(monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService) -> None:
    monkeypatch.setattr(module.remote_fetcher, "make_request", Mock(side_effect=RuntimeError("network down")))
    result = service.import_rag_pipeline(
        account=_account(), import_mode=ImportMode.YAML_URL.value, yaml_url="https://example.com/pipeline.yml"
    )
    assert result.status == ImportStatus.FAILED
    assert "network down" in result.error


def test_import_pending_version_stores_redis(monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService) -> None:
    setex = Mock()
    monkeypatch.setattr(module.redis_client, "setex", setex)
    result = service.import_rag_pipeline(
        account=_account(), import_mode=ImportMode.YAML_CONTENT.value, yaml_content=_valid_dsl(version="1.0.0")
    )
    assert result.status == ImportStatus.PENDING
    setex.assert_called_once()


def test_import_creates_real_pipeline_dataset_binding_and_workflow_without_commit(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService, orm_session: Session
) -> None:
    monkeypatch.setattr(module.KnowledgeConfiguration, "model_validate", Mock(return_value=_knowledge_configuration()))
    result = service.import_rag_pipeline(
        account=_account(), import_mode=ImportMode.YAML_CONTENT.value, yaml_content=_valid_dsl()
    )
    assert result.status == ImportStatus.COMPLETED
    assert orm_session.in_transaction()
    pipeline = orm_session.get(Pipeline, result.pipeline_id)
    dataset = orm_session.get(Dataset, result.dataset_id)
    assert pipeline is not None
    assert dataset is not None
    assert dataset.pipeline_id == pipeline.id
    assert dataset.collection_binding_id is not None
    assert orm_session.scalar(select(Workflow).where(Workflow.app_id == pipeline.id)) is not None
    orm_session.commit()


def test_import_pipeline_id_is_tenant_scoped(service: RagPipelineDslService, orm_session: Session) -> None:
    foreign = _pipeline(orm_session, tenant_id="tenant-2")
    result = service.import_rag_pipeline(
        account=_account(tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=_valid_dsl(),
        pipeline_id=foreign.id,
    )
    assert result.status == ImportStatus.FAILED
    assert result.error == "Pipeline not found"


def test_create_or_update_pipeline_flushes_caller_transaction_and_updates_existing(
    service: RagPipelineDslService, orm_session: Session
) -> None:
    data = {
        "rag_pipeline": {"name": "New", "description": "description"},
        "workflow": {"graph": {"nodes": [], "edges": []}},
    }
    created = service._create_or_update_pipeline(pipeline=None, data=data, account=_account())
    assert created in orm_session
    assert created.workflow_id is not None
    assert orm_session.in_transaction()
    orm_session.commit()

    updated = service._create_or_update_pipeline(
        pipeline=created,
        data={
            "rag_pipeline": {"name": "Updated", "description": "changed"},
            "workflow": {"graph": {"nodes": [{"id": "node"}], "edges": []}},
        },
        account=_account(),
    )
    assert updated.id == created.id
    assert updated.name == "Updated"
    workflow = orm_session.get(Workflow, created.workflow_id)
    assert workflow.graph_dict["nodes"] == [{"id": "node"}]


def test_create_pipeline_flush_failure_is_rolled_back_by_caller(
    service: RagPipelineDslService, orm_session: Session, sqlite_engine: Engine
) -> None:
    with _raise_on_workflow_insert(sqlite_engine), pytest.raises(RuntimeError, match="forced workflow INSERT"):
        service._create_or_update_pipeline(
            pipeline=None,
            data={
                "rag_pipeline": {"name": "Broken"},
                "workflow": {"graph": {"nodes": [], "edges": []}},
            },
            account=_account(),
        )
    orm_session.rollback()
    assert orm_session.scalar(select(Pipeline)) is None
    assert orm_session.scalar(select(Workflow)) is None


def test_confirm_import_updates_tenant_pipeline_and_dataset(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService, orm_session: Session
) -> None:
    pipeline = _pipeline(orm_session)
    dataset = _dataset(orm_session, pipeline)
    _workflow(orm_session, pipeline)
    pending = RagPipelinePendingData(
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=_valid_dsl(name="Confirmed"),
        pipeline_id=pipeline.id,
    )
    monkeypatch.setattr(module.redis_client, "get", Mock(return_value=pending.model_dump_json()))
    delete = Mock()
    monkeypatch.setattr(module.redis_client, "delete", delete)
    monkeypatch.setattr(module.KnowledgeConfiguration, "model_validate", Mock(return_value=_knowledge_configuration()))
    result = service.confirm_import(import_id="import-1", account=_account())
    assert result.status == ImportStatus.COMPLETED
    assert result.pipeline_id == pipeline.id
    assert result.dataset_id == dataset.id
    assert orm_session.get(Pipeline, pipeline.id).name == "Confirmed"
    delete.assert_called_once()


def test_export_reads_real_dataset_and_workflow_and_filters_credentials(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService, orm_session: Session
) -> None:
    pipeline = _pipeline(orm_session)
    with pytest.raises(ValueError, match="Missing dataset"):
        service.export_rag_pipeline_dsl(pipeline)
    _dataset(orm_session, pipeline)
    with pytest.raises(ValueError, match="Missing draft workflow"):
        service.export_rag_pipeline_dsl(pipeline)
    _workflow(
        orm_session,
        pipeline,
        graph={
            "nodes": [
                {
                    "data": {
                        "type": BuiltinNodeTypes.TOOL,
                        "credential_id": "secret",
                        "provider_id": "provider",
                    }
                },
                {
                    "data": {
                        "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                        "dataset_ids": ["dataset-1"],
                    }
                },
            ],
            "edges": [],
        },
    )
    monkeypatch.setattr(module.DependenciesAnalysisService, "generate_dependencies", Mock(return_value=[]))
    exported = yaml.safe_load(service.export_rag_pipeline_dsl(pipeline))
    assert exported["kind"] == "rag_pipeline"
    nodes = exported["workflow"]["graph"]["nodes"]
    assert "credential_id" not in nodes[0]["data"]
    assert service.decrypt_dataset_id(nodes[1]["data"]["dataset_ids"][0], pipeline.tenant_id) == "dataset-1"


def test_create_dataset_name_is_tenant_scoped_and_ignores_template_rows(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService, orm_session: Session
) -> None:
    foreign_pipeline = _pipeline(orm_session, tenant_id="tenant-2")
    _dataset(orm_session, foreign_pipeline, name="Shared")
    template = PipelineCustomizedTemplate(
        tenant_id="tenant-1",
        name="Shared",
        description="template",
        chunk_structure="text_model",
        icon={},
        position=1,
        yaml_content=_valid_dsl(),
        install_count=0,
        language="en-US",
        created_by="account-1",
    )
    orm_session.add(template)
    orm_session.commit()
    imported = Mock(
        id="import-1",
        dataset_id="dataset-1",
        pipeline_id="pipeline-1",
        status=ImportStatus.COMPLETED,
        imported_dsl_version="0.1.0",
        current_dsl_version="0.1.0",
        error="",
    )
    monkeypatch.setattr(service, "import_rag_pipeline", Mock(return_value=imported))
    monkeypatch.setattr(module, "current_user", _account())
    result = service.create_rag_pipeline_dataset(
        "tenant-1",
        RagPipelineDatasetCreateEntity(
            name="Shared",
            description="description",
            yaml_content=_valid_dsl(),
            icon_info=IconInfo(icon="📙"),
            permission="only_me",
        ),
    )
    assert result["dataset_id"] == "dataset-1"

    local_pipeline = _pipeline(orm_session, tenant_id="tenant-1")
    _dataset(orm_session, local_pipeline, name="Local")
    with pytest.raises(ValueError, match="already exists"):
        service.create_rag_pipeline_dataset(
            "tenant-1",
            RagPipelineDatasetCreateEntity(
                name="Local",
                description="description",
                yaml_content=_valid_dsl(),
                icon_info=IconInfo(icon="📙"),
                permission="only_me",
            ),
        )
