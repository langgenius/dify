from types import SimpleNamespace
from typing import cast

import pytest
from pytest_mock import MockerFixture

from core.app.entities.app_invoke_entities import InvokeFrom
from models.dataset import Dataset, Pipeline
from models.model import Account, App, EndUser
from services.dataset_ref_service import DatasetRefService
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
    dataset = cast(Dataset, SimpleNamespace(id="dataset-1", tenant_id="tenant-1"))
    pipeline = cast(
        Pipeline,
        SimpleNamespace(
            id="pipeline-1",
            tenant_id="tenant-1",
            retrieve_dataset=mocker.Mock(return_value=dataset),
        ),
    )
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
    document_ref = update_status_mock.call_args.args[0]
    assert document_ref.dataset.tenant_id == "tenant-1"
    assert document_ref.dataset.dataset_id == "dataset-1"
    assert document_ref.document_id == "doc-1"
    update_status_mock.assert_called_once_with(document_ref, session=session_mock)
    assert generator_instance.generate.call_args.kwargs["session"] is session_mock


def test_generate_rejects_pipeline_dataset_from_another_tenant(mocker: MockerFixture) -> None:
    dataset = cast(Dataset, SimpleNamespace(id="dataset-1", tenant_id="tenant-2"))
    pipeline = cast(
        Pipeline,
        SimpleNamespace(
            id="pipeline-1",
            tenant_id="tenant-1",
            retrieve_dataset=mocker.Mock(return_value=dataset),
        ),
    )
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=SimpleNamespace(id="wf-1"))
    update_status_mock = mocker.patch.object(PipelineGenerateService, "update_document_status")

    with pytest.raises(ValueError, match="Pipeline dataset is required"):
        PipelineGenerateService.generate(
            pipeline=pipeline,
            user=cast(Account, SimpleNamespace(id="user-1")),
            args={"original_document_id": "doc-1"},
            invoke_from=InvokeFrom.WEB_APP,
            session=mocker.Mock(),
        )

    update_status_mock.assert_not_called()


def test_generate_rejects_original_document_outside_pipeline_dataset_before_dispatch(
    mocker: MockerFixture,
) -> None:
    dataset = cast(Dataset, SimpleNamespace(id="dataset-1", tenant_id="tenant-1"))
    pipeline = cast(
        Pipeline,
        SimpleNamespace(
            id="pipeline-1",
            tenant_id="tenant-1",
            retrieve_dataset=mocker.Mock(return_value=dataset),
        ),
    )
    session = mocker.Mock()
    session.scalar.return_value = None
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=SimpleNamespace(id="wf-1"))
    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")

    with pytest.raises(ValueError, match="Pipeline document not found"):
        PipelineGenerateService.generate(
            pipeline=pipeline,
            user=cast(Account, SimpleNamespace(id="user-1")),
            args={"original_document_id": "foreign-doc"},
            invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
            session=session,
        )

    statement = session.scalar.call_args.args[0]
    assert {"foreign-doc", "dataset-1", "tenant-1"} <= set(statement.compile().params.values())
    generator_cls.assert_not_called()


def test_update_document_status_updates_existing_document(mocker: MockerFixture) -> None:
    document = SimpleNamespace(indexing_status="completed")
    dataset = cast(Dataset, SimpleNamespace(id="dataset-1", tenant_id="tenant-1"))
    dataset_ref = DatasetRefService.create_dataset_ref(dataset)
    document_ref = DatasetRefService.create_document_ref_from_id(dataset_ref, "doc-1")

    session_mock = mocker.Mock()
    get_document_mock = mocker.patch.object(DatasetRefService, "get_document_by_ref", return_value=document)
    add_mock = session_mock.add

    PipelineGenerateService.update_document_status(document_ref, session=session_mock)

    assert document.indexing_status == "waiting"
    get_document_mock.assert_called_once_with(document_ref, session=session_mock)
    add_mock.assert_called_once_with(document)


@pytest.mark.parametrize(
    ("document_tenant_id", "document_dataset_id"),
    [
        pytest.param("other-tenant", "dataset-1", id="other-tenant"),
        pytest.param("tenant-1", "other-dataset", id="other-dataset"),
    ],
)
def test_update_document_status_rejects_document_outside_owner(
    mocker: MockerFixture,
    document_tenant_id: str,
    document_dataset_id: str,
) -> None:
    dataset = cast(Dataset, SimpleNamespace(id="dataset-1", tenant_id="tenant-1"))
    dataset_ref = DatasetRefService.create_dataset_ref(dataset)
    document_ref = DatasetRefService.create_document_ref_from_id(dataset_ref, "doc-1")
    outside_document = SimpleNamespace(
        id="doc-1",
        tenant_id=document_tenant_id,
        dataset_id=document_dataset_id,
        indexing_status="completed",
    )
    session_mock = mocker.Mock()

    def resolve_document(statement):
        params = set(statement.compile().params.values())
        outside_owner = {outside_document.id, outside_document.dataset_id, outside_document.tenant_id}
        return outside_document if outside_owner <= params else None

    session_mock.scalar.side_effect = resolve_document
    add_mock = session_mock.add

    with pytest.raises(ValueError, match="Pipeline document not found"):
        PipelineGenerateService.update_document_status(document_ref, session=session_mock)

    statement = session_mock.scalar.call_args.args[0]
    assert {"doc-1", "dataset-1", "tenant-1"} <= set(statement.compile().params.values())
    assert outside_document.indexing_status == "completed"
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
    assert generator_instance.single_iteration_generate.call_args.kwargs["session"] is session


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
    assert generator_instance.single_loop_generate.call_args.kwargs["session"] is session
