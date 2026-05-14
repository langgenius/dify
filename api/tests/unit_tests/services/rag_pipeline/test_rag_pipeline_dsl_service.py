from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import MagicMock, Mock

import pytest
import yaml
from sqlalchemy.orm import Session

from core.workflow.nodes.knowledge_index import KNOWLEDGE_INDEX_NODE_TYPE
from graphon.enums import BuiltinNodeTypes
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, RagPipelineDatasetCreateEntity
from services.rag_pipeline.rag_pipeline_dsl_service import (
    ImportStatus,
    RagPipelineDslService,
    _check_version_compatibility,
)


@pytest.mark.parametrize(
    ("imported_version", "expected_status"),
    [
        ("invalid", ImportStatus.FAILED),
        ("1.0.0", ImportStatus.PENDING),
        ("0.0.9", ImportStatus.COMPLETED_WITH_WARNINGS),
        ("0.1.0", ImportStatus.COMPLETED),
    ],
)
def test_check_version_compatibility(imported_version: str, expected_status: ImportStatus) -> None:
    assert _check_version_compatibility(imported_version) == expected_status


def test_encrypt_decrypt_dataset_id_roundtrip() -> None:
    service = RagPipelineDslService(session=Mock())

    encrypted = service.encrypt_dataset_id("dataset-1", "tenant-1")
    decrypted = service.decrypt_dataset_id(encrypted, "tenant-1")

    assert decrypted == "dataset-1"


def test_decrypt_dataset_id_returns_none_for_invalid_payload() -> None:
    service = RagPipelineDslService(session=Mock())

    result = service.decrypt_dataset_id("not-base64", "tenant-1")

    assert result is None


def test_get_leaked_dependencies_returns_empty_list_for_empty_input() -> None:
    result = RagPipelineDslService.get_leaked_dependencies("tenant-1", [])

    assert result == []


def test_get_leaked_dependencies_delegates_to_analysis_service(mocker) -> None:
    expected = [Mock()]
    get_leaked_mock = mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.get_leaked_dependencies",
        return_value=expected,
    )

    dependency = Mock()
    result = RagPipelineDslService.get_leaked_dependencies("tenant-1", [dependency])

    assert result == expected
    get_leaked_mock.assert_called_once_with(tenant_id="tenant-1", dependencies=[dependency])


# --- check_dependencies ---


def test_check_dependencies_returns_empty_when_no_redis_data(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.redis_client.get",
        return_value=None,
    )
    service = RagPipelineDslService(session=Mock())
    pipeline = Mock(id="p1", tenant_id="t1")

    result = service.check_dependencies(pipeline=pipeline)

    assert result.leaked_dependencies == []


def test_check_dependencies_returns_leaked_deps_from_redis(mocker) -> None:
    from core.plugin.entities.plugin import PluginDependency
    from services.rag_pipeline.rag_pipeline_dsl_service import CheckDependenciesPendingData

    dep = PluginDependency(
        type=PluginDependency.Type.Marketplace,
        value=PluginDependency.Marketplace(marketplace_plugin_unique_identifier="test/plugin:0.1.0"),
    )
    pending_data = CheckDependenciesPendingData(
        dependencies=[dep],
        pipeline_id="p1",
    )
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.redis_client.get",
        return_value=pending_data.model_dump_json(),
    )
    leaked = [dep]
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.get_leaked_dependencies",
        return_value=leaked,
    )
    service = RagPipelineDslService(session=Mock())
    pipeline = Mock(id="p1", tenant_id="t1")

    result = service.check_dependencies(pipeline=pipeline)

    assert result.leaked_dependencies == leaked


# --- _extract_dependencies_from_model_config ---


def test_extract_dependencies_from_model_config_extracts_model(mocker) -> None:
    analyze_mock = mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="langgenius/openai",
    )
    config = {"model": {"provider": "openai"}}

    result = RagPipelineDslService._extract_dependencies_from_model_config(config)

    assert "langgenius/openai" in result
    analyze_mock.assert_called_with("openai")


def test_extract_dependencies_from_model_config_extracts_tools(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="x",
    )
    analyze_tool_mock = mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_tool_dependency",
        return_value="langgenius/google",
    )
    config = {
        "model": {"provider": "openai"},
        "agent_mode": {"tools": [{"provider_id": "google"}]},
    }

    result = RagPipelineDslService._extract_dependencies_from_model_config(config)

    assert "langgenius/google" in result
    analyze_tool_mock.assert_called_with("google")


def test_extract_dependencies_from_model_config_empty_config() -> None:
    result = RagPipelineDslService._extract_dependencies_from_model_config({})

    assert result == []


# --- _extract_dependencies_from_workflow_graph ---


def test_extract_dependencies_from_workflow_graph_ignores_unknown_types(mocker) -> None:
    service = RagPipelineDslService(session=Mock())
    graph = {"nodes": [{"data": {"type": "some-unknown-type"}}]}

    result = service._extract_dependencies_from_workflow_graph(graph)

    assert result == []


def test_extract_dependencies_from_workflow_graph_handles_empty_graph() -> None:
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph({})

    assert result == []


def test_extract_dependencies_from_workflow_graph_handles_malformed_node(mocker) -> None:
    service = RagPipelineDslService(session=Mock())
    # Node with TOOL type but invalid data should be caught by exception handler
    from graphon.enums import BuiltinNodeTypes

    graph = {"nodes": [{"data": {"type": BuiltinNodeTypes.TOOL}}]}

    result = service._extract_dependencies_from_workflow_graph(graph)

    # Should not raise, error is caught internally
    assert isinstance(result, list)


