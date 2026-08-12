from types import SimpleNamespace

import pytest
from sqlalchemy.orm import Session

from models.account import Account
from models.dataset import PipelineCustomizedTemplate
from services.rag_pipeline.pipeline_template.customized.customized_retrieval import CustomizedPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType

TENANT_ID = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT_ID = "22222222-2222-2222-2222-222222222222"
CREATOR_ID = "33333333-3333-3333-3333-333333333333"
TEMPLATE_ID = "44444444-4444-4444-4444-444444444444"


def _template(
    *,
    template_id: str = TEMPLATE_ID,
    tenant_id: str = TENANT_ID,
    language: str = "en-US",
    name: str = "Custom Template",
) -> PipelineCustomizedTemplate:
    template = PipelineCustomizedTemplate(
        tenant_id=tenant_id,
        name=name,
        description="desc",
        icon={"background": "#fff"},
        position=2,
        chunk_structure="parent-child",
        yaml_content="workflow:\n  graph:\n    edges: []",
        install_count=0,
        language=language,
        created_by=CREATOR_ID,
    )
    template.id = template_id
    return template


@pytest.mark.parametrize("sqlite_session", [(PipelineCustomizedTemplate,)], indirect=True)
def test_get_pipeline_templates(sqlite_session: Session) -> None:
    target = _template()
    wrong_language = _template(
        template_id="55555555-5555-5555-5555-555555555555",
        language="zh-Hans",
        name="Wrong Language",
    )
    other_tenant = _template(
        template_id="66666666-6666-6666-6666-666666666666",
        tenant_id=OTHER_TENANT_ID,
        name="Other Tenant",
    )
    sqlite_session.add_all([target, wrong_language, other_tenant])
    sqlite_session.commit()
    retrieval = CustomizedPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_templates("en-US", TENANT_ID, session=sqlite_session)

    assert retrieval.get_type() == PipelineTemplateType.CUSTOMIZED
    assert result == {
        "pipeline_templates": [
            {
                "id": TEMPLATE_ID,
                "name": "Custom Template",
                "description": "desc",
                "icon": {"background": "#fff"},
                "position": 2,
                "chunk_structure": "parent-child",
            }
        ]
    }
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(Account, PipelineCustomizedTemplate)], indirect=True)
def test_get_pipeline_template_detail_returns_detail(monkeypatch: pytest.MonkeyPatch, sqlite_session: Session) -> None:
    creator = Account(name="creator", email="creator@example.com")
    creator.id = CREATOR_ID
    sqlite_session.add_all([creator, _template()])
    sqlite_session.commit()
    monkeypatch.setattr("models.dataset.db", SimpleNamespace(session=sqlite_session))
    retrieval = CustomizedPipelineTemplateRetrieval()

    detail = retrieval.get_pipeline_template_detail(TEMPLATE_ID, session=sqlite_session)

    assert detail == {
        "id": TEMPLATE_ID,
        "name": "Custom Template",
        "icon_info": {"background": "#fff"},
        "description": "desc",
        "chunk_structure": "parent-child",
        "export_data": "workflow:\n  graph:\n    edges: []",
        "graph": {"edges": []},
        "created_by": "creator",
    }
    assert sqlite_session.in_transaction()


@pytest.mark.parametrize("sqlite_session", [(PipelineCustomizedTemplate,)], indirect=True)
def test_get_pipeline_template_detail_returns_none_when_not_found(sqlite_session: Session) -> None:
    retrieval = CustomizedPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_template_detail(TEMPLATE_ID, session=sqlite_session)

    assert result is None
    assert sqlite_session.in_transaction()
