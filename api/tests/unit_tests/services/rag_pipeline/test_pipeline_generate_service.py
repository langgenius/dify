from types import SimpleNamespace
from typing import cast

import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import InvokeFrom
from models.dataset import Pipeline
from models.model import Account, App, EndUser
from services.rag_pipeline.pipeline_generate_service import PipelineGenerateService


def test_get_max_active_requests_uses_smallest_non_zero_limit(mocker: MockerFixture) -> None:
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_DEFAULT_ACTIVE_REQUESTS", 5)
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_MAX_ACTIVE_REQUESTS", 3)

    app_model = cast(App, SimpleNamespace(max_active_requests=10))

    result = PipelineGenerateService._get_max_active_requests(app_model)

    assert result == 3


def test_get_max_active_requests_returns_zero_when_all_unlimited(mocker: MockerFixture) -> None:
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_DEFAULT_ACTIVE_REQUESTS", 0)
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_MAX_ACTIVE_REQUESTS", 0)

    app_model = cast(App, SimpleNamespace(max_active_requests=0))

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
def test_get_workflow(mocker: MockerFixture, invoke_from, workflow, expected_error) -> None:
    rag_pipeline_service_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.RagPipelineService")
    rag_pipeline_service = rag_pipeline_service_cls.return_value
    rag_pipeline_service.get_draft_workflow.return_value = workflow
    rag_pipeline_service.get_published_workflow.return_value = workflow

    pipeline = cast(Pipeline, SimpleNamespace(id="pipeline-1"))
    session = mocker.Mock()

    if expected_error:
        with pytest.raises(ValueError, match=expected_error):
            PipelineGenerateService._get_workflow(pipeline, invoke_from, session)
    else:
        result = PipelineGenerateService._get_workflow(pipeline, invoke_from, session)
        assert result == workflow


def test_generate_updates_document_status_and_returns_event_stream(mocker: MockerFixture) -> None:
    pipeline = cast(Pipeline, SimpleNamespace(id="pipeline-1"))
    user = cast(Account | EndUser, SimpleNamespace(id="user-1"))
    args = {"original_document_id": "doc-1", "query": "hello"}
    session_mock = mocker.Mock()

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
        session=session_mock,
    )

    assert result == "stream-events"
    update_status_mock.assert_called_once_with("doc-1", session=session_mock)


def test_update_document_status_updates_existing_document(mocker: MockerFixture) -> None:
    document = SimpleNamespace(indexing_status="completed")

    session_mock = mocker.Mock()
    session_mock.get.return_value = document
    add_mock = session_mock.add

    PipelineGenerateService.update_document_status("doc-1", session=session_mock)

    assert document.indexing_status == "waiting"
    add_mock.assert_called_once_with(document)


def test_update_document_status_skips_when_document_missing(mocker: MockerFixture) -> None:
    session_mock = mocker.Mock()
    session_mock.get.return_value = None
    add_mock = session_mock.add

    PipelineGenerateService.update_document_status("missing", session=session_mock)

    add_mock.assert_not_called()


# --- generate_single_iteration ---


def test_generate_single_iteration_delegates(mocker: MockerFixture) -> None:
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=SimpleNamespace(id="wf-1"))

    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")
    generator_instance = generator_cls.return_value
    generator_instance.single_iteration_generate.return_value = "raw-iter"
    generator_cls.convert_to_event_stream.return_value = "stream-iter"

    pipeline = cast(Pipeline, SimpleNamespace(id="p1"))
    user = cast(Account, SimpleNamespace(id="u1"))
    session = mocker.Mock()

    result = PipelineGenerateService.generate_single_iteration(pipeline, user, "node-1", {"key": "val"}, session)

    assert result == "stream-iter"
    generator_instance.single_iteration_generate.assert_called_once()


# --- generate_single_loop ---


def test_generate_single_loop_delegates(mocker: MockerFixture) -> None:
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=SimpleNamespace(id="wf-1"))

    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")
    generator_instance = generator_cls.return_value
    generator_instance.single_loop_generate.return_value = "raw-loop"
    generator_cls.convert_to_event_stream.return_value = "stream-loop"

    pipeline = cast(Pipeline, SimpleNamespace(id="p1"))
    user = cast(Account, SimpleNamespace(id="u1"))
    session = mocker.Mock()

    result = PipelineGenerateService.generate_single_loop(pipeline, user, "node-1", {"key": "val"}, session)

    assert result == "stream-loop"
    generator_instance.single_loop_generate.assert_called_once()
