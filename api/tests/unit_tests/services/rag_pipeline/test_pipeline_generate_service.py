from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from services.rag_pipeline.pipeline_generate_service import PipelineGenerateService


def test_get_max_active_requests_uses_smallest_non_zero_limit(mocker) -> None:
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_DEFAULT_ACTIVE_REQUESTS", 5)
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_MAX_ACTIVE_REQUESTS", 3)

    app_model = SimpleNamespace(max_active_requests=10)

    result = PipelineGenerateService._get_max_active_requests(app_model)

    assert result == 3


def test_get_max_active_requests_returns_zero_when_all_unlimited(mocker) -> None:
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_DEFAULT_ACTIVE_REQUESTS", 0)
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_MAX_ACTIVE_REQUESTS", 0)

    app_model = SimpleNamespace(max_active_requests=0)

    result = PipelineGenerateService._get_max_active_requests(app_model)

    assert result == 0


@pytest.mark.parametrize(
    ("invoke_from", "workflow", "expected_error"),
    [
        (InvokeFrom.DEBUGGER, None, "Workflow not initialized"),
        (InvokeFrom.WEB_APP, None, "Workflow not published"),
        (InvokeFrom.DEBUGGER, SimpleNamespace(id="wf-1"), None),
    ],
)
def test_get_workflow(mocker, invoke_from, workflow, expected_error) -> None:
    rag_pipeline_service_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.RagPipelineService")
    rag_pipeline_service = rag_pipeline_service_cls.return_value
    rag_pipeline_service.get_draft_workflow.return_value = workflow
    rag_pipeline_service.get_published_workflow.return_value = workflow

    pipeline = SimpleNamespace(id="pipeline-1")

    if expected_error:
        with pytest.raises(ValueError, match=expected_error):
            PipelineGenerateService._get_workflow(pipeline, invoke_from)
    else:
        result = PipelineGenerateService._get_workflow(pipeline, invoke_from)
        assert result == workflow


def test_generate_updates_document_status_and_returns_event_stream(mocker) -> None:
    pipeline = SimpleNamespace(id="pipeline-1")
    user = SimpleNamespace(id="user-1")
    args = {"original_document_id": "doc-1", "query": "hello"}

    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=SimpleNamespace(id="wf-1"))
    update_status_mock = mocker.patch.object(PipelineGenerateService, "update_document_status")

    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")
    generator_instance = generator_cls.return_value
    generator_instance.generate.return_value = "raw-events"
    generator_cls.convert_to_event_stream.return_value = "stream-events"

    result = PipelineGenerateService.generate(
        pipeline=pipeline,
        user=user,
        args=args,
        invoke_from=InvokeFrom.WEB_APP,
        streaming=True,
    )

    assert result == "stream-events"
    update_status_mock.assert_called_once_with("doc-1")


def test_update_document_status_updates_existing_document(mocker) -> None:
    document = SimpleNamespace(indexing_status="completed")

    query_mock = mocker.Mock()
    query_mock.where.return_value.first.return_value = document
    mocker.patch("services.rag_pipeline.pipeline_generate_service.db.session.query", return_value=query_mock)
    add_mock = mocker.patch("services.rag_pipeline.pipeline_generate_service.db.session.add")
    commit_mock = mocker.patch("services.rag_pipeline.pipeline_generate_service.db.session.commit")

    PipelineGenerateService.update_document_status("doc-1")

    assert document.indexing_status == "waiting"
    add_mock.assert_called_once_with(document)
    commit_mock.assert_called_once()


def test_update_document_status_skips_when_document_missing(mocker) -> None:
    query_mock = mocker.Mock()
    query_mock.where.return_value.first.return_value = None
    mocker.patch("services.rag_pipeline.pipeline_generate_service.db.session.query", return_value=query_mock)
    add_mock = mocker.patch("services.rag_pipeline.pipeline_generate_service.db.session.add")
    commit_mock = mocker.patch("services.rag_pipeline.pipeline_generate_service.db.session.commit")

    PipelineGenerateService.update_document_status("missing")

    add_mock.assert_not_called()
    commit_mock.assert_not_called()


# --- generate_single_iteration ---


def test_generate_single_iteration_delegates(mocker) -> None:
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=SimpleNamespace(id="wf-1"))

    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")
    generator_instance = generator_cls.return_value
    generator_instance.single_iteration_generate.return_value = "raw-iter"
    generator_cls.convert_to_event_stream.return_value = "stream-iter"

    pipeline = SimpleNamespace(id="p1")
    user = SimpleNamespace(id="u1")

    result = PipelineGenerateService.generate_single_iteration(pipeline, user, "node-1", {"key": "val"})

    assert result == "stream-iter"
    generator_instance.single_iteration_generate.assert_called_once()


# --- generate_single_loop ---


def test_generate_single_loop_delegates(mocker) -> None:
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=SimpleNamespace(id="wf-1"))

    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")
    generator_instance = generator_cls.return_value
    generator_instance.single_loop_generate.return_value = "raw-loop"
    generator_cls.convert_to_event_stream.return_value = "stream-loop"

    pipeline = SimpleNamespace(id="p1")
    user = SimpleNamespace(id="u1")

    result = PipelineGenerateService.generate_single_loop(pipeline, user, "node-1", {"key": "val"})

    assert result == "stream-loop"
    generator_instance.single_loop_generate.assert_called_once()
