from unittest.mock import Mock

from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase


class DummyRetrieval(PipelineTemplateRetrievalBase):
    def get_pipeline_templates(self, session: Mock, language: str, current_tenant_id: str | None = None) -> dict:
        del session, current_tenant_id
        return {"language": language}

    def get_pipeline_template_detail(self, session: Mock, template_id: str) -> dict | None:
        del session
        return {"id": template_id}

    def get_type(self) -> str:
        return "dummy"


def test_pipeline_template_retrieval_base_concrete_implementation() -> None:
    retrieval = DummyRetrieval()
    session = Mock()

    assert retrieval.get_pipeline_templates(session, "en-US") == {"language": "en-US"}
    assert retrieval.get_pipeline_template_detail(session, "tpl-1") == {"id": "tpl-1"}
    assert retrieval.get_type() == "dummy"