# --- export_rag_pipeline_dsl ---


def test_export_rag_pipeline_dsl_raises_when_dataset_missing() -> None:
    pipeline = Mock()
    pipeline.retrieve_dataset.return_value = None

    service = RagPipelineDslService(session=Mock())

    with pytest.raises(ValueError, match="Missing dataset"):
        service.export_rag_pipeline_dsl(pipeline=pipeline)


# --- import_rag_pipeline ---


def test_import_rag_pipeline_url_fetch_error(mocker) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.ssrf_proxy.get", side_effect=Exception("fetch failed"))
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(
        account=account, import_mode="yaml-url", yaml_url="https://example.com/dsl.yml"
    )

    assert result.status == ImportStatus.FAILED
    assert "fetch failed" in result.error


def test_import_rag_pipeline_yaml_content_success(mocker) -> None:
    yaml_content = """
version: 0.1.0
kind: rag_pipeline
rag_pipeline:
    name: Test Pipeline
workflow:
    graph:
        nodes:
            - data:
                type: knowledge-index
"""
    pipeline = Mock()
    pipeline.name = "Test Pipeline"
    pipeline.description = "desc"
    pipeline.id = "p1"
    pipeline.is_published = False
    mocker.patch.object(RagPipelineDslService, "_create_or_update_pipeline", return_value=pipeline)

    config_mock = Mock()
    config_mock.indexing_technique = "high_quality"
    config_mock.embedding_model = "m"
    config_mock.embedding_model_provider = "p"
    config_mock.summary_index_setting = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate",
        return_value=config_mock,
    )

    dataset_mock = Mock()
    dataset_mock.id = "d1"
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Dataset", return_value=dataset_mock)
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.select", return_value=MagicMock())

    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    session.scalars.return_value.all.return_value = []
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(account=account, import_mode="yaml-content", yaml_content=yaml_content)

    if result.status == ImportStatus.FAILED:
        print(f"DEBUG: {result.error}")
    assert result.status == ImportStatus.COMPLETED
    session.commit.assert_not_called()
    session.flush.assert_called()


def test_import_rag_pipeline_flushes_new_collection_binding_without_commit(mocker) -> None:
    yaml_content = """
version: 0.1.0
kind: rag_pipeline
rag_pipeline:
    name: Test Pipeline
workflow:
    graph:
        nodes:
            - data:
                type: knowledge-index
"""
    pipeline = Mock(id="p1", description="desc", is_published=False)
    pipeline.name = "Test Pipeline"
    mocker.patch.object(RagPipelineDslService, "_create_or_update_pipeline", return_value=pipeline)

    config_mock = Mock()
    config_mock.indexing_technique = "high_quality"
    config_mock.embedding_model = "m"
    config_mock.embedding_model_provider = "p"
    config_mock.chunk_structure = "text_model"
    config_mock.retrieval_model.model_dump.return_value = {}
    config_mock.summary_index_setting = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate",
        return_value=config_mock,
    )

    dataset_mock = Mock(id="d1")
    binding_mock = Mock(id="b1")
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Dataset", return_value=dataset_mock)
    binding_cls = mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DatasetCollectionBinding",
        return_value=binding_mock,
    )
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.select", return_value=MagicMock())

    session = cast(MagicMock, Mock())
    session.scalar.return_value = None
    session.scalars.return_value.all.return_value = []
    service = RagPipelineDslService(session=cast(Session, session))
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(account=account, import_mode="yaml-content", yaml_content=yaml_content)

    assert result.status == ImportStatus.COMPLETED
    binding_cls.assert_called_once()
    assert dataset_mock.collection_binding_id == "b1"
    session.commit.assert_not_called()
    assert session.flush.call_count >= 2


def test_import_rag_pipeline_pending_version(mocker) -> None:
    yaml_content = "version: 1.0.0\nkind: rag_pipeline\nrag_pipeline: {name: x}"
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.redis_client.setex")
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1", id="u1")

    result = service.import_rag_pipeline(account=account, import_mode="yaml-content", yaml_content=yaml_content)

    assert result.status == ImportStatus.PENDING
    assert result.imported_dsl_version == "1.0.0"


# --- confirm_import ---


def test_confirm_import_success(mocker) -> None:
    from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelinePendingData

    yaml_content = """
version: 0.1.0
kind: rag_pipeline
rag_pipeline:
    name: Test Pipeline
workflow:
    graph:
        nodes:
            - data:
                type: knowledge-index
"""
    pending = RagPipelinePendingData(import_mode="yaml-content", yaml_content=yaml_content, pipeline_id="p1")
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.redis_client.get",
        return_value=pending.model_dump_json(),
    )
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.redis_client.delete")

    pipeline = Mock()
    pipeline.id = "p1"
    pipeline.name = "Test Pipeline"
    pipeline.description = "desc"
    pipeline.retrieve_dataset.return_value = None

    mocker.patch.object(RagPipelineDslService, "_create_or_update_pipeline", return_value=pipeline)

    config_mock = Mock()
    config_mock.indexing_technique = "high_quality"
    config_mock.embedding_model = "m"
    config_mock.embedding_model_provider = "p"
    config_mock.chunk_structure = "text_model"
    config_mock.retrieval_model.model_dump.return_value = {}
    config_mock.summary_index_setting = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate",
        return_value=config_mock,
    )

    dataset_mock = Mock()
    dataset_mock.id = "d1"
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Dataset", return_value=dataset_mock)
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.DatasetCollectionBinding", return_value=Mock(id="b1"))
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.select", return_value=MagicMock())

    service = RagPipelineDslService(session=Mock())
    # Mocking self._session.scalar for the pipeline lookup
    service._session.scalar.return_value = pipeline

    account = Mock()
    account.id = "u1"
    account.current_tenant_id = "t1"

    result = service.confirm_import(account=account, import_id="imp-1")

    assert result.status == ImportStatus.COMPLETED
    assert result.pipeline_id == "p1"
    assert result.dataset_id == "d1"


