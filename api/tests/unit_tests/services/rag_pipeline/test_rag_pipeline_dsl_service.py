"""SQLite-backed tests for the RAG pipeline DSL service.

Database behavior and transaction ownership use the shared SQLite fixtures. Plugin,
Redis, validation, and HTTP boundaries remain isolated so each test can exercise the
service branch that owns the behavior under test.
"""

from __future__ import annotations

import json
from collections.abc import Generator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, Mock, call

import pytest
import yaml
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, sessionmaker

from core.workflow.llm_environment_variable import LLMEnvironmentVariable
from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from graphon.enums import BuiltinNodeTypes
from models import Account, Tenant
from models.dataset import (
    Dataset,
    Pipeline,
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
def service(sqlite_session: Session) -> RagPipelineDslService:
    return RagPipelineDslService(session=sqlite_session)


def _account(*, tenant_id: str = "tenant-1", account_id: str = "account-1") -> Account:
    tenant = Tenant(name="Tenant")
    tenant.id = tenant_id
    account = Account(name="Account", email="account@example.com")
    account.id = account_id
    account._current_tenant = tenant
    return account


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


def _workflow(session: Session, pipeline: Pipeline, *, graph: dict[str, Any] | None = None) -> Workflow:
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


def _dataset(
    session: Session,
    pipeline: Pipeline,
    *,
    name: str = "Dataset",
    chunk_structure: str = "text_model",
) -> Dataset:
    dataset = Dataset(
        tenant_id=pipeline.tenant_id,
        name=name,
        description="description",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique="high_quality",
        created_by="account-1",
        maintainer="account-1",
        chunk_structure=chunk_structure,
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
def _raise_on_workflow_insert(engine: Engine) -> Generator[None]:
    def raise_error(
        _conn: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: object,
    ) -> None:
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


def test_extract_dependencies_from_model_config_covers_models_rerankers_and_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def model_dependency(provider: str) -> str:
        return f"model:{provider}"

    def tool_dependency(provider: str) -> str:
        return f"tool:{provider}"

    analyze_model = Mock(side_effect=model_dependency)
    analyze_tool = Mock(side_effect=tool_dependency)
    monkeypatch.setattr(module.DependenciesAnalysisService, "analyze_model_provider_dependency", analyze_model)
    monkeypatch.setattr(module.DependenciesAnalysisService, "analyze_tool_dependency", analyze_tool)
    model_config: dict[str, Any] = {
        "model": {"provider": "openai"},
        "dataset_configs": {
            "datasets": {
                "datasets": [
                    {
                        "reranking_model": {
                            "reranking_provider_name": {"provider": "cohere"},
                        }
                    }
                ]
            }
        },
        "agent_mode": {"tools": [{"provider_id": "google"}]},
    }

    dependencies = RagPipelineDslService._extract_dependencies_from_model_config(model_config)

    assert dependencies == ["model:openai", "model:cohere", "tool:google"]
    assert analyze_model.call_args_list == [call("openai"), call("cohere")]
    analyze_tool.assert_called_once_with("google")


def test_extract_workflow_dependencies_uses_llm_environment_variable_provider(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService
) -> None:
    workflow = SimpleNamespace(
        graph_dict={
            "nodes": [
                {
                    "id": "llm-node",
                    "data": {
                        "type": "llm",
                        "title": "LLM",
                        "model": {"provider": "old-provider", "name": "old-model", "mode": "chat"},
                        "model_selector": ["env", "shared_model"],
                        "prompt_template": [{"role": "system", "text": "x"}],
                        "context": {"enabled": False, "variable_selector": []},
                        "vision": {"enabled": False},
                    },
                }
            ]
        },
        environment_variables=[
            LLMEnvironmentVariable(
                name="shared_model",
                value={"provider": "new-provider", "name": "new-model", "mode": "chat"},
            )
        ],
    )
    analyze_dependency = Mock(side_effect=lambda provider: provider)
    monkeypatch.setattr(
        module.DependenciesAnalysisService,
        "analyze_model_provider_dependency",
        analyze_dependency,
    )

    result = service._extract_dependencies_from_workflow(cast(Workflow, workflow))

    assert result == ["new-provider"]
    analyze_dependency.assert_called_once_with("new-provider")


@pytest.mark.parametrize("model_selector", [[], ["env", "missing_model"]])
def test_extract_workflow_dependencies_tolerates_unresolved_llm_environment_reference(
    monkeypatch: pytest.MonkeyPatch,
    service: RagPipelineDslService,
    model_selector: list[str],
) -> None:
    workflow = SimpleNamespace(
        graph_dict={
            "nodes": [
                {
                    "id": "llm-node",
                    "data": {
                        "type": "llm",
                        "title": "LLM",
                        "model": {"provider": "old-provider", "name": "old-model", "mode": "chat"},
                        "model_selector": model_selector,
                        "prompt_template": [{"role": "system", "text": "x"}],
                        "context": {"enabled": False, "variable_selector": []},
                        "vision": {"enabled": False},
                    },
                }
            ]
        },
        environment_variables=[],
    )
    analyze_dependency = Mock(side_effect=lambda provider: provider)
    monkeypatch.setattr(
        module.DependenciesAnalysisService,
        "analyze_model_provider_dependency",
        analyze_dependency,
    )

    result = service._extract_dependencies_from_workflow(cast(Workflow, workflow))

    assert result == ["old-provider"]
    analyze_dependency.assert_called_once_with("old-provider")


def test_extract_dependencies_from_workflow_graph_covers_plugin_and_model_nodes(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService
) -> None:
    def model_dependency(provider: str) -> str:
        return f"model:{provider}"

    def tool_dependency(provider: str) -> str:
        return f"tool:{provider}"

    monkeypatch.setattr(
        module.DependenciesAnalysisService,
        "analyze_model_provider_dependency",
        Mock(side_effect=model_dependency),
    )
    monkeypatch.setattr(
        module.DependenciesAnalysisService,
        "analyze_tool_dependency",
        Mock(side_effect=tool_dependency),
    )
    monkeypatch.setattr(
        module.ToolNodeData,
        "model_validate",
        Mock(return_value=SimpleNamespace(provider_id="tool-provider")),
    )
    monkeypatch.setattr(
        module.DatasourceNodeData,
        "model_validate",
        Mock(
            side_effect=[
                SimpleNamespace(provider_type="online_document", plugin_id="datasource-plugin"),
                SimpleNamespace(provider_type="local_file", plugin_id="ignored-local-file"),
            ]
        ),
    )
    monkeypatch.setattr(
        module.LLMNodeData,
        "model_validate",
        Mock(return_value=SimpleNamespace(model=SimpleNamespace(provider="llm-provider"))),
    )
    monkeypatch.setattr(
        module.QuestionClassifierNodeData,
        "model_validate",
        Mock(return_value=SimpleNamespace(model=SimpleNamespace(provider="classifier-provider"))),
    )
    monkeypatch.setattr(
        module.ParameterExtractorNodeData,
        "model_validate",
        Mock(return_value=SimpleNamespace(model=SimpleNamespace(provider="extractor-provider"))),
    )
    graph: dict[str, Any] = {
        "nodes": [
            {"data": {"type": BuiltinNodeTypes.TOOL}},
            {"data": {"type": BuiltinNodeTypes.DATASOURCE}},
            {"data": {"type": BuiltinNodeTypes.DATASOURCE}},
            {"data": {"type": BuiltinNodeTypes.LLM}},
            {"data": {"type": BuiltinNodeTypes.QUESTION_CLASSIFIER}},
            {"data": {"type": BuiltinNodeTypes.PARAMETER_EXTRACTOR}},
            {"data": {"type": "unknown"}},
        ]
    }

    dependencies = service._extract_dependencies_from_workflow_graph(graph)

    assert dependencies == [
        "tool:tool-provider",
        "datasource-plugin",
        "model:llm-provider",
        "model:classifier-provider",
        "model:extractor-provider",
    ]


def test_extract_dependencies_from_workflow_graph_covers_knowledge_variants(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService
) -> None:
    def model_dependency(provider: str) -> str:
        return f"model:{provider}"

    monkeypatch.setattr(
        module.DependenciesAnalysisService,
        "analyze_model_provider_dependency",
        Mock(side_effect=model_dependency),
    )
    knowledge_config = SimpleNamespace(
        indexing_technique="high_quality",
        embedding_model_provider="embedding-provider",
        retrieval_model=SimpleNamespace(
            reranking_mode="reranking_model",
            reranking_enable=True,
            reranking_model=SimpleNamespace(reranking_provider_name="knowledge-reranker"),
        ),
    )
    monkeypatch.setattr(module.KnowledgeConfiguration, "model_validate", Mock(return_value=knowledge_config))
    retrieval_configs = [
        SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="weighted_score",
                weights=SimpleNamespace(vector_setting=SimpleNamespace(embedding_provider_name="weighted-embedding")),
            ),
        ),
        SimpleNamespace(
            retrieval_mode="multiple",
            multiple_retrieval_config=SimpleNamespace(
                reranking_mode="reranking_model",
                reranking_model=SimpleNamespace(provider="retrieval-reranker"),
            ),
        ),
        SimpleNamespace(
            retrieval_mode="single",
            single_retrieval_config=SimpleNamespace(model=SimpleNamespace(provider="single-provider")),
        ),
        SimpleNamespace(retrieval_mode="multiple", multiple_retrieval_config=None),
        SimpleNamespace(retrieval_mode="single", single_retrieval_config=None),
    ]
    monkeypatch.setattr(
        module.KnowledgeRetrievalNodeData,
        "model_validate",
        Mock(side_effect=retrieval_configs),
    )
    graph: dict[str, Any] = {
        "nodes": [
            {"data": {"type": KNOWLEDGE_INDEX_NODE_TYPE}},
            *[{"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}} for _ in retrieval_configs],
        ]
    }

    dependencies = service._extract_dependencies_from_workflow_graph(graph)

    assert dependencies == [
        "model:embedding-provider",
        "model:knowledge-reranker",
        "model:weighted-embedding",
        "model:retrieval-reranker",
        "model:single-provider",
    ]


def test_extract_dependencies_from_workflow_graph_ignores_malformed_nodes(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService
) -> None:
    monkeypatch.setattr(module.ToolNodeData, "model_validate", Mock(side_effect=ValueError("invalid tool")))

    dependencies = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": BuiltinNodeTypes.TOOL}}]}
    )

    assert dependencies == []


def test_check_dependencies_reads_redis_for_persisted_pipeline(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService, sqlite_session: Session
) -> None:
    from core.plugin.entities.plugin import PluginDependency, PluginDependencyType
    from services.rag_pipeline.rag_pipeline_dsl_service import CheckDependenciesPendingData

    pipeline = _pipeline(sqlite_session)
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
    ("import_mode", "yaml_content", "yaml_url", "error"),
    [
        (ImportMode.YAML_URL.value, None, None, "yaml_url is required"),
        (ImportMode.YAML_CONTENT.value, None, None, "yaml_content is required"),
        (
            ImportMode.YAML_CONTENT.value,
            "- item",
            None,
            "content must be a mapping",
        ),
        (
            ImportMode.YAML_CONTENT.value,
            "version: 1\nkind: rag_pipeline",
            None,
            "Invalid version type",
        ),
        (
            ImportMode.YAML_CONTENT.value,
            "version: 0.1.0\nkind: rag_pipeline",
            None,
            "Missing rag_pipeline data",
        ),
    ],
)
def test_import_validation_errors(
    service: RagPipelineDslService,
    import_mode: str,
    yaml_content: str | None,
    yaml_url: str | None,
    error: str,
) -> None:
    result = service.import_rag_pipeline(
        account=_account(),
        import_mode=import_mode,
        yaml_content=yaml_content,
        yaml_url=yaml_url,
    )
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


