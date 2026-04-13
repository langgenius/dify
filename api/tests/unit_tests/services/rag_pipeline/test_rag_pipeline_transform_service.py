from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast

import pytest

from models.dataset import Dataset
from services.entities.knowledge_entities.rag_pipeline_entities import KnowledgeConfiguration
from services.rag_pipeline.rag_pipeline_transform_service import RagPipelineTransformService


@pytest.mark.parametrize(
    ("doc_form", "datasource_type", "indexing_technique"),
    [
        ("text_model", "upload_file", "high_quality"),
        ("text_model", "upload_file", "economy"),
        ("text_model", "notion_import", "high_quality"),
        ("text_model", "notion_import", "economy"),
        ("text_model", "website_crawl", "high_quality"),
        ("text_model", "website_crawl", "economy"),
        ("hierarchical_model", "upload_file", None),
        ("hierarchical_model", "notion_import", None),
        ("hierarchical_model", "website_crawl", None),
    ],
)
def test_get_transform_yaml_returns_workflow(doc_form: str, datasource_type: str, indexing_technique: str | None):
    service = RagPipelineTransformService()

    result = service._get_transform_yaml(doc_form, datasource_type, indexing_technique)

    assert isinstance(result, dict)
    assert "workflow" in result


def test_get_transform_yaml_raises_for_unsupported_doc_form() -> None:
    service = RagPipelineTransformService()

    with pytest.raises(ValueError, match="Unsupported doc form"):
        service._get_transform_yaml("unknown", "upload_file", "high_quality")


@pytest.mark.parametrize("doc_form", ["text_model", "hierarchical_model"])
def test_get_transform_yaml_raises_for_unsupported_datasource_type(doc_form: str) -> None:
    service = RagPipelineTransformService()

    with pytest.raises(ValueError, match="Unsupported datasource type"):
        service._get_transform_yaml(doc_form, "unsupported", "high_quality")


def test_deal_file_extensions_filters_and_normalizes_extensions() -> None:
    service = RagPipelineTransformService()
    node = {"data": {"fileExtensions": ["pdf", "TXT", "exe"]}}

    result = service._deal_file_extensions(node)

    assert result["data"]["fileExtensions"] == ["pdf", "txt"]


def test_deal_file_extensions_returns_original_when_empty() -> None:
    service = RagPipelineTransformService()
    node = {"data": {"fileExtensions": []}}

    result = service._deal_file_extensions(node)

    assert result is node


def test_deal_dependencies_installs_missing_marketplace_plugins(mocker) -> None:
    service = RagPipelineTransformService()

    installer_cls = mocker.patch("services.rag_pipeline.rag_pipeline_transform_service.PluginInstaller")
    installer_cls.return_value.list_plugins.return_value = [SimpleNamespace(plugin_id="installed-plugin")]

    migration_cls = mocker.patch("services.rag_pipeline.rag_pipeline_transform_service.PluginMigration")
    migration_cls.return_value._fetch_plugin_unique_identifier.return_value = "missing-plugin:1.0.0"

    install_mock = mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.PluginService.install_from_marketplace_pkg"
    )

    pipeline_yaml = {
        "dependencies": [
            {"type": "marketplace", "value": {"plugin_unique_identifier": "installed-plugin:0.1.0"}},
            {"type": "marketplace", "value": {"plugin_unique_identifier": "missing-plugin:0.1.0"}},
        ]
    }

    service._deal_dependencies(pipeline_yaml, "tenant-1")

    install_mock.assert_called_once_with("tenant-1", ["missing-plugin:1.0.0"])


def test_transform_to_empty_pipeline_updates_dataset_and_commits(mocker) -> None:
    service = RagPipelineTransformService()
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.current_user",
        SimpleNamespace(id="user-1"),
    )

    class FakePipeline:
        def __init__(self, **kwargs):
            self.id = "pipeline-1"
            self.tenant_id = kwargs["tenant_id"]
            self.name = kwargs["name"]
            self.description = kwargs["description"]
            self.created_by = kwargs["created_by"]

    mocker.patch("services.rag_pipeline.rag_pipeline_transform_service.Pipeline", FakePipeline)
    session_mock = mocker.Mock()
    add_mock = session_mock.add
    flush_mock = session_mock.flush
    commit_mock = session_mock.commit
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    dataset = SimpleNamespace(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        description="desc",
        pipeline_id=None,
        runtime_mode="general",
        updated_by=None,
        updated_at=None,
    )

    result = service._transform_to_empty_pipeline(cast(Dataset, dataset))

    assert result == {"pipeline_id": "pipeline-1", "dataset_id": "dataset-1", "status": "success"}
    assert dataset.pipeline_id == "pipeline-1"
    assert dataset.runtime_mode == "rag_pipeline"
    assert dataset.updated_by == "user-1"
    add_mock.assert_called()
    flush_mock.assert_called_once()
    commit_mock.assert_called_once()


