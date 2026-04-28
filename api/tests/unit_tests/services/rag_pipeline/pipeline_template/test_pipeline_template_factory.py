import pytest

from services.rag_pipeline.pipeline_template.built_in.built_in_retrieval import BuiltInPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.customized.customized_retrieval import CustomizedPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.database.database_retrieval import DatabasePipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_factory import PipelineTemplateRetrievalFactory
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType
from services.rag_pipeline.pipeline_template.remote.remote_retrieval import RemotePipelineTemplateRetrieval


@pytest.mark.parametrize(
    ("mode", "expected_cls"),
    [
        (PipelineTemplateType.REMOTE, RemotePipelineTemplateRetrieval),
        (PipelineTemplateType.CUSTOMIZED, CustomizedPipelineTemplateRetrieval),
        (PipelineTemplateType.DATABASE, DatabasePipelineTemplateRetrieval),
        (PipelineTemplateType.BUILTIN, BuiltInPipelineTemplateRetrieval),
    ],
)
def test_get_pipeline_template_factory(mode: str, expected_cls: type) -> None:
    result = PipelineTemplateRetrievalFactory.get_pipeline_template_factory(mode)

    assert result is expected_cls


def test_get_pipeline_template_factory_invalid_mode() -> None:
    with pytest.raises(ValueError):
        PipelineTemplateRetrievalFactory.get_pipeline_template_factory("invalid")


def test_get_built_in_pipeline_template_retrieval() -> None:
    result = PipelineTemplateRetrievalFactory.get_built_in_pipeline_template_retrieval()

    assert result is BuiltInPipelineTemplateRetrieval