def test_confirm_import_flushes_new_collection_binding_without_commit(mocker) -> None:
    from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelinePendingData

    yaml_content = """
version: 0.1.0
kind: rag_pipeline
rag_pipeline:
    name: Test Pipeline
workflow:
    graph:
        nodes:
            - data:
                type: knowledge-index
"""
    pending = RagPipelinePendingData(import_mode="yaml-content", yaml_content=yaml_content, pipeline_id="p1")
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.redis_client.get",
        return_value=pending.model_dump_json(),
    )
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.redis_client.delete")

    pipeline = Mock(id="p1", description="desc")
    pipeline.name = "Test Pipeline"
    pipeline.retrieve_dataset.return_value = None
    mocker.patch.object(RagPipelineDslService, "_create_or_update_pipeline", return_value=pipeline)

    config_mock = Mock()
    config_mock.indexing_technique = "high_quality"
    config_mock.embedding_model = "m"
    config_mock.embedding_model_provider = "p"
    config_mock.chunk_structure = "text_model"
    config_mock.retrieval_model.model_dump.return_value = {}
    config_mock.summary_index_setting = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate",
        return_value=config_mock,
    )

    dataset_mock = Mock(id="d1")
    binding_mock = Mock(id="b1")
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Dataset", return_value=dataset_mock)
    binding_cls = mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DatasetCollectionBinding",
        return_value=binding_mock,
    )
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.select", return_value=MagicMock())

    session = cast(MagicMock, Mock())
    session.scalar.side_effect = [pipeline, None]
    service = RagPipelineDslService(session=cast(Session, session))
    account = Mock(id="u1", current_tenant_id="t1")

    result = service.confirm_import(account=account, import_id="imp-1")

    assert result.status == ImportStatus.COMPLETED
    binding_cls.assert_called_once()
    assert dataset_mock.collection_binding_id == "b1"
    session.commit.assert_not_called()
    assert session.flush.call_count >= 2


# --- _extract_dependencies_from_workflow_graph all types ---


@pytest.mark.parametrize(
    "node_type",
    [
        BuiltinNodeTypes.TOOL,
        BuiltinNodeTypes.LLM,
        BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
        BuiltinNodeTypes.PARAMETER_EXTRACTOR,
        BuiltinNodeTypes.QUESTION_CLASSIFIER,
    ],
)
def test_extract_dependencies_from_workflow_graph_types(mocker, node_type) -> None:
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_tool_dependency",
        return_value="t1",
    )
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="m1",
    )

    # Mock all potential node data classes
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.ToolNodeData.model_validate",
        return_value=Mock(provider_id="p1"),
    )
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.LLMNodeData.model_validate",
        return_value=Mock(model=Mock(provider="p1")),
    )
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeRetrievalNodeData.model_validate",
        return_value=Mock(
            retrieval_mode="single",
            single_retrieval_config=Mock(model=Mock(provider="p1")),
        ),
    )
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.ParameterExtractorNodeData.model_validate",
        return_value=Mock(model=Mock(provider="p1")),
    )
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.QuestionClassifierNodeData.model_validate",
        return_value=Mock(model=Mock(provider="p1")),
    )

    service = RagPipelineDslService(session=Mock())
    graph = {"nodes": [{"data": {"type": node_type}}]}

    result = service._extract_dependencies_from_workflow_graph(graph)

    assert len(result) > 0


# --- _create_or_update_pipeline ---