# --- transform_dataset ---


def test_transform_dataset_returns_early_when_pipeline_exists(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(
        id="d1",
        pipeline_id="p1",
        runtime_mode="rag_pipeline",
    )
    session_mock = mocker.Mock()
    session_mock.get.return_value = dataset
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    result = service.transform_dataset("d1")

    assert result == {"pipeline_id": "p1", "dataset_id": "d1", "status": "success"}


def test_transform_dataset_raises_for_dataset_not_found(mocker) -> None:
    service = RagPipelineTransformService()
    session_mock = mocker.Mock()
    session_mock.get.return_value = None
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    with pytest.raises(ValueError, match="Dataset not found"):
        service.transform_dataset("d1")


def test_transform_dataset_raises_for_external_dataset(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(
        id="d1",
        pipeline_id=None,
        runtime_mode=None,
        provider="external",
    )
    session_mock = mocker.Mock()
    session_mock.get.return_value = dataset
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    with pytest.raises(ValueError, match="External dataset is not supported"):
        service.transform_dataset("d1")


def test_transform_dataset_calls_empty_pipeline_when_no_datasource(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(
        id="d1",
        pipeline_id=None,
        runtime_mode=None,
        provider="vendor",
        data_source_type=None,
        indexing_technique=None,
    )
    session_mock = mocker.Mock()
    session_mock.get.return_value = dataset
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    empty_result = {"pipeline_id": "p-empty", "dataset_id": "d1", "status": "success"}
    mocker.patch.object(service, "_transform_to_empty_pipeline", return_value=empty_result)

    result = service.transform_dataset("d1")

    assert result == empty_result


def test_transform_dataset_calls_empty_pipeline_when_no_doc_form(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(
        id="d1",
        pipeline_id=None,
        runtime_mode=None,
        provider="vendor",
        data_source_type="upload_file",
        indexing_technique="high_quality",
        doc_form=None,
    )
    session_mock = mocker.Mock()
    session_mock.get.return_value = dataset
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    empty_result = {"pipeline_id": "p-empty", "dataset_id": "d1", "status": "success"}
    mocker.patch.object(service, "_transform_to_empty_pipeline", return_value=empty_result)

    result = service.transform_dataset("d1")

    assert result == empty_result


# --- _deal_knowledge_index ---


def test_deal_knowledge_index_high_quality_sets_embedding(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = cast(
        Dataset,
        SimpleNamespace(
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
            retrieval_model=None,
            summary_index_setting=None,
        ),
    )
    node = {
        "data": {
            "type": "knowledge-index",
            "indexing_technique": "high_quality",
            "embedding_model": "",
            "embedding_model_provider": "",
            "retrieval_model": {
                "search_method": "semantic_search",
                "reranking_enable": False,
                "reranking_mode": None,
                "reranking_model": None,
                "weights": None,
                "top_k": 3,
                "score_threshold_enabled": False,
                "score_threshold": None,
            },
            "chunk_structure": "text_model",
            "keyword_number": None,
            "summary_index_setting": None,
        }
    }

    # Create KnowledgeConfiguration from node data
    knowledge_configuration = KnowledgeConfiguration.model_validate(node.get("data", {}))
    retrieval_model = knowledge_configuration.retrieval_model

    result = service._deal_knowledge_index(
        knowledge_configuration,
        dataset,
        "high_quality",
        retrieval_model,
        node,
    )

    assert result["data"]["embedding_model"] == "text-embedding-ada-002"
    assert result["data"]["embedding_model_provider"] == "openai"


# --- _deal_document_data ---


def test_deal_document_data_notion(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(id="d1", pipeline_id="p1")
    doc = SimpleNamespace(
        id="doc1",
        dataset_id="d1",
        data_source_type="notion_import",
        data_source_info_dict={
            "notion_workspace_id": "ws1",
            "notion_page_id": "page1",
            "notion_page_icon": "icon1",
            "type": "page",
            "last_edited_time": 12345,
        },
        name="Notion Doc",
        created_by="u1",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        data_source_info=None,
    )

    scalars_mock = mocker.Mock()
    scalars_mock.all.return_value = [doc]
    session_mock = mocker.Mock()
    session_mock.scalars.return_value = scalars_mock
    add_mock = session_mock.add
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    service._deal_document_data(cast(Dataset, dataset))

    assert doc.data_source_type == "online_document"
    assert "page1" in doc.data_source_info
    assert add_mock.call_count == 2  # document + log


@pytest.mark.parametrize(("provider", "node_id"), [("firecrawl", "1752565402678"), ("jinareader", "1752491761974")])
def test_deal_document_data_website(mocker, provider: str, node_id: str) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(id="d1", pipeline_id="p1")
    doc = SimpleNamespace(
        id="doc1",
        dataset_id="d1",
        data_source_type="website_crawl",
        data_source_info_dict={
            "url": "https://example.com",
            "provider": provider,
        },
        name="Web Doc",
        created_by="u1",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        data_source_info=None,
    )

    scalars_mock = mocker.Mock()
    scalars_mock.all.return_value = [doc]
    session_mock = mocker.Mock()
    session_mock.scalars.return_value = scalars_mock
    add_mock = session_mock.add
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    service._deal_document_data(cast(Dataset, dataset))

    assert doc.data_source_type == "website_crawl"
    assert "example.com" in doc.data_source_info
    # Check if correct node id was used in log
    log = add_mock.call_args_list[1][0][0]
    assert log.datasource_node_id == node_id


# --- transform_dataset complex flow ---


def test_transform_dataset_full_flow(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(
        id="d1",
        tenant_id="t1",
        name="D",
        description="d",
        pipeline_id=None,
        runtime_mode=None,
        provider="vendor",
        data_source_type="upload_file",
        indexing_technique="high_quality",
        doc_form="text_model",
        retrieval_model={"search_method": "semantic_search", "top_k": 3},
        embedding_model="m1",
        embedding_model_provider="p1",
        summary_index_setting=None,
        chunk_structure=None,
    )

    session_mock = mocker.Mock()
    session_mock.get.return_value = dataset
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    mocker.patch.object(service, "_deal_dependencies")
    mocker.patch.object(service, "_deal_document_data")
    session_mock.commit = mocker.Mock()

    # Mock current_user to have the same tenant_id as dataset
    mock_current_user = SimpleNamespace(current_tenant_id="t1")
    mocker.patch("services.rag_pipeline.rag_pipeline_transform_service.current_user", mock_current_user)

    pipeline = SimpleNamespace(id="p-new")
    mocker.patch.object(service, "_create_pipeline", return_value=pipeline)

    result = service.transform_dataset("d1")

    assert result["pipeline_id"] == "p-new"
    assert dataset.runtime_mode == "rag_pipeline"
    assert dataset.chunk_structure == "text_model"


def test_transform_dataset_raises_for_unsupported_doc_form_after_pipeline_create(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(
        id="d1",
        tenant_id="t1",
        name="D",
        description="d",
        pipeline_id=None,
        runtime_mode=None,
        provider="vendor",
        data_source_type="upload_file",
        indexing_technique="high_quality",
        doc_form="unsupported",
        retrieval_model=None,
    )
    session_mock = mocker.Mock()
    session_mock.get.return_value = dataset
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )
    mocker.patch.object(service, "_get_transform_yaml", return_value={"workflow": {"graph": {"nodes": []}}})
    mocker.patch.object(service, "_deal_dependencies")
    mocker.patch.object(service, "_create_pipeline", return_value=SimpleNamespace(id="p-new"))

    with pytest.raises(ValueError, match="Unsupported doc form"):
        service.transform_dataset("d1")


def test_transform_dataset_raises_when_transform_yaml_missing_workflow(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(
        id="d1",
        tenant_id="t1",
        name="D",
        description="d",
        pipeline_id=None,
        runtime_mode=None,
        provider="vendor",
        data_source_type="upload_file",
        indexing_technique="high_quality",
        doc_form="text_model",
        retrieval_model=None,
    )
    session_mock = mocker.Mock()
    session_mock.get.return_value = dataset
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )
    mocker.patch.object(service, "_get_transform_yaml", return_value={})
    mocker.patch.object(service, "_deal_dependencies")

    with pytest.raises(ValueError, match="Missing workflow data for rag pipeline"):
        service.transform_dataset("d1")


def test_create_pipeline_raises_when_workflow_data_missing() -> None:
    service = RagPipelineTransformService()

    with pytest.raises(ValueError, match="Missing workflow data for rag pipeline"):
        service._create_pipeline({"rag_pipeline": {"name": "N"}})


def test_deal_document_data_upload_file_with_existing_file(mocker) -> None:
    service = RagPipelineTransformService()
    dataset = SimpleNamespace(id="d1", pipeline_id="p1")
    document = SimpleNamespace(
        id="doc-1",
        dataset_id="d1",
        data_source_type="upload_file",
        data_source_info_dict={"upload_file_id": "file-1"},
        name="Doc",
        created_by="u1",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        data_source_info=None,
    )
    upload_file = SimpleNamespace(name="f.txt", size=10, extension="txt", mime_type="text/plain")

    scalars_mock = mocker.Mock()
    scalars_mock.all.return_value = [document]
    session_mock = mocker.Mock()
    session_mock.scalars.return_value = scalars_mock
    session_mock.get.return_value = upload_file
    add_mock = session_mock.add
    mocker.patch(
        "services.rag_pipeline.rag_pipeline_transform_service.db",
        new=SimpleNamespace(session=session_mock),
    )

    service._deal_document_data(cast(Dataset, dataset))

    assert document.data_source_type == "local_file"
    assert "real_file_id" in document.data_source_info
    assert add_mock.call_count >= 2
