import pytest
from sqlalchemy.orm import Session

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


@pytest.mark.parametrize("sqlite_session", [()], indirect=True)
def test_pipeline_template_retrieval_base_concrete_implementation(sqlite_session: Session) -> None:
    retrieval = DummyRetrieval()

    assert retrieval.get_pipeline_templates("en-US", session=sqlite_session) == {"language": "en-US"}
    assert retrieval.get_pipeline_template_detail("tpl-1", session=sqlite_session) == {"id": "tpl-1"}
    assert retrieval.get_type() == "dummy"
    assert not sqlite_session.in_transaction()