def test_create_or_update_pipeline_create_new(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    account = Mock(current_tenant_id="t1", id="u1")
    data = {
        "rag_pipeline": {"name": "New", "description": "desc"},
        "workflow": {"graph": {"nodes": []}},
    }

    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.current_user", SimpleNamespace(id="u1"))
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Workflow", return_value=Mock())
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.select", return_value=MagicMock())
    pipeline_cls = mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Pipeline")
    pipeline_instance = pipeline_cls.return_value
    pipeline_instance.tenant_id = "t1"
    pipeline_instance.id = "p1"
    pipeline_instance.name = "P"
    pipeline_instance.is_published = False
    session.scalar.return_value = None

    result = service._create_or_update_pipeline(pipeline=None, data=data, account=account, dependencies=[])

    assert result == pipeline_instance
    session.add.assert_called()
    session.commit.assert_not_called()
    session.flush.assert_called()


# --- export_rag_pipeline_dsl comprehensive ---


def test_export_rag_pipeline_dsl_with_workflow(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    pipeline = Mock()
    pipeline.id = "p1"
    pipeline.tenant_id = "t1"
    pipeline.name = "P"
    pipeline.description = "d"

    dataset = Mock()
    dataset.id = "d1"
    dataset.name = "D"
    dataset.chunk_structure = "text_model"
    dataset.doc_form = "text_model"
    dataset.icon_info = {"icon": "i"}
    pipeline.retrieve_dataset.return_value = dataset

    workflow = Mock()
    workflow.app_id = "p1"
    workflow.graph_dict = {"nodes": []}
    workflow.environment_variables = []
    workflow.conversation_variables = []
    workflow.rag_pipeline_variables = []
    workflow.to_dict.return_value = {"graph": {"nodes": []}}

    session.scalar.return_value = workflow
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.generate_dependencies",
        return_value=[],
    )

    result_yaml = service.export_rag_pipeline_dsl(pipeline=pipeline)
    data = yaml.safe_load(result_yaml)

    assert data["kind"] == "rag_pipeline"
    assert data["rag_pipeline"]["name"] == "D"
    assert "workflow" in data


# --- _extract_dependencies_from_workflow_graph more types ---


def test_extract_dependencies_from_workflow_graph_datasource(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DatasourceNodeData.model_validate",
        return_value=Mock(provider_type="online", plugin_id="ds1"),
    )
    service = RagPipelineDslService(session=Mock())
    graph = {"nodes": [{"data": {"type": BuiltinNodeTypes.DATASOURCE}}]}

    result = service._extract_dependencies_from_workflow_graph(graph)

    assert "ds1" in result


def test_import_rag_pipeline_raises_for_invalid_mode() -> None:
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")

    with pytest.raises(ValueError, match="Invalid import_mode"):
        service.import_rag_pipeline(account=account, import_mode="invalid-mode")


def test_import_rag_pipeline_yaml_url_requires_url() -> None:
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(account=account, import_mode="yaml-url", yaml_url=None)

    assert result.status == ImportStatus.FAILED
    assert "yaml_url is required" in result.error


def test_import_rag_pipeline_yaml_content_requires_content() -> None:
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(account=account, import_mode="yaml-content", yaml_content=None)

    assert result.status == ImportStatus.FAILED
    assert "yaml_content is required" in result.error


def test_import_rag_pipeline_yaml_content_requires_mapping() -> None:
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(account=account, import_mode="yaml-content", yaml_content="- one\n- two")

    assert result.status == ImportStatus.FAILED
    assert "content must be a mapping" in result.error


def test_confirm_import_returns_failed_when_pending_data_is_invalid_type(mocker) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.redis_client.get", return_value=object())
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")

    result = service.confirm_import(import_id="imp-1", account=account)

    assert result.status == ImportStatus.FAILED
    assert "Invalid import information" in result.error


def test_append_workflow_export_data_filters_credentials(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    workflow = Mock()
    workflow.graph_dict = {"nodes": []}
    workflow.to_dict.return_value = {
        "graph": {
            "nodes": [
                {
                    "data": {
                        "type": BuiltinNodeTypes.TOOL,
                        "credential_id": "secret",
                    }
                },
                {
                    "data": {
                        "type": BuiltinNodeTypes.AGENT,
                        "agent_parameters": {"tools": {"value": [{"credential_id": "secret-agent"}]}},
                    }
                },
            ]
        }
    }
    session.scalar.return_value = workflow
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.generate_dependencies",
        return_value=[],
    )
    export_data: dict[str, Any] = {}
    pipeline = Mock(id="p1", tenant_id="t1")

    service._append_workflow_export_data(export_data=export_data, pipeline=pipeline, include_secret=False)

    nodes = export_data["workflow"]["graph"]["nodes"]
    assert "credential_id" not in nodes[0]["data"]
    assert "credential_id" not in nodes[1]["data"]["agent_parameters"]["tools"]["value"][0]


def test_create_rag_pipeline_dataset_raises_when_name_conflicts(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    session.scalar.return_value = Mock()
    create_entity = RagPipelineDatasetCreateEntity(
        name="Existing Name",
        description="",
        icon_info=IconInfo(icon="book"),
        permission="only_me",
        yaml_content="x",
    )

    with pytest.raises(ValueError, match="already exists"):
        service.create_rag_pipeline_dataset("tenant-1", create_entity)


def test_create_rag_pipeline_dataset_generates_name_when_missing(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    session.scalar.return_value = None
    session.scalars.return_value.all.return_value = [Mock(name="Untitled")]
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.generate_incremental_name", return_value="Untitled 2")
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.current_user", Mock(id="u1", current_tenant_id="t1"))
    mocker.patch.object(
        service,
        "import_rag_pipeline",
        return_value=SimpleNamespace(
            id="imp-1",
            dataset_id="d1",
            pipeline_id="p1",
            status=ImportStatus.COMPLETED,
            imported_dsl_version="0.1.0",
            current_dsl_version="0.1.0",
            error="",
        ),
    )
    create_entity = RagPipelineDatasetCreateEntity(
        name="",
        description="",
        icon_info=IconInfo(icon="book"),
        permission="only_me",
        yaml_content="x",
    )

    result = service.create_rag_pipeline_dataset("tenant-1", create_entity)

    assert create_entity.name == "Untitled 2"
    assert result["status"] == ImportStatus.COMPLETED


def test_append_workflow_export_data_encrypts_knowledge_retrieval_dataset_ids(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    workflow = Mock()
    workflow.graph_dict = {"nodes": []}
    workflow.to_dict.return_value = {
        "graph": {
            "nodes": [
                {
                    "data": {
                        "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                        "dataset_ids": ["d1", "d2"],
                    }
                }
            ]
        }
    }
    session.scalar.return_value = workflow
    mocker.patch.object(service, "encrypt_dataset_id", side_effect=lambda dataset_id, tenant_id: f"enc-{dataset_id}")
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.generate_dependencies",
        return_value=[],
    )
    export_data: dict[str, Any] = {}
    pipeline = Mock(id="p1", tenant_id="t1")

    service._append_workflow_export_data(export_data=export_data, pipeline=pipeline, include_secret=False)

    ids = export_data["workflow"]["graph"]["nodes"][0]["data"]["dataset_ids"]
    assert ids == ["enc-d1", "enc-d2"]


def test_confirm_import_updates_existing_dataset(mocker) -> None:
    from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelinePendingData

    yaml_content = (
        "version: 0.1.0\n"
        "kind: rag_pipeline\n"
        "rag_pipeline: {name: x}\n"
        "workflow: {graph: {nodes: [{data: {type: knowledge-index}}]}}"
    )
    pending = RagPipelinePendingData(import_mode="yaml-content", yaml_content=yaml_content, pipeline_id="p1")
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.redis_client.get",
        return_value=pending.model_dump_json(),
    )
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.redis_client.delete")
    pipeline = Mock(id="p1", name="P", description="D")
    dataset = Mock(id="d1")
    pipeline.retrieve_dataset.return_value = dataset
    mocker.patch.object(RagPipelineDslService, "_create_or_update_pipeline", return_value=pipeline)
    config_mock = Mock()
    config_mock.indexing_technique = "economy"
    config_mock.keyword_number = 3
    config_mock.retrieval_model.model_dump.return_value = {"top_k": 3}
    config_mock.chunk_structure = "text_model"
    config_mock.summary_index_setting = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate",
        return_value=config_mock,
    )
    service = RagPipelineDslService(session=Mock())
    service._session.scalar.return_value = pipeline
    account = Mock(id="u1", current_tenant_id="t1")

    result = service.confirm_import(import_id="imp-1", account=account)

    assert result.status == ImportStatus.COMPLETED
    assert dataset.indexing_technique == "economy"


def test_import_rag_pipeline_yaml_url_handles_empty_content_after_github_rewrite(mocker) -> None:
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b""
    get_mock = mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.ssrf_proxy.get", return_value=response)
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(
        account=account,
        import_mode="yaml-url",
        yaml_url="https://github.com/langgenius/dify/blob/main/pipeline.yml",
    )

    assert result.status == ImportStatus.FAILED
    assert "Empty content from url" in result.error
    called_url = get_mock.call_args.args[0]
    assert "raw.githubusercontent.com" in called_url


def test_create_or_update_pipeline_decrypts_knowledge_retrieval_dataset_ids(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    account = Mock(id="u1", current_tenant_id="t1")
    pipeline = Mock(id="p1", tenant_id="t1", name="N", description="D")
    data = {
        "rag_pipeline": {"name": "N2", "description": "D2"},
        "workflow": {
            "graph": {
                "nodes": [
                    {
                        "data": {
                            "type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL,
                            "dataset_ids": ["enc-1", "enc-2"],
                        }
                    }
                ]
            }
        },
    }
    draft_workflow = Mock(id="wf1")
    session.scalar.return_value = draft_workflow
    mocker.patch.object(service, "decrypt_dataset_id", side_effect=["d1", None])

    result = service._create_or_update_pipeline(pipeline=pipeline, data=data, account=account)

    assert result is pipeline
    assert data["workflow"]["graph"]["nodes"][0]["data"]["dataset_ids"] == ["d1"]
    assert draft_workflow.graph is not None


def test_create_or_update_pipeline_creates_draft_when_missing(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    account = Mock(id="u1", current_tenant_id="t1")
    pipeline = Mock(id="p1", tenant_id="t1", name="N", description="D")
    data = {"rag_pipeline": {"name": "N2", "description": "D2"}, "workflow": {"graph": {"nodes": []}}}
    session.scalar.return_value = None
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.select", return_value=MagicMock())
    workflow_cls = mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Workflow")
    workflow_cls.return_value.id = "wf-new"

    service._create_or_update_pipeline(pipeline=pipeline, data=data, account=account)

    assert pipeline.workflow_id == "wf-new"


def test_import_rag_pipeline_url_size_exceeds_limit(mocker) -> None:
    response = Mock()
    response.raise_for_status.return_value = None
    response.content = b"x" * (10 * 1024 * 1024 + 1)
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.ssrf_proxy.get", return_value=response)
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(
        account=account,
        import_mode="yaml-url",
        yaml_url="https://example.com/pipeline.yaml",
    )

    assert result.status == ImportStatus.FAILED
    assert "10MB" in result.error


def test_import_rag_pipeline_fails_when_rag_pipeline_data_missing() -> None:
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")
    result = service.import_rag_pipeline(
        account=account,
        import_mode="yaml-content",
        yaml_content="version: 0.1.0\nkind: rag_pipeline\nworkflow: {}",
    )

    assert result.status == ImportStatus.FAILED
    assert "Missing rag_pipeline data" in result.error


def test_import_rag_pipeline_fails_when_pipeline_id_not_found() -> None:
    session = cast(MagicMock, Mock())
    session.scalar.return_value = None
    service = RagPipelineDslService(session=cast(Session, session))
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(
        account=account,
        import_mode="yaml-content",
        yaml_content="version: 0.1.0\nkind: rag_pipeline\nrag_pipeline: {name: x}\nworkflow: {}",
        pipeline_id="missing-pipeline",
    )

    assert result.status == ImportStatus.FAILED
    assert "Pipeline not found" in result.error


def test_import_rag_pipeline_fails_for_non_string_version_type() -> None:
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(
        account=account,
        import_mode="yaml-content",
        yaml_content="version: 1\nkind: rag_pipeline\nrag_pipeline: {name: x}\nworkflow: {}",
    )

    assert result.status == ImportStatus.FAILED
    assert "Invalid version type" in result.error


def test_append_workflow_export_data_raises_when_draft_workflow_missing() -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    session.scalar.return_value = None

    with pytest.raises(ValueError, match="Missing draft workflow configuration"):
        service._append_workflow_export_data(export_data={}, pipeline=Mock(tenant_id="t1"), include_secret=False)


def test_append_workflow_export_data_keeps_secret_fields_when_include_secret_true(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    workflow = Mock()
    workflow.graph_dict = {"nodes": []}
    workflow.to_dict.return_value = {
        "graph": {
            "nodes": [
                {"data": {"type": BuiltinNodeTypes.TOOL, "credential_id": "tool-secret"}},
                {
                    "data": {
                        "type": BuiltinNodeTypes.AGENT,
                        "agent_parameters": {"tools": {"value": [{"credential_id": "agent-secret"}]}},
                    }
                },
            ]
        }
    }
    session.scalar.return_value = workflow
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.generate_dependencies",
        return_value=[],
    )

    export_data: dict[str, object] = {}
    service._append_workflow_export_data(export_data=export_data, pipeline=Mock(tenant_id="t1"), include_secret=True)

    workflow_data = cast(dict[str, object], export_data["workflow"])
    graph = cast(dict[str, object], workflow_data["graph"])
    nodes = cast(list[dict[str, object]], graph["nodes"])
    node0_data = cast(dict[str, object], nodes[0]["data"])
    node1_data = cast(dict[str, object], nodes[1]["data"])
    agent_parameters = cast(dict[str, object], node1_data["agent_parameters"])
    tools = cast(dict[str, object], agent_parameters["tools"])
    tool_values = cast(list[dict[str, object]], tools["value"])
    assert node0_data["credential_id"] == "tool-secret"
    assert tool_values[0]["credential_id"] == "agent-secret"


def test_extract_dependencies_from_workflow_graph_skips_local_file_datasource(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DatasourceNodeData.model_validate",
        return_value=Mock(provider_type="local_file", plugin_id="plugin-x"),
    )
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": BuiltinNodeTypes.DATASOURCE}}]}
    )

    assert result == []


def test_extract_dependencies_from_workflow_graph_knowledge_index_reranking(mocker) -> None:
    analyze = mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        side_effect=lambda provider: f"dep:{provider}",
    )
    knowledge = Mock()
    knowledge.indexing_technique = "high_quality"
    knowledge.embedding_model_provider = "embed-provider"
    knowledge.retrieval_model.reranking_mode = "reranking_model"
    knowledge.retrieval_model.reranking_enable = True
    knowledge.retrieval_model.reranking_model.reranking_provider_name = "rerank-provider"
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate",
        return_value=knowledge,
    )
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": KNOWLEDGE_INDEX_NODE_TYPE}}]}
    )

    assert result == ["dep:embed-provider", "dep:rerank-provider"]
    assert analyze.call_count == 2


