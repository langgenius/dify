import pytest
from sqlalchemy.orm import Session

from models.dataset import PipelineBuiltInTemplate
from services.rag_pipeline.pipeline_template.database.database_retrieval import DatabasePipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType

TEMPLATE_ID = "11111111-1111-1111-1111-111111111111"


def _template(
    *,
    template_id: str = TEMPLATE_ID,
    language: str = "en-US",
    name: str = "Template 1",
) -> PipelineBuiltInTemplate:
    template = PipelineBuiltInTemplate(
        name=name,
        description="desc",
        icon={"background": "#fff"},
        copyright="copyright",
        privacy_policy="https://example.com/privacy",
        position=1,
        chunk_structure="general",
        yaml_content="workflow:\n  graph:\n    nodes: []",
        install_count=0,
        language=language,
    )
    template.id = template_id
    return template


@pytest.mark.parametrize("sqlite_session", [(PipelineBuiltInTemplate,)], indirect=True)
def test_get_pipeline_templates(sqlite_session: Session) -> None:
    target = _template()
    wrong_language = _template(
        template_id="22222222-2222-2222-2222-222222222222",
        language="zh-Hans",
        name="Wrong Language",
    )
    sqlite_session.add_all([target, wrong_language])
    sqlite_session.commit()
    retrieval = DatabasePipelineTemplateRetrieval()

    result = retrieval.get_pipeline_templates("en-US", session=sqlite_session)

    assert retrieval.get_type() == PipelineTemplateType.DATABASE
    assert result == {
        "pipeline_templates": [
            {
                "id": TEMPLATE_ID,
                "name": "Template 1",
                "description": "desc",
                "icon": {"background": "#fff"},
                "copyright": "copyright",
                "privacy_policy": "https://example.com/privacy",
                "position": 1,
                "chunk_structure": "general",
            }
        ]
    }
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(PipelineBuiltInTemplate,)], indirect=True)
def test_get_pipeline_template_detail_returns_detail(sqlite_session: Session) -> None:
    sqlite_session.add(_template())
    sqlite_session.commit()
    retrieval = DatabasePipelineTemplateRetrieval()

    detail = retrieval.get_pipeline_template_detail(TEMPLATE_ID, session=sqlite_session)

    assert detail == {
        "id": TEMPLATE_ID,
        "name": "Template 1",
        "icon_info": {"background": "#fff"},
        "description": "desc",
        "chunk_structure": "general",
        "export_data": "workflow:\n  graph:\n    nodes: []",
        "graph": {"nodes": []},
    }
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(PipelineBuiltInTemplate,)], indirect=True)
def test_get_pipeline_template_detail_returns_none_when_not_found(sqlite_session: Session) -> None:
    retrieval = DatabasePipelineTemplateRetrieval()

    result = retrieval.get_pipeline_template_detail(TEMPLATE_ID, session=sqlite_session)

    assert result is None
    assert sqlite_session.in_transaction()
