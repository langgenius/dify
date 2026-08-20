import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.rag.index_processor.constant.index_type import IndexStructureType
from models.dataset import Dataset, Document, Pipeline
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import Account, App, AppMode, EndUser
from models.workflow import Workflow, WorkflowType
from services.dataset_ref_service import DatasetRefService
from services.rag_pipeline.pipeline_generate_service import PipelineGenerateService


def _make_pipeline(*, tenant_id: str = "tenant-1") -> Pipeline:
    pipeline = Pipeline(tenant_id=tenant_id, name="Pipeline", description="")
    pipeline.id = "pipeline-1"
    return pipeline


def _make_account(*, account_id: str = "user-1") -> Account:
    account = Account(name="Pipeline User", email=f"{account_id}@example.com")
    account.id = account_id
    return account


def _make_app(*, max_active_requests: int) -> App:
    return App(
        tenant_id="tenant-1",
        name="Pipeline App",
        mode=AppMode.RAG_PIPELINE,
        enable_site=False,
        enable_api=False,
        max_active_requests=max_active_requests,
    )


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


def test_get_max_active_requests_uses_smallest_non_zero_limit(mocker: MockerFixture) -> None:
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_DEFAULT_ACTIVE_REQUESTS", 5)
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_MAX_ACTIVE_REQUESTS", 3)

    app_model = _make_app(max_active_requests=10)

    result = PipelineGenerateService._get_max_active_requests(app_model)

    assert result == 3


def test_get_max_active_requests_returns_zero_when_all_unlimited(mocker: MockerFixture) -> None:
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_DEFAULT_ACTIVE_REQUESTS", 0)
    mocker.patch("services.rag_pipeline.pipeline_generate_service.dify_config.APP_MAX_ACTIVE_REQUESTS", 0)

    app_model = _make_app(max_active_requests=0)

    result = PipelineGenerateService._get_max_active_requests(app_model)

    assert result == 0


@pytest.mark.parametrize(
    ("invoke_from", "workflow", "expected_error"),
    [
        (InvokeFrom.DEBUGGER, None, "Workflow not initialized"),
        (InvokeFrom.WEB_APP, None, "Workflow not published"),
        (InvokeFrom.DEBUGGER, _make_workflow(), None),
    ],
)
def test_get_workflow(mocker: MockerFixture, invoke_from, workflow, expected_error, sqlite_session: Session) -> None:
    rag_pipeline_service_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.RagPipelineService")
    rag_pipeline_service = rag_pipeline_service_cls.return_value
    rag_pipeline_service.get_draft_workflow.return_value = workflow
    rag_pipeline_service.get_published_workflow.return_value = workflow

    pipeline = _make_pipeline()
    session = sqlite_session

    if expected_error:
        with pytest.raises(ValueError, match=expected_error):
            PipelineGenerateService._get_workflow(pipeline, invoke_from, session)
    else:
        result = PipelineGenerateService._get_workflow(pipeline, invoke_from, session)
        assert result == workflow


def test_generate_updates_document_status_and_returns_event_stream(
    mocker: MockerFixture, sqlite_session: Session
) -> None:
    dataset = _make_dataset()
    pipeline = _make_pipeline()
    sqlite_session.add_all([dataset, pipeline])
    sqlite_session.commit()
    user: Account | EndUser = _make_account()
    args = {"original_document_id": "doc-1", "query": "hello"}

    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=_make_workflow())
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
        session=sqlite_session,
    )

    assert result == "stream-events"
    document_ref = update_status_mock.call_args.args[0]
    assert document_ref.dataset.tenant_id == "tenant-1"
    assert document_ref.dataset.dataset_id == "dataset-1"
    assert document_ref.document_id == "doc-1"
    update_status_mock.assert_called_once_with(document_ref, session=sqlite_session)
    assert generator_instance.generate.call_args.kwargs["session"] is sqlite_session