def test_extract_dependencies_from_workflow_graph_multiple_retrieval_weighted_score(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="dep:weighted",
    )
    retrieval = Mock()
    retrieval.retrieval_mode = "multiple"
    retrieval.multiple_retrieval_config.reranking_mode = "weighted_score"
    retrieval.multiple_retrieval_config.weights.vector_setting.embedding_provider_name = "emb-provider"
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeRetrievalNodeData.model_validate",
        return_value=retrieval,
    )
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}}]}
    )

    assert result == ["dep:weighted"]


def test_extract_dependencies_from_workflow_graph_multiple_retrieval_reranking_model(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="dep:rerank",
    )
    retrieval = Mock()
    retrieval.retrieval_mode = "multiple"
    retrieval.multiple_retrieval_config.reranking_mode = "reranking_model"
    retrieval.multiple_retrieval_config.reranking_model.provider = "rerank-provider"
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeRetrievalNodeData.model_validate",
        return_value=retrieval,
    )
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}}]}
    )

    assert result == ["dep:rerank"]


def test_extract_dependencies_from_model_config_includes_dataset_reranking_and_tools(mocker) -> None:
    model_analyze = mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        side_effect=["dep:model", "dep:rerank"],
    )
    tool_analyze = mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_tool_dependency",
        return_value="dep:tool",
    )
    config = {
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

    deps = RagPipelineDslService._extract_dependencies_from_model_config(config)

    assert deps == ["dep:model", "dep:rerank", "dep:tool"]
    assert model_analyze.call_count == 2
    tool_analyze.assert_called_once_with("google")


def test_check_version_compatibility_hits_major_older_branch(mocker) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.CURRENT_DSL_VERSION", "1.0.0")

    status = _check_version_compatibility("0.9.0")

    assert status == ImportStatus.PENDING


def test_import_rag_pipeline_sets_default_version_and_kind(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    account = Mock(current_tenant_id="t1")
    pipeline = Mock(id="p1", name="P", description="D", is_published=False)
    mocker.patch.object(service, "_create_or_update_pipeline", return_value=pipeline)
    config = Mock()
    config.indexing_technique = "economy"
    config.keyword_number = 2
    config.retrieval_model.model_dump.return_value = {}
    config.summary_index_setting = None
    config.chunk_structure = "text_model"
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate",
        return_value=config,
    )
    dataset = Mock(id="d1")
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Dataset", return_value=dataset)
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.select", return_value=MagicMock())
    session.scalars.return_value.all.return_value = []
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.generate_incremental_name", return_value="P")

    result = service.import_rag_pipeline(
        account=account,
        import_mode="yaml-content",
        yaml_content="rag_pipeline: {name: x}\nworkflow: {graph: {nodes: [{data: {type: knowledge-index}}]}}",
    )

    assert result.status == ImportStatus.COMPLETED
    assert result.imported_dsl_version == "0.1.0"


def test_import_rag_pipeline_creates_pending_for_dependencies(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    account = Mock(current_tenant_id="t1")
    setex = mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.redis_client.setex")
    yaml_content = """
version: 1.0.0
kind: rag_pipeline
rag_pipeline: {name: x}
dependencies:
  - type: marketplace
    value:
      marketplace_plugin_unique_identifier: langgenius/example:0.1.0
workflow: {graph: {nodes: []}}
"""

    result = service.import_rag_pipeline(account=account, import_mode="yaml-content", yaml_content=yaml_content)

    assert result.status == ImportStatus.PENDING
    setex.assert_called_once()


def test_confirm_import_returns_failed_when_pending_pipeline_missing(mocker) -> None:
    from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelinePendingData

    pending = RagPipelinePendingData(import_mode="yaml-content", yaml_content="version: 0.1.0", pipeline_id="p1")
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.redis_client.get", return_value=pending.model_dump_json()
    )
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    session.scalar.return_value = None
    mocker.patch.object(RagPipelineDslService, "_create_or_update_pipeline", side_effect=ValueError("pipeline missing"))

    result = service.confirm_import(import_id="imp-1", account=Mock(current_tenant_id="t1"))

    assert result.status == ImportStatus.FAILED


def test_append_workflow_export_data_skips_empty_node_data(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    workflow = Mock()
    workflow.graph_dict = {"nodes": []}
    workflow.to_dict.return_value = {"graph": {"nodes": [{"data": {}}, {}]}}
    session.scalar.return_value = workflow
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.generate_dependencies",
        return_value=[],
    )
    export_data = {}

    service._append_workflow_export_data(export_data=export_data, pipeline=Mock(tenant_id="t1"), include_secret=False)

    assert "workflow" in export_data


def test_extract_dependencies_from_workflow_graph_multiple_config_none(mocker) -> None:
    retrieval = Mock()
    retrieval.retrieval_mode = "multiple"
    retrieval.multiple_retrieval_config = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeRetrievalNodeData.model_validate",
        return_value=retrieval,
    )
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}}]}
    )

    assert result == []


