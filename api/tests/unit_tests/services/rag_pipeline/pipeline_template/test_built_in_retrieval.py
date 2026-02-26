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
