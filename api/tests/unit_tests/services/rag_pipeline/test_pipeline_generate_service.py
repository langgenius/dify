import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from models.dataset import Dataset, Pipeline
from models.model import Account, EndUser
from models.workflow import Workflow, WorkflowType
from services.rag_pipeline.pipeline_generate_service import PipelineGenerateService
from services.workflow.execution.adapters.pipeline.pipeline_generator import PipelineGenerator


@pytest.fixture
def pipeline_generator(mocker: MockerFixture):
    return mocker.create_autospec(PipelineGenerator, instance=True, spec_set=True)


def _make_pipeline(*, tenant_id: str = "tenant-1") -> Pipeline:
    pipeline = Pipeline(tenant_id=tenant_id, name="Pipeline", description="")
    pipeline.id = "pipeline-1"
    return pipeline


def _make_account(*, account_id: str = "user-1") -> Account:
    account = Account(name="Pipeline User", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _make_workflow(*, workflow_id: str = "wf-1") -> Workflow:
    return Workflow(
        id=workflow_id,
        tenant_id="tenant-1",
        app_id="pipeline-1",
        type=WorkflowType.RAG_PIPELINE,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        features="{}",
        created_by="user-1",
    )


def _make_dataset(*, dataset_id: str = "dataset-1", tenant_id: str = "tenant-1") -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Dataset",
        created_by="user-1",
        pipeline_id="pipeline-1",
    )


def test_generate_delegates_original_document_and_returns_event_stream(
    mocker: MockerFixture, sqlite_session: Session, pipeline_generator
) -> None:
    dataset = _make_dataset()
    pipeline = _make_pipeline()
    sqlite_session.add_all([dataset, pipeline])
    sqlite_session.commit()
    user: Account | EndUser = _make_account()
    args = {"original_document_id": "doc-1", "query": "hello"}

    pipeline_generator.load_workflow.return_value = _make_workflow()

    generator_instance = pipeline_generator
    generator_instance.generate.return_value = "raw-events"
    mocker.patch(
        "services.rag_pipeline.pipeline_generate_service.convert_to_event_stream", return_value="stream-events"
    )

    result = PipelineGenerateService.generate(
        pipeline=pipeline,
        user=user,
        args=args,
        invoke_from=InvokeFrom.WEB_APP,
        streaming=True,
        generator=pipeline_generator,
    )

    assert result == "stream-events"
    assert generator_instance.generate.call_args.kwargs["args"] == args
    assert "session" not in generator_instance.generate.call_args.kwargs


def test_generate_single_iteration_delegates(mocker: MockerFixture, pipeline_generator) -> None:
    pipeline_generator.load_workflow.return_value = _make_workflow()

    generator_instance = pipeline_generator
    generator_instance.single_iteration_generate.return_value = "raw-iter"
    mocker.patch("services.rag_pipeline.pipeline_generate_service.convert_to_event_stream", return_value="stream-iter")

    pipeline = _make_pipeline()
    pipeline.id = "p1"
    user = _make_account(account_id="u1")

    result = PipelineGenerateService.generate_single_iteration(
        pipeline, user, "node-1", {"key": "val"}, generator=pipeline_generator
    )

    assert result == "stream-iter"
    generator_instance.single_iteration_generate.assert_called_once()
    assert "session" not in generator_instance.single_iteration_generate.call_args.kwargs


# --- generate_single_loop ---


def test_generate_single_loop_delegates(mocker: MockerFixture, pipeline_generator) -> None:
    pipeline_generator.load_workflow.return_value = _make_workflow()

    generator_instance = pipeline_generator
    generator_instance.single_loop_generate.return_value = "raw-loop"
    mocker.patch("services.rag_pipeline.pipeline_generate_service.convert_to_event_stream", return_value="stream-loop")

    pipeline = _make_pipeline()
    pipeline.id = "p1"
    user = _make_account(account_id="u1")

    result = PipelineGenerateService.generate_single_loop(
        pipeline, user, "node-1", {"key": "val"}, generator=pipeline_generator
    )

    assert result == "stream-loop"
    generator_instance.single_loop_generate.assert_called_once()
    assert "session" not in generator_instance.single_loop_generate.call_args.kwargs


@pytest.mark.parametrize("draft", [True, False])
def test_pipeline_execution_definition_is_owned_and_detached_before_generation(
    sqlite_session_factory,
    workflow_application,
    draft: bool,
) -> None:
    from sqlalchemy import inspect

    from services.errors.app import WorkflowNotFoundError

    pipeline = _make_pipeline()
    workflow = _make_workflow()
    if not draft:
        workflow.version = "published"
        pipeline.workflow_id = workflow.id
    with sqlite_session_factory.begin() as session:
        session.add_all([pipeline, workflow])
    generator = workflow_application.knowledge.pipeline_generator
    invocation = InvokeFrom.DEBUGGER if draft else InvokeFrom.PUBLISHED_PIPELINE
    loaded = generator.load_workflow(pipeline, invocation)
    assert loaded.id == workflow.id
    assert inspect(loaded).detached
    assert sqlite_session_factory.kw["bind"].pool.checkedout() == 0
    pipeline.tenant_id = "other-tenant"
    with pytest.raises(WorkflowNotFoundError):
        generator.load_workflow(pipeline, invocation)