def test_extract_dependencies_from_workflow_graph_single_config_none(mocker) -> None:
    retrieval = Mock()
    retrieval.retrieval_mode = "single"
    retrieval.single_retrieval_config = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeRetrievalNodeData.model_validate",
        return_value=retrieval,
    )
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}}]}
    )

    assert result == []


def test_create_or_update_pipeline_raises_when_workflow_missing() -> None:
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1", id="u1")

    with pytest.raises(ValueError, match="Missing workflow data for rag pipeline"):
        service._create_or_update_pipeline(pipeline=None, data={"rag_pipeline": {"name": "x"}}, account=account)


def test_import_rag_pipeline_with_pipeline_id_uses_existing_dataset(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    existing_dataset = Mock(id="d1", chunk_structure="text_model")
    existing_pipeline = Mock(id="p1", name="P", description="D", is_published=False)
    existing_pipeline.retrieve_dataset.return_value = existing_dataset
    session.scalar.return_value = existing_pipeline
    mocker.patch.object(service, "_create_or_update_pipeline", return_value=existing_pipeline)
    config = Mock()
    config.indexing_technique = "economy"
    config.keyword_number = 3
    config.chunk_structure = "text_model"
    config.summary_index_setting = {"enabled": True}
    config.retrieval_model.model_dump.return_value = {"top_k": 3}
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate", return_value=config
    )

    yaml_content = (
        "version: 0.1.0\n"
        "kind: rag_pipeline\n"
        "rag_pipeline: {name: x}\n"
        "workflow: {graph: {nodes: [{data: {type: knowledge-index}}]}}"
    )

    result = service.import_rag_pipeline(
        account=Mock(id="u1", current_tenant_id="t1"),
        import_mode="yaml-content",
        yaml_content=yaml_content,
        pipeline_id="p1",
    )

    assert result.status == ImportStatus.COMPLETED
    assert result.dataset_id == "d1"


