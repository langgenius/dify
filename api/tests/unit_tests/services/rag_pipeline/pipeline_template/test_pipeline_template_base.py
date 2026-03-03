import pytest

from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase


class DummyRetrieval(PipelineTemplateRetrievalBase):
    def get_pipeline_templates(self, language: str) -> dict:
        return {"language": language}

    def get_pipeline_template_detail(self, template_id: str) -> dict | None:
        return {"id": template_id}

    def get_type(self) -> str:
        return "dummy"


class MissingTypeRetrieval(PipelineTemplateRetrievalBase):
    def get_pipeline_templates(self, language: str) -> dict:
        return {"language": language}

    def get_pipeline_template_detail(self, template_id: str) -> dict | None:
        return {"id": template_id}


def test_pipeline_template_retrieval_base_concrete_implementation() -> None:
    retrieval = DummyRetrieval()

    assert retrieval.get_pipeline_templates("en-US") == {"language": "en-US"}
    assert retrieval.get_pipeline_template_detail("tpl-1") == {"id": "tpl-1"}
    assert retrieval.get_type() == "dummy"


def test_pipeline_template_retrieval_base_requires_abstract_methods() -> None:
    assert "get_type" in MissingTypeRetrieval.__abstractmethods__


def test_pipeline_template_retrieval_base_default_methods_raise() -> None:
    with pytest.raises(NotImplementedError):
        PipelineTemplateRetrievalBase.get_pipeline_templates(DummyRetrieval(), "en-US")
    with pytest.raises(NotImplementedError):
        PipelineTemplateRetrievalBase.get_pipeline_template_detail(DummyRetrieval(), "tpl-1")
    with pytest.raises(NotImplementedError):
        PipelineTemplateRetrievalBase.get_type(DummyRetrieval())
