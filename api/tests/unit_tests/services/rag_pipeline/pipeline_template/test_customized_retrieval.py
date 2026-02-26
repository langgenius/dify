from types import SimpleNamespace

from services.rag_pipeline.pipeline_template.customized.customized_retrieval import CustomizedPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


def test_get_pipeline_templates(mocker) -> None:
    mocker.patch(
        "services.rag_pipeline.pipeline_template.customized.customized_retrieval.current_account_with_tenant",
        return_value=("account-id", "tenant-id"),
    )
    customized_template = SimpleNamespace(
        id="tpl-1",
        name="Custom Template",
        description="desc",
        icon={"background": "#fff"},
        position=2,
        chunk_structure="parent-child",
    )
    query_mock = mocker.Mock()
    query_mock.where.return_value.order_by.return_value.all.return_value = [customized_template]
    mocker.patch(
        "services.rag_pipeline.pipeline_template.customized.customized_retrieval.db.session.query",
        return_value=query_mock,
    )
    retrieval = CustomizedPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_templates("en-US")

    assert retrieval.get_type() == PipelineTemplateType.CUSTOMIZED
    assert result == {
        "pipeline_templates": [
            {
                "id": "tpl-1",
                "name": "Custom Template",
                "description": "desc",
                "icon": {"background": "#fff"},
                "position": 2,
                "chunk_structure": "parent-child",
            }
        ]
    }


def test_get_pipeline_template_detail_returns_detail(mocker) -> None:
    query_mock = mocker.Mock()
    query_mock.where.return_value.first.return_value = SimpleNamespace(
        id="tpl-1",
        name="Custom Template",
        icon={"background": "#fff"},
        description="desc",
        chunk_structure="parent-child",
        yaml_content="workflow:\n  graph:\n    edges: []",
        created_user_name="creator",
    )
    mocker.patch(
        "services.rag_pipeline.pipeline_template.customized.customized_retrieval.db.session.query",
        return_value=query_mock,
    )
    retrieval = CustomizedPipelineTemplateRetrieval()

    detail = retrieval.get_pipeline_template_detail("tpl-1")

    assert detail == {
        "id": "tpl-1",
        "name": "Custom Template",
        "icon_info": {"background": "#fff"},
        "description": "desc",
        "chunk_structure": "parent-child",
        "export_data": "workflow:\n  graph:\n    edges: []",
        "graph": {"edges": []},
        "created_by": "creator",
    }


def test_get_pipeline_template_detail_returns_none_when_not_found(mocker) -> None:
    query_mock = mocker.Mock()
    query_mock.where.return_value.first.return_value = None
    mocker.patch(
        "services.rag_pipeline.pipeline_template.customized.customized_retrieval.db.session.query",
        return_value=query_mock,
    )
    retrieval = CustomizedPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_template_detail("missing")

    assert result is None