def test_import_rag_pipeline_raises_for_chunk_structure_mismatch_on_published(mocker) -> None:
    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    existing_dataset = Mock(id="d1", chunk_structure="hierarchical_model")
    existing_pipeline = Mock(id="p1", name="P", description="D", is_published=True)
    existing_pipeline.retrieve_dataset.return_value = existing_dataset
    session.scalar.return_value = existing_pipeline
    mocker.patch.object(service, "_create_or_update_pipeline", return_value=existing_pipeline)
    config = Mock()
    config.chunk_structure = "text_model"
    config.indexing_technique = "economy"
    config.keyword_number = 3
    config.summary_index_setting = None
    config.retrieval_model.model_dump.return_value = {}
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate", return_value=config
    )

    yaml_content = (
        "version: 0.1.0\n"
        "kind: rag_pipeline\n"
        "rag_pipeline: {name: x}\n"
        "workflow: {graph: {nodes: [{data: {type: knowledge-index}}]}}"
    )

    result = service.import_rag_pipeline(
        account=Mock(id="u1", current_tenant_id="t1"),
        import_mode="yaml-content",
        yaml_content=yaml_content,
        pipeline_id="p1",
    )

    assert result.status == ImportStatus.FAILED
    assert "Chunk structure is not compatible" in result.error


