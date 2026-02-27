from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import yaml

from core.workflow.enums import NodeType
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
    from core.workflow.enums import NodeType

    graph = {"nodes": [{"data": {"type": NodeType.TOOL}}]}

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

    result = service.import_rag_pipeline(account=account, import_mode="yaml-url", yaml_url="https://example.com/dsl.yml")

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
    
    service = RagPipelineDslService(session=Mock())
    service._session.query.return_value.filter_by.return_value.all.return_value = []
    account = Mock(current_tenant_id="t1")

    result = service.import_rag_pipeline(account=account, import_mode="yaml-content", yaml_content=yaml_content)

    if result.status == ImportStatus.FAILED:
        print(f"DEBUG: {result.error}")
    assert result.status == ImportStatus.COMPLETED


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


# --- _extract_dependencies_from_workflow_graph all types ---


@pytest.mark.parametrize(
    "node_type",
    [
        NodeType.TOOL,
        NodeType.LLM,
        NodeType.KNOWLEDGE_RETRIEVAL,
        NodeType.PARAMETER_EXTRACTOR,
        NodeType.QUESTION_CLASSIFIER,
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
    service = RagPipelineDslService(session=Mock())
    account = Mock(current_tenant_id="t1", id="u1")
    data = {
        "rag_pipeline": {"name": "New", "description": "desc"},
        "workflow": {"graph": {"nodes": []}},
    }

    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.current_user", SimpleNamespace(id="u1"))
    mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Workflow", return_value=Mock())
    pipeline_cls = mocker.patch("services.rag_pipeline.rag_pipeline_dsl_service.Pipeline")
    pipeline_instance = pipeline_cls.return_value
    pipeline_instance.tenant_id = "t1"
    pipeline_instance.id = "p1"
    pipeline_instance.name = "P"
    pipeline_instance.is_published = False

    result = service._create_or_update_pipeline(pipeline=None, data=data, account=account, dependencies=[])

    assert result == pipeline_instance
    service._session.add.assert_called()


# --- export_rag_pipeline_dsl comprehensive ---


def test_export_rag_pipeline_dsl_with_workflow(mocker) -> None:
    service = RagPipelineDslService(session=Mock())
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
    
    # Mocking single .where() call
    service._session.query.return_value.where.return_value.first.return_value = workflow
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
    graph = {"nodes": [{"data": {"type": NodeType.DATASOURCE}}]}

    result = service._extract_dependencies_from_workflow_graph(graph)

    assert "ds1" in result
