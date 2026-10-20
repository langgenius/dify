import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, Pipeline
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import Account, EndUser
from models.workflow import Workflow, WorkflowType
from services.knowledge.resource_scope import DatasetRef
from services.rag_pipeline.pipeline_generate_service import PipelineGenerateService
from services.workflow.contracts import WorkflowSnapshot
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


def _make_document(
    *, document_id: str = "doc-1", dataset_id: str = "dataset-1", tenant_id: str = "tenant-1"
) -> Document:
    return Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.LOCAL_FILE,
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="user-1",
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
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
    update_status = mocker.patch.object(PipelineGenerateService, "update_document_status")

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
        session=sqlite_session,
        generator=pipeline_generator,
    )

    assert result == "stream-events"
    document_ref = update_status.call_args.args[0]
    assert document_ref.dataset.tenant_id == "tenant-1"
    assert document_ref.dataset.dataset_id == "dataset-1"
    assert document_ref.document_id == "doc-1"
    update_status.assert_called_once_with(document_ref, session=sqlite_session)
    assert generator_instance.generate.call_args.kwargs["args"] == args
    assert "session" not in generator_instance.generate.call_args.kwargs


def test_generate_rejects_pipeline_dataset_from_another_tenant(
    mocker: MockerFixture, sqlite_session: Session, pipeline_generator
) -> None:
    dataset = _make_dataset(tenant_id="tenant-2")
    pipeline = _make_pipeline()
    sqlite_session.add_all([dataset, pipeline])
    sqlite_session.commit()
    pipeline_generator.load_workflow.return_value = _make_workflow()
    update_status_mock = mocker.patch.object(PipelineGenerateService, "update_document_status")

    with pytest.raises(ValueError, match="Pipeline dataset is required"):
        PipelineGenerateService.generate(
            pipeline=pipeline,
            user=_make_account(),
            args={"original_document_id": "doc-1"},
            invoke_from=InvokeFrom.WEB_APP,
            session=sqlite_session,
            generator=pipeline_generator,
        )

    update_status_mock.assert_not_called()


def test_generate_rejects_original_document_outside_pipeline_dataset_before_dispatch(
    sqlite_session: Session,
    pipeline_generator,
) -> None:
    dataset = _make_dataset()
    pipeline = _make_pipeline()
    outside_document = _make_document(document_id="foreign-doc", dataset_id="other-dataset", tenant_id="tenant-2")
    sqlite_session.add_all([dataset, pipeline, outside_document])
    sqlite_session.commit()
    pipeline_generator.load_workflow.return_value = _make_workflow()

    with pytest.raises(ValueError, match="Pipeline document not found"):
        PipelineGenerateService.generate(
            pipeline=pipeline,
            user=_make_account(),
            args={"original_document_id": "foreign-doc"},
            invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
            session=sqlite_session,
            generator=pipeline_generator,
        )

    sqlite_session.refresh(outside_document)
    assert outside_document.indexing_status == IndexingStatus.COMPLETED
    pipeline_generator.generate.assert_not_called()


def test_update_document_status_updates_existing_document(sqlite_session: Session) -> None:
    document = _make_document()
    dataset = _make_dataset()
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()
    dataset_ref = DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id)
    document_ref = dataset_ref.document("doc-1")

    PipelineGenerateService.update_document_status(document_ref, session=sqlite_session)

    assert document.indexing_status == IndexingStatus.WAITING


@pytest.mark.parametrize(
    ("document_tenant_id", "document_dataset_id"),
    [
        pytest.param("other-tenant", "dataset-1", id="other-tenant"),
        pytest.param("tenant-1", "other-dataset", id="other-dataset"),
    ],
)
def test_update_document_status_rejects_document_outside_owner(
    document_tenant_id: str,
    document_dataset_id: str,
    sqlite_session: Session,
) -> None:
    dataset = _make_dataset()
    dataset_ref = DatasetRef(tenant_id=dataset.tenant_id, dataset_id=dataset.id)
    document_ref = dataset_ref.document("doc-1")
    outside_document = _make_document(tenant_id=document_tenant_id, dataset_id=document_dataset_id)
    sqlite_session.add(outside_document)
    sqlite_session.commit()

    with pytest.raises(ValueError, match="Pipeline document not found"):
        PipelineGenerateService.update_document_status(document_ref, session=sqlite_session)

    sqlite_session.refresh(outside_document)
    assert outside_document.indexing_status == IndexingStatus.COMPLETED


# --- generate_single_iteration ---


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
def test_pipeline_execution_definition_is_owned_snapshot_before_generation(
    sqlite_session_factory,
    workflow_application,
    draft: bool,
) -> None:
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
    assert isinstance(loaded, WorkflowSnapshot)
    assert (loaded.id, loaded.tenant_id, loaded.app_id, loaded.version) == (
        workflow.id,
        workflow.tenant_id,
        workflow.app_id,
        workflow.version,
    )
    assert loaded.graph_dict == {}
    assert loaded.features_dict == {}
    assert sqlite_session_factory.kw["bind"].pool.checkedout() == 0
    pipeline.tenant_id = "other-tenant"
    with pytest.raises(WorkflowNotFoundError):
        generator.load_workflow(pipeline, invocation)
