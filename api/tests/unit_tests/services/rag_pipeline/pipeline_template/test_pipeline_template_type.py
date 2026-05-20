from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


def test_pipeline_template_type_values() -> None:
    assert PipelineTemplateType.REMOTE == "remote"
    assert PipelineTemplateType.DATABASE == "database"
    assert PipelineTemplateType.CUSTOMIZED == "customized"
    assert PipelineTemplateType.BUILTIN == "builtin"
