from types import SimpleNamespace

from services.rag_pipeline.pipeline_template.database.database_retrieval import DatabasePipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


def test_get_pipeline_templates(mocker) -> None:
    built_in_template = SimpleNamespace(
        id="tpl-1",
        name="Template 1",
        description="desc",
        icon={"background": "#fff"},
        copyright="copyright",
        privacy_policy="https://example.com/privacy",
        position=1,
        chunk_structure="general",
    )
    query_mock = mocker.Mock()
    query_mock.where.return_value.all.return_value = [built_in_template]
    mocker.patch(
        "services.rag_pipeline.pipeline_template.database.database_retrieval.db.session.query",
        return_value=query_mock,
    )
    retrieval = DatabasePipelineTemplateRetrieval()

    result = retrieval.get_pipeline_templates("en-US")

    assert retrieval.get_type() == PipelineTemplateType.DATABASE
    assert result == {
        "pipeline_templates": [
            {
                "id": "tpl-1",
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


def test_get_pipeline_template_detail_returns_detail(mocker) -> None:
    query_mock = mocker.Mock()
    query_mock.where.return_value.first.return_value = SimpleNamespace(
        id="tpl-1",
        name="Template 1",
        icon={"background": "#fff"},
        description="desc",
        chunk_structure="general",
        yaml_content="workflow:\n  graph:\n    nodes: []",
    )
    mocker.patch(
        "services.rag_pipeline.pipeline_template.database.database_retrieval.db.session.query",
        return_value=query_mock,
    )
    retrieval = DatabasePipelineTemplateRetrieval()

    detail = retrieval.get_pipeline_template_detail("tpl-1")

    assert detail == {
        "id": "tpl-1",
        "name": "Template 1",
        "icon_info": {"background": "#fff"},
        "description": "desc",
        "chunk_structure": "general",
        "export_data": "workflow:\n  graph:\n    nodes: []",
        "graph": {"nodes": []},
    }


def test_get_pipeline_template_detail_returns_none_when_not_found(mocker) -> None:
    query_mock = mocker.Mock()
    query_mock.where.return_value.first.return_value = None
    mocker.patch(
        "services.rag_pipeline.pipeline_template.database.database_retrieval.db.session.query",
        return_value=query_mock,
    )
    retrieval = DatabasePipelineTemplateRetrieval()

    result = retrieval.get_pipeline_template_detail("missing")

    assert result is None
