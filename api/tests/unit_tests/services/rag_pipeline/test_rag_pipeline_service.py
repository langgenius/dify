from types import SimpleNamespace

import pytest

from services.rag_pipeline.rag_pipeline import RagPipelineService


@pytest.fixture
def rag_pipeline_service(mocker) -> RagPipelineService:
    mocker.patch(
        "services.rag_pipeline.rag_pipeline.DifyAPIRepositoryFactory"
        ".create_api_workflow_node_execution_repository",
        return_value=MockRepo(),
    )
    mocker.patch(
        "services.rag_pipeline.rag_pipeline.DifyAPIRepositoryFactory.create_api_workflow_run_repository",
        return_value=MockRepo(),
    )
    return RagPipelineService(session_maker=SimpleNamespace())


class MockRepo:
    pass


def test_get_pipeline_templates_fallbacks_to_builtin_for_non_english_empty_result(mocker) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline.dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_MODE", "remote")

    remote_retrieval = mocker.Mock()
    remote_retrieval.get_pipeline_templates.return_value = {"pipeline_templates": []}

    factory_mock = mocker.patch("services.rag_pipeline.rag_pipeline.PipelineTemplateRetrievalFactory")
    factory_mock.get_pipeline_template_factory.return_value.return_value = remote_retrieval

    builtin_retrieval = mocker.Mock()
    builtin_retrieval.fetch_pipeline_templates_from_builtin.return_value = {
        "pipeline_templates": [{"id": "builtin-1"}]
    }
    factory_mock.get_built_in_pipeline_template_retrieval.return_value = builtin_retrieval

    result = RagPipelineService.get_pipeline_templates(type="built-in", language="ja-JP")

    assert result == {"pipeline_templates": [{"id": "builtin-1"}]}
    builtin_retrieval.fetch_pipeline_templates_from_builtin.assert_called_once_with("en-US")


def test_get_pipeline_templates_customized_mode_uses_customized_factory(mocker) -> None:
    retrieval = mocker.Mock()
    retrieval.get_pipeline_templates.return_value = {"pipeline_templates": [{"id": "custom-1"}]}

    factory_mock = mocker.patch("services.rag_pipeline.rag_pipeline.PipelineTemplateRetrievalFactory")
    factory_mock.get_pipeline_template_factory.return_value.return_value = retrieval

    result = RagPipelineService.get_pipeline_templates(type="customized", language="en-US")

    assert result == {"pipeline_templates": [{"id": "custom-1"}]}
    factory_mock.get_pipeline_template_factory.assert_called_with("customized")


@pytest.mark.parametrize("template_type", ["built-in", "customized"])
def test_get_pipeline_template_detail_uses_expected_mode(mocker, template_type: str) -> None:
    mocker.patch("services.rag_pipeline.rag_pipeline.dify_config.HOSTED_FETCH_PIPELINE_TEMPLATES_MODE", "remote")
    retrieval = mocker.Mock()
    retrieval.get_pipeline_template_detail.return_value = {"id": "tpl-1"}

    factory_mock = mocker.patch("services.rag_pipeline.rag_pipeline.PipelineTemplateRetrievalFactory")
    factory_mock.get_pipeline_template_factory.return_value.return_value = retrieval

    result = RagPipelineService.get_pipeline_template_detail("tpl-1", type=template_type)

    assert result == {"id": "tpl-1"}
    expected_mode = "remote" if template_type == "built-in" else "customized"
    factory_mock.get_pipeline_template_factory.assert_called_with(expected_mode)


def test_get_published_workflow_returns_none_when_pipeline_has_no_workflow_id(rag_pipeline_service) -> None:
    pipeline = SimpleNamespace(workflow_id=None)

    result = rag_pipeline_service.get_published_workflow(pipeline)

    assert result is None


def test_get_all_published_workflow_returns_empty_for_unpublished_pipeline(rag_pipeline_service) -> None:
    pipeline = SimpleNamespace(workflow_id=None)
    session = SimpleNamespace()

    workflows, has_more = rag_pipeline_service.get_all_published_workflow(
        session=session,
        pipeline=pipeline,
        page=1,
        limit=20,
        user_id=None,
        named_only=False,
    )

    assert workflows == []
    assert has_more is False


def test_get_all_published_workflow_applies_limit_and_has_more(rag_pipeline_service) -> None:
    scalars_result = SimpleNamespace(all=lambda: ["wf1", "wf2", "wf3"])
    session = SimpleNamespace(scalars=lambda stmt: scalars_result)
    pipeline = SimpleNamespace(id="pipeline-1", workflow_id="wf-live")

    workflows, has_more = rag_pipeline_service.get_all_published_workflow(
        session=session,
        pipeline=pipeline,
        page=1,
        limit=2,
        user_id="user-1",
        named_only=True,
    )

    assert workflows == ["wf1", "wf2"]
    assert has_more is True


def test_get_pipeline_raises_when_dataset_not_found(mocker, rag_pipeline_service) -> None:
    first_query = mocker.Mock()
    first_query.where.return_value.first.return_value = None
    mocker.patch("services.rag_pipeline.rag_pipeline.db.session.query", return_value=first_query)

    with pytest.raises(ValueError, match="Dataset not found"):
        rag_pipeline_service.get_pipeline("tenant-1", "dataset-1")
