from types import SimpleNamespace

import pytest

from services.rag_pipeline.rag_pipeline_transform_service import RagPipelineTransformService


@pytest.mark.parametrize(
    ("doc_form", "datasource_type", "indexing_technique"),
    [
        ("text_model", "upload_file", "high_quality"),
        ("text_model", "website_crawl", "economy"),
        ("hierarchical_model", "notion_import", None),
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


def test_deal_file_extensions_filters_and_normalizes_extensions() -> None:
    service = RagPipelineTransformService()
    node = {"data": {"fileExtensions": ["pdf", "TXT", "exe"]}}

    result = service._deal_file_extensions(node)

    assert result["data"]["fileExtensions"] == ["pdf", "txt"]


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
    add_mock = mocker.patch("services.rag_pipeline.rag_pipeline_transform_service.db.session.add")
    flush_mock = mocker.patch("services.rag_pipeline.rag_pipeline_transform_service.db.session.flush")
    commit_mock = mocker.patch("services.rag_pipeline.rag_pipeline_transform_service.db.session.commit")

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

    result = service._transform_to_empty_pipeline(dataset)

    assert result == {"pipeline_id": "pipeline-1", "dataset_id": "dataset-1", "status": "success"}
    assert dataset.pipeline_id == "pipeline-1"
    assert dataset.runtime_mode == "rag_pipeline"
    assert dataset.updated_by == "user-1"
    add_mock.assert_called()
    flush_mock.assert_called_once()
    commit_mock.assert_called_once()