def test_generate_rejects_pipeline_dataset_from_another_tenant(mocker: MockerFixture, sqlite_session: Session) -> None:
    dataset = _make_dataset(tenant_id="tenant-2")
    pipeline = _make_pipeline()
    sqlite_session.add_all([dataset, pipeline])
    sqlite_session.commit()
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=_make_workflow())
    update_status_mock = mocker.patch.object(PipelineGenerateService, "update_document_status")

    with pytest.raises(ValueError, match="Pipeline dataset is required"):
        PipelineGenerateService.generate(
            pipeline=pipeline,
            user=_make_account(),
            args={"original_document_id": "doc-1"},
            invoke_from=InvokeFrom.WEB_APP,
            session=sqlite_session,
        )

    update_status_mock.assert_not_called()


def test_generate_rejects_original_document_outside_pipeline_dataset_before_dispatch(
    mocker: MockerFixture,
    sqlite_session: Session,
) -> None:
    dataset = _make_dataset()
    pipeline = _make_pipeline()
    outside_document = _make_document(document_id="foreign-doc", dataset_id="other-dataset", tenant_id="tenant-2")
    sqlite_session.add_all([dataset, pipeline, outside_document])
    sqlite_session.commit()
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=_make_workflow())
    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")

    with pytest.raises(ValueError, match="Pipeline document not found"):
        PipelineGenerateService.generate(
            pipeline=pipeline,
            user=_make_account(),
            args={"original_document_id": "foreign-doc"},
            invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
            session=sqlite_session,
        )

    sqlite_session.refresh(outside_document)
    assert outside_document.indexing_status == IndexingStatus.COMPLETED
    generator_cls.assert_not_called()


def test_update_document_status_updates_existing_document(sqlite_session: Session) -> None:
    document = _make_document()
    dataset = _make_dataset()
    sqlite_session.add_all([dataset, document])
    sqlite_session.commit()
    dataset_ref = DatasetRefService.create_dataset_ref(dataset)
    document_ref = DatasetRefService.create_document_ref_from_id(dataset_ref, "doc-1")

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
    dataset_ref = DatasetRefService.create_dataset_ref(dataset)
    document_ref = DatasetRefService.create_document_ref_from_id(dataset_ref, "doc-1")
    outside_document = _make_document(tenant_id=document_tenant_id, dataset_id=document_dataset_id)
    sqlite_session.add(outside_document)
    sqlite_session.commit()

    with pytest.raises(ValueError, match="Pipeline document not found"):
        PipelineGenerateService.update_document_status(document_ref, session=sqlite_session)

    sqlite_session.refresh(outside_document)
    assert outside_document.indexing_status == IndexingStatus.COMPLETED


# --- generate_single_iteration ---


def test_generate_single_iteration_delegates(mocker: MockerFixture, sqlite_session: Session) -> None:
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=_make_workflow())

    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")
    generator_instance = generator_cls.return_value
    generator_instance.single_iteration_generate.return_value = "raw-iter"
    generator_cls.convert_to_event_stream.return_value = "stream-iter"

    pipeline = _make_pipeline()
    pipeline.id = "p1"
    user = _make_account(account_id="u1")
    session = sqlite_session

    result = PipelineGenerateService.generate_single_iteration(pipeline, user, "node-1", {"key": "val"}, session)

    assert result == "stream-iter"
    generator_instance.single_iteration_generate.assert_called_once()
    assert generator_instance.single_iteration_generate.call_args.kwargs["session"] is session


# --- generate_single_loop ---


def test_generate_single_loop_delegates(mocker: MockerFixture, sqlite_session: Session) -> None:
    mocker.patch.object(PipelineGenerateService, "_get_workflow", return_value=_make_workflow())

    generator_cls = mocker.patch("services.rag_pipeline.pipeline_generate_service.PipelineGenerator")
    generator_instance = generator_cls.return_value
    generator_instance.single_loop_generate.return_value = "raw-loop"
    generator_cls.convert_to_event_stream.return_value = "stream-loop"

    pipeline = _make_pipeline()
    pipeline.id = "p1"
    user = _make_account(account_id="u1")
    session = sqlite_session

    result = PipelineGenerateService.generate_single_loop(pipeline, user, "node-1", {"key": "val"}, session)

    assert result == "stream-loop"
    generator_instance.single_loop_generate.assert_called_once()
    assert generator_instance.single_loop_generate.call_args.kwargs["session"] is session