def test_import_rag_pipeline_fails_when_no_knowledge_index_node(mocker) -> None:
    service = RagPipelineDslService(session=Mock())
    pipeline = Mock(id="p1", name="P", description="D", is_published=False)
    mocker.patch.object(service, "_create_or_update_pipeline", return_value=pipeline)

    yaml_content = (
        "version: 0.1.0\n"
        "kind: rag_pipeline\n"
        "rag_pipeline: {name: x}\n"
        "workflow: {graph: {nodes: [{data: {type: start}}]}}"
    )

    result = service.import_rag_pipeline(
        account=Mock(id="u1", current_tenant_id="t1"),
        import_mode="yaml-content",
        yaml_content=yaml_content,
    )

    assert result.status == ImportStatus.FAILED
    assert "Knowledge Index node" in result.error


def test_confirm_import_fails_when_no_knowledge_index_node(mocker) -> None:
    from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelinePendingData

    yaml_content = (
        "version: 0.1.0\n"
        "kind: rag_pipeline\n"
        "rag_pipeline: {name: x}\n"
        "workflow: {graph: {nodes: [{data: {type: start}}]}}"
    )

    pending = RagPipelinePendingData(
        import_mode="yaml-content",
        yaml_content=yaml_content,
        pipeline_id=None,
    )
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.redis_client.get", return_value=pending.model_dump_json()
    )
    service = RagPipelineDslService(session=Mock())
    pipeline = Mock(id="p1", name="P", description="D")
    pipeline.retrieve_dataset.return_value = None
    mocker.patch.object(service, "_create_or_update_pipeline", return_value=pipeline)

    result = service.confirm_import(import_id="imp-1", account=Mock(id="u1", current_tenant_id="t1"))

    assert result.status == ImportStatus.FAILED
    assert "Knowledge Index node" in result.error


def test_create_or_update_pipeline_saves_dependencies_to_redis(mocker) -> None:
    from core.plugin.entities.plugin import PluginDependency

    session = cast(MagicMock, Mock())
    service = RagPipelineDslService(session=cast(Session, session))
    account = Mock(id="u1", current_tenant_id="t1")
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.current_user", SimpleNamespace(id="u1"))
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Workflow", return_value=Mock(id="wf-1"))
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.select", return_value=MagicMock())
    pipeline_cls = mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Pipeline")
    pipeline = pipeline_cls.return_value
    pipeline.tenant_id = "t1"
    pipeline.id = "p1"
    session.scalar.return_value = None
    setex = mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.redis_client.setex")
    dependency = PluginDependency(
        type=PluginDependency.Type.Marketplace,
        value=PluginDependency.Marketplace(marketplace_plugin_unique_identifier="langgenius/example:0.1.0"),
    )

    service._create_or_update_pipeline(
        pipeline=None,
        data={"rag_pipeline": {"name": "x"}, "workflow": {"graph": {"nodes": []}}},
        account=account,
        dependencies=[dependency],
    )

    setex.assert_called_once()


def test_extract_dependencies_from_workflow_graph_knowledge_index_without_embedding_provider(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.DependenciesAnalysisService.analyze_model_provider_dependency",
        return_value="dep",
    )
    knowledge = Mock()
    knowledge.indexing_technique = "high_quality"
    knowledge.embedding_model_provider = None
    knowledge.retrieval_model.reranking_mode = "reranking_model"
    knowledge.retrieval_model.reranking_enable = False
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeConfiguration.model_validate", return_value=knowledge
    )
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": KNOWLEDGE_INDEX_NODE_TYPE}}]}
    )

    assert result == []


def test_extract_dependencies_from_workflow_graph_multiple_reranking_without_model(mocker) -> None:
    retrieval = Mock()
    retrieval.retrieval_mode = "multiple"
    retrieval.multiple_retrieval_config.reranking_mode = "reranking_model"
    retrieval.multiple_retrieval_config.reranking_model = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeRetrievalNodeData.model_validate",
        return_value=retrieval,
    )
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}}]}
    )

    assert result == []


def test_extract_dependencies_from_workflow_graph_multiple_weighted_without_weights(mocker) -> None:
    retrieval = Mock()
    retrieval.retrieval_mode = "multiple"
    retrieval.multiple_retrieval_config.reranking_mode = "weighted_score"
    retrieval.multiple_retrieval_config.weights = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_dsl_service.KnowledgeRetrievalNodeData.model_validate",
        return_value=retrieval,
    )
    service = RagPipelineDslService(session=Mock())

    result = service._extract_dependencies_from_workflow_graph(
        {"nodes": [{"data": {"type": BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL}}]}
    )

    assert result == []
