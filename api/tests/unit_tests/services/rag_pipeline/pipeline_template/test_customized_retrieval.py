from types import SimpleNamespace

from pytest_mock import MockerFixture

from services.rag_pipeline.pipeline_template.customized.customized_retrieval import CustomizedPipelineTemplateRetrieval
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


def test_get_pipeline_templates(mocker: MockerFixture) -> None:
    customized_template = SimpleNamespace(
        id="tpl-1",
        name="Custom Template",
        description="desc",
        icon={"background": "#fff"},
        position=2,
        chunk_structure="parent-child",
    )
    scalars_mock = mocker.Mock()
    scalars_mock.all.return_value = [customized_template]
    session_mock = mocker.Mock()
    session_mock.scalars.return_value = scalars_mock
    retrieval = CustomizedPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_templates("en-US", "tenant-id", session=session_mock)

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


def test_get_pipeline_template_detail_returns_detail(mocker: MockerFixture) -> None:
    session_mock = mocker.Mock()
    session_mock.get.return_value = SimpleNamespace(
        id="tpl-1",
        name="Custom Template",
        icon={"background": "#fff"},
        description="desc",
        chunk_structure="parent-child",
        yaml_content="workflow:\n  graph:\n    edges: []",
        created_user_name="creator",
    )
    retrieval = CustomizedPipelineTemplateRetrieval()

    detail = retrieval.get_pipeline_template_detail("tpl-1", session=session_mock)

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


def test_get_pipeline_template_detail_returns_none_when_not_found(mocker: MockerFixture) -> None:
    session_mock = mocker.Mock()
    session_mock.get.return_value = None
    retrieval = CustomizedPipelineTemplateRetrieval()

    result = retrieval.get_pipeline_template_detail("missing", session=session_mock)

    assert result is None