def test_import_rejects_oversized_unicode_content_by_encoded_size(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService
) -> None:
    monkeypatch.setattr(module, "DSL_MAX_SIZE", 3)

    result = service.import_rag_pipeline(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content="你你",
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "File size exceeds the limit of 10MB"


@pytest.mark.parametrize(
    ("raw_content", "size_limit", "error"),
    [
        (b"\xff\xff", 1, "File size exceeds the limit of 10MB"),
        (b"\xff", 2, "utf-8"),
        (b"", 2, "Empty content from url"),
    ],
)
def test_import_validates_url_bytes_before_parsing(
    monkeypatch: pytest.MonkeyPatch,
    service: RagPipelineDslService,
    raw_content: bytes,
    size_limit: int,
    error: str,
) -> None:
    response = MagicMock()
    response.content = raw_content
    monkeypatch.setattr(module, "DSL_MAX_SIZE", size_limit)
    monkeypatch.setattr(module.remote_fetcher, "make_request", Mock(return_value=response))

    result = service.import_rag_pipeline(
        account=_account(),
        import_mode=ImportMode.YAML_URL.value,
        yaml_url="https://example.com/pipeline.yml",
    )

    assert result.status == ImportStatus.FAILED
    assert error in result.error


def test_import_supplies_default_version_and_kind(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService
) -> None:
    monkeypatch.setattr(module.KnowledgeConfiguration, "model_validate", Mock(return_value=_knowledge_configuration()))
    yaml_content = f"""
rag_pipeline:
  name: Imported
workflow:
  graph:
    nodes:
      - data:
          type: {KNOWLEDGE_INDEX_NODE_TYPE}
"""

    result = service.import_rag_pipeline(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
    )

    assert result.status == ImportStatus.COMPLETED
    assert result.imported_dsl_version == module.CURRENT_DSL_VERSION


def test_confirm_import_rejects_non_serialized_pending_data(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService
) -> None:
    monkeypatch.setattr(module.redis_client, "get", Mock(return_value=object()))

    result = service.confirm_import(import_id="import-1", account=_account())

    assert result.status == ImportStatus.FAILED
    assert result.error == "Invalid import information"


def test_import_pending_version_stores_redis(monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService) -> None:
    setex = Mock()
    monkeypatch.setattr(module.redis_client, "setex", setex)
    result = service.import_rag_pipeline(
        account=_account(), import_mode=ImportMode.YAML_CONTENT.value, yaml_content=_valid_dsl(version="1.0.0")
    )
    assert result.status == ImportStatus.PENDING
    assert setex.call_args.args[0] == f"app_import_info:{result.id}"
    pending = RagPipelinePendingData.model_validate_json(setex.call_args.args[2])
    assert pending.tenant_id == "tenant-1"
    assert pending.account_id == "account-1"
    setex.assert_called_once()


def test_import_creates_real_pipeline_dataset_binding_and_workflow_without_commit(
    monkeypatch: pytest.MonkeyPatch,
    service: RagPipelineDslService,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    monkeypatch.setattr(module.KnowledgeConfiguration, "model_validate", Mock(return_value=_knowledge_configuration()))
    result = service.import_rag_pipeline(
        account=_account(), import_mode=ImportMode.YAML_CONTENT.value, yaml_content=_valid_dsl()
    )
    assert result.status == ImportStatus.COMPLETED
    assert sqlite_session.in_transaction()
    pipeline = sqlite_session.get(Pipeline, result.pipeline_id)
    dataset = sqlite_session.get(Dataset, result.dataset_id)
    assert pipeline is not None
    assert dataset is not None
    assert dataset.pipeline_id == pipeline.id
    assert dataset.collection_binding_id is not None
    assert sqlite_session.scalar(select(Workflow).where(Workflow.app_id == pipeline.id)) is not None
    with sqlite_session_factory() as observer:
        assert observer.get(Pipeline, pipeline.id) is None
        assert observer.get(Dataset, dataset.id) is None

    sqlite_session.commit()
    with sqlite_session_factory() as observer:
        assert observer.get(Pipeline, pipeline.id) is not None
        assert observer.get(Dataset, dataset.id) is not None


def test_import_pipeline_id_is_tenant_scoped(service: RagPipelineDslService, sqlite_session: Session) -> None:
    foreign = _pipeline(sqlite_session, tenant_id="tenant-2")
    result = service.import_rag_pipeline(
        account=_account(tenant_id="tenant-1"),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=_valid_dsl(),
        pipeline_id=foreign.id,
    )
    assert result.status == ImportStatus.FAILED
    assert result.error == "Pipeline not found"


def test_import_failure_leaves_rollback_to_caller(
    service: RagPipelineDslService,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    yaml_content = """
version: 0.1.0
kind: rag_pipeline
rag_pipeline:
  name: Invalid
workflow:
  graph:
    nodes:
      - data:
          type: start
"""

    result = service.import_rag_pipeline(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=yaml_content,
    )

    assert result.status == ImportStatus.FAILED
    assert "Knowledge Index node" in result.error
    assert sqlite_session.in_transaction()
    assert sqlite_session.scalar(select(Pipeline).where(Pipeline.name == "Invalid")) is not None
    with sqlite_session_factory() as observer:
        assert observer.scalar(select(Pipeline).where(Pipeline.name == "Invalid")) is None

    sqlite_session.rollback()
    assert sqlite_session.scalar(select(Pipeline).where(Pipeline.name == "Invalid")) is None


def test_import_rejects_chunk_structure_change_for_published_pipeline(
    monkeypatch: pytest.MonkeyPatch,
    service: RagPipelineDslService,
    sqlite_session: Session,
) -> None:
    pipeline = _pipeline(sqlite_session, published=True)
    _dataset(sqlite_session, pipeline, chunk_structure="hierarchical_model")
    _workflow(sqlite_session, pipeline)
    monkeypatch.setattr(module.KnowledgeConfiguration, "model_validate", Mock(return_value=_knowledge_configuration()))

    result = service.import_rag_pipeline(
        account=_account(),
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=_valid_dsl(),
        pipeline_id=pipeline.id,
    )

    assert result.status == ImportStatus.FAILED
    assert result.error == "Chunk structure is not compatible with the published pipeline"
    sqlite_session.rollback()


def test_create_or_update_pipeline_flushes_caller_transaction_and_updates_existing(
    service: RagPipelineDslService, sqlite_session: Session
) -> None:
    data: dict[str, Any] = {
        "rag_pipeline": {"name": "New", "description": "description"},
        "workflow": {"graph": {"nodes": [], "edges": []}},
    }
    created = service._create_or_update_pipeline(pipeline=None, data=data, account=_account())
    assert created in sqlite_session
    assert created.workflow_id is not None
    assert sqlite_session.in_transaction()
    sqlite_session.commit()

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
    workflow = sqlite_session.get(Workflow, created.workflow_id)
    assert workflow is not None
    assert workflow.graph_dict["nodes"] == [{"id": "node"}]


def test_create_pipeline_flush_failure_is_rolled_back_by_caller(
    service: RagPipelineDslService, sqlite_session: Session, sqlite_engine: Engine
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
    sqlite_session.rollback()
    assert sqlite_session.scalar(select(Pipeline)) is None
    assert sqlite_session.scalar(select(Workflow)) is None


def test_confirm_import_updates_tenant_pipeline_and_dataset(
    monkeypatch: pytest.MonkeyPatch,
    service: RagPipelineDslService,
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    pipeline = _pipeline(sqlite_session)
    dataset = _dataset(sqlite_session, pipeline)
    _workflow(sqlite_session, pipeline)
    pending = RagPipelinePendingData(
        tenant_id="tenant-1",
        account_id="account-1",
        import_mode=ImportMode.YAML_CONTENT.value,
        yaml_content=_valid_dsl(name="Confirmed"),
        pipeline_id=pipeline.id,
    )
    redis_key = "app_import_info:import-1"
    monkeypatch.setattr(
        module.redis_client,
        "get",
        Mock(side_effect=lambda key: pending.model_dump_json() if key == redis_key else None),
    )
    delete = Mock()
    monkeypatch.setattr(module.redis_client, "delete", delete)
    monkeypatch.setattr(module.KnowledgeConfiguration, "model_validate", Mock(return_value=_knowledge_configuration()))
    for foreign_account in (_account(tenant_id="tenant-2"), _account(account_id="account-2")):
        assert service.confirm_import(import_id="import-1", account=foreign_account).status == ImportStatus.FAILED
    delete.assert_not_called()
    assert pipeline.name == "Pipeline"

    result = service.confirm_import(import_id="import-1", account=_account())
    assert result.status == ImportStatus.COMPLETED
    assert result.pipeline_id == pipeline.id
    assert result.dataset_id == dataset.id
    persisted_pipeline = sqlite_session.get(Pipeline, pipeline.id)
    assert persisted_pipeline is not None
    assert persisted_pipeline.name == "Confirmed"
    assert sqlite_session.in_transaction()
    with sqlite_session_factory() as observer:
        observed_pipeline = observer.get(Pipeline, pipeline.id)
        assert observed_pipeline is not None
        assert observed_pipeline.name == "Pipeline"

    sqlite_session.commit()
    with sqlite_session_factory() as observer:
        observed_pipeline = observer.get(Pipeline, pipeline.id)
        assert observed_pipeline is not None
        assert observed_pipeline.name == "Confirmed"

    delete.assert_called_once_with(redis_key)


def test_export_reads_real_dataset_and_workflow_and_filters_credentials(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService, sqlite_session: Session
) -> None:
    pipeline = _pipeline(sqlite_session)
    with pytest.raises(ValueError, match="Missing dataset"):
        service.export_rag_pipeline_dsl(pipeline)
    _dataset(sqlite_session, pipeline)
    with pytest.raises(ValueError, match="Missing draft workflow"):
        service.export_rag_pipeline_dsl(pipeline)
    _workflow(
        sqlite_session,
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
                {
                    "data": {
                        "type": BuiltinNodeTypes.AGENT,
                        "agent_parameters": {
                            "tools": {"value": [{"credential_id": "agent-secret"}]},
                        },
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
    assert "credential_id" not in nodes[2]["data"]["agent_parameters"]["tools"]["value"][0]


def test_export_preserves_tool_and_agent_credentials_when_requested(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService, sqlite_session: Session
) -> None:
    pipeline = _pipeline(sqlite_session)
    _dataset(sqlite_session, pipeline)
    _workflow(
        sqlite_session,
        pipeline,
        graph={
            "nodes": [
                {
                    "data": {
                        "type": BuiltinNodeTypes.TOOL,
                        "credential_id": "tool-secret",
                        "provider_id": "provider",
                    }
                },
                {
                    "data": {
                        "type": BuiltinNodeTypes.AGENT,
                        "agent_parameters": {
                            "tools": {"value": [{"credential_id": "agent-secret"}]},
                        },
                    }
                },
            ],
            "edges": [],
        },
    )
    monkeypatch.setattr(module.DependenciesAnalysisService, "generate_dependencies", Mock(return_value=[]))

    exported = yaml.safe_load(service.export_rag_pipeline_dsl(pipeline, include_secret=True))

    nodes = exported["workflow"]["graph"]["nodes"]
    assert nodes[0]["data"]["credential_id"] == "tool-secret"
    assert nodes[1]["data"]["agent_parameters"]["tools"]["value"][0]["credential_id"] == "agent-secret"


def test_create_dataset_name_is_tenant_scoped_and_ignores_template_rows(
    monkeypatch: pytest.MonkeyPatch, service: RagPipelineDslService, sqlite_session: Session
) -> None:
    foreign_pipeline = _pipeline(sqlite_session, tenant_id="tenant-2")
    _dataset(sqlite_session, foreign_pipeline, name="Shared")
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
    sqlite_session.add(template)
    sqlite_session.commit()
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

    local_pipeline = _pipeline(sqlite_session, tenant_id="tenant-1")
    _dataset(sqlite_session, local_pipeline, name="Local")
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
