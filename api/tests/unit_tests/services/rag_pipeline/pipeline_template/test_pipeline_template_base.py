from unittest.mock import Mock

from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase


class DummyRetrieval(PipelineTemplateRetrievalBase):
    def get_pipeline_templates(self, language: str, *, session) -> dict:
        del session
        return {"language": language}

    def get_pipeline_template_detail(self, template_id: str, *, session) -> dict | None:
        del session
        return {"id": template_id}

    def get_type(self) -> str:
        return "dummy"


def test_pipeline_template_retrieval_base_concrete_implementation() -> None:
    retrieval = DummyRetrieval()
    session = Mock()

    assert retrieval.get_pipeline_templates("en-US", session=session) == {"language": "en-US"}
    assert retrieval.get_pipeline_template_detail("tpl-1", session=session) == {"id": "tpl-1"}
    assert retrieval.get_type() == "dummy"
