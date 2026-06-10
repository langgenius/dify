from services.rag_pipeline.pipeline_template.built_in.built_in_retrieval import BuiltInPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


def test_get_type() -> None:
    retrieval = BuiltInPipelineTemplateRetrieval()

    assert retrieval.get_type() == PipelineTemplateType.BUILTIN


def test_get_pipeline_templates(mocker) -> None:
    mocker.patch.object(
        BuiltInPipelineTemplateRetrieval,
        "_get_builtin_data",
        return_value={
            "pipeline_templates": {
                "en-US": {"pipeline_templates": [{"id": "tpl-1"}]},
                "tpl-1": {"id": "tpl-1", "name": "Template 1"},
            }
        },
    )
    retrieval = BuiltInPipelineTemplateRetrieval()

    templates = retrieval.get_pipeline_templates("en-US")

    assert templates == {"pipeline_templates": [{"id": "tpl-1"}]}


def test_get_pipeline_template_detail(mocker) -> None:
    mocker.patch.object(
        BuiltInPipelineTemplateRetrieval,
        "_get_builtin_data",
        return_value={
            "pipeline_templates": {
                "tpl-1": {"id": "tpl-1", "name": "Template 1"},
            }
        },
    )
    retrieval = BuiltInPipelineTemplateRetrieval()

    detail = retrieval.get_pipeline_template_detail("tpl-1")

    assert detail == {"id": "tpl-1", "name": "Template 1"}


def test_get_pipeline_templates_missing_language_returns_empty_dict(mocker) -> None:
    mocker.patch.object(
        BuiltInPipelineTemplateRetrieval,
        "_get_builtin_data",
        return_value={"pipeline_templates": {}},
    )
    retrieval = BuiltInPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_templates("fr-FR")

    assert result == {}


def test_get_pipeline_template_detail_returns_none_for_unknown_id(mocker) -> None:
    mocker.patch.object(
        BuiltInPipelineTemplateRetrieval,
        "_get_builtin_data",
        return_value={"pipeline_templates": {"tpl-1": {"id": "tpl-1"}}},
    )
    retrieval = BuiltInPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_template_detail("nonexistent-id")

    assert result is None


def test_get_builtin_data_reads_from_file_and_caches(mocker) -> None:
    import json

    # Ensure no cached data
    BuiltInPipelineTemplateRetrieval.builtin_data = None

    mock_app = mocker.Mock()
    mock_app.root_path = "/fake/root"

    mocker.patch(
        "services.rag_pipeline.pipeline_template.built_in.built_in_retrieval.current_app",
        mock_app,
    )

    test_data = {"pipeline_templates": {"en-US": {"templates": []}}}
    mocker.patch(
        "services.rag_pipeline.pipeline_template.built_in.built_in_retrieval.Path.read_text",
        return_value=json.dumps(test_data),
    )

    result = BuiltInPipelineTemplateRetrieval._get_builtin_data()

    assert result == test_data
    assert BuiltInPipelineTemplateRetrieval.builtin_data == test_data

    # Reset class state
    BuiltInPipelineTemplateRetrieval.builtin_data = None


def test_get_builtin_data_returns_cache_on_second_call(mocker) -> None:
    cached_data = {"pipeline_templates": {"en-US": {}}}
    BuiltInPipelineTemplateRetrieval.builtin_data = cached_data

    result = BuiltInPipelineTemplateRetrieval._get_builtin_data()

    assert result == cached_data

    # Reset class state
    BuiltInPipelineTemplateRetrieval.builtin_data = None
