import contextlib
import json
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, create_autospec

import pytest
from pytest_mock import MockerFixture
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.app.apps.pipeline.pipeline_generator as module
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.rag.index_processor.constant.built_in_field import BuiltInField
from models.dataset import Dataset, Document, DocumentPipelineExecutionLog, Pipeline
from models.enums import DataSourceType, EndUserType
from models.model import EndUser
from models.workflow import Workflow, WorkflowType
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from services.data_source.credential_gateway import DatasourceProviderCredentialStore
from services.entities.feature_entities import FeatureModel
from services.workflow_run_agg import WorkflowRunAgg
from tests.helpers.unit.credential_refresh import build_datasource_provider_service

TENANT_ID = "00000000-0000-0000-0000-000000000001"
PIPELINE_ID = "00000000-0000-0000-0000-000000000002"
DATASET_ID = "00000000-0000-0000-0000-000000000003"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000004"
USER_ID = "00000000-0000-0000-0000-000000000005"


class FakeRagPipelineGenerateEntity(SimpleNamespace):
    datasource_type = "website_crawl"

    class SingleIterationRunEntity(SimpleNamespace):
        pass

    class SingleLoopRunEntity(SimpleNamespace):
        pass

    def model_dump(self):
        return dict(self.__dict__)


class _FileAdmission:
    """Admits every file unless a test sets ``rejection``; records what it was asked."""

    def __init__(self) -> None:
        self.rejection: str | None = None
        self.calls: list[dict[str, str]] = []

    def __call__(self, *, tenant_id: str, dataset_id: str, upload_file_id: str) -> str | None:
        self.calls.append({"tenant_id": tenant_id, "dataset_id": dataset_id, "upload_file_id": upload_file_id})
        return self.rejection


@pytest.fixture
def generator(mocker: MockerFixture, sqlite_engine: Engine):
    gen = module.PipelineGenerator(
        execution_driver=WorkflowRunAgg.run,
        documents=SQLAlchemyDocumentRepository(session_factory=sessionmaker(bind=sqlite_engine)),
        datasource_providers=build_datasource_provider_service(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        ),
        file_admission=_FileAdmission(),
    )

    _patch_sqlite_engine(mocker, sqlite_engine)
    mocker.patch.object(module, "RagPipelineGenerateEntity", FakeRagPipelineGenerateEntity)
    mocker.patch.object(module, "RagPipelineInvokeEntity", side_effect=lambda **kwargs: kwargs)
    mocker.patch.object(module.contexts, "plugin_tool_providers", SimpleNamespace(set=MagicMock()))
    mocker.patch.object(module.contexts, "plugin_tool_providers_lock", SimpleNamespace(set=MagicMock()))

    return gen


def _build_pipeline_dataset():
    return Dataset(
        id=DATASET_ID,
        tenant_id=TENANT_ID,
        name="dataset",
        description="desc",
        created_by=USER_ID,
        pipeline_id=PIPELINE_ID,
        chunk_structure="text_model",
        built_in_field_enabled=True,
    )


def _build_pipeline():
    pipeline = Pipeline(tenant_id=TENANT_ID, name="Pipeline", description="desc")
    pipeline.id = PIPELINE_ID
    pipeline.workflow_id = WORKFLOW_ID
    return pipeline


def _build_workflow(*, graph: dict | None = None):
    workflow = Workflow.new(
        tenant_id=TENANT_ID,
        app_id=PIPELINE_ID,
        type=WorkflowType.RAG_PIPELINE.value,
        version=Workflow.VERSION_DRAFT,
        graph=json.dumps(graph if graph is not None else {"nodes": [], "edges": []}),
        features="{}",
        created_by=USER_ID,
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    workflow.id = WORKFLOW_ID
    return workflow


def _build_user():
    return EndUser(
        id=USER_ID,
        tenant_id=TENANT_ID,
        app_id=PIPELINE_ID,
        type=EndUserType.BROWSER,
        name="User",
        session_id="session",
    )


def _build_args():
    return {
        "inputs": {"k": "v"},
        "start_node_id": "start",
        "datasource_type": DatasourceProviderType.LOCAL_FILE.value,
        "datasource_info_list": [{"name": "file"}],
    }


def _patch_sqlite_engine(mocker: MockerFixture, sqlite_engine: Engine) -> None:
    mocker.patch.object(type(module.db), "engine", new_callable=PropertyMock, return_value=sqlite_engine)


def _persist_pipeline_scope(
    session: Session,
    *,
    pipeline: Pipeline | None = None,
    dataset: Dataset | None = None,
    workflow: Workflow | None = None,
) -> tuple[Pipeline, Dataset, Workflow]:
    pipeline = pipeline or _build_pipeline()
    dataset = dataset or _build_pipeline_dataset()
    workflow = workflow or _build_workflow()
    session.add_all([pipeline, dataset, workflow])
    session.commit()
    return pipeline, dataset, workflow


def _persist_worker_records(session: Session) -> None:
    workflow = Workflow(
        id=WORKFLOW_ID,
        tenant_id=TENANT_ID,
        app_id=PIPELINE_ID,
        type=WorkflowType.RAG_PIPELINE,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        _features="{}",
        created_by=USER_ID,
    )
    end_user = EndUser(
        id=USER_ID,
        tenant_id=TENANT_ID,
        app_id=PIPELINE_ID,
        type=EndUserType.BROWSER,
        session_id="session",
        name="User",
        _is_anonymous=True,
    )
    session.add_all([workflow, end_user])
    session.commit()


def _dummy_preserve[**P](*args: P.args, **kwargs: P.kwargs):
    return contextlib.nullcontext()


def test_generate_dataset_missing(generator, sqlite_session: Session):
    pipeline = _build_pipeline()

    with pytest.raises(ValueError, match="Pipeline dataset is required"):
        generator.generate(
            session=sqlite_session,
            pipeline=pipeline,
            workflow=_build_workflow(),
            user=_build_user(),
            args=_build_args(),
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
        )


def test_generate_debugger_calls_generate(generator, mocker: MockerFixture, sqlite_session: Session):
    pipeline, _, workflow = _persist_pipeline_scope(sqlite_session)

    mocker.patch.object(
        generator,
        "_format_datasource_info_list",
        return_value=[{"name": "file"}],
    )
    mocker.patch.object(
        module.PipelineConfigManager,
        "get_pipeline_config",
        return_value=SimpleNamespace(app_id="pipe", rag_pipeline_variables=[]),
    )
    mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})

    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        return_value=MagicMock(),
    )
    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        return_value=MagicMock(),
    )

    mocker.patch.object(generator, "_generate", return_value={"result": "ok"})

    result = generator.generate(
        session=sqlite_session,
        pipeline=pipeline,
        workflow=workflow,
        user=_build_user(),
        args=_build_args(),
        invoke_from=InvokeFrom.DEBUGGER,
        streaming=True,
    )

    assert result == {"result": "ok"}


def test_generate_published_pipeline_creates_documents_and_delay(
    generator, mocker: MockerFixture, sqlite_session: Session
):
    pipeline, _, workflow = _persist_pipeline_scope(sqlite_session)

    datasource_info_list = [{"name": "file1"}, {"name": "file2"}]

    mocker.patch.object(
        generator,
        "_format_datasource_info_list",
        return_value=datasource_info_list,
    )
    mocker.patch.object(
        module.PipelineConfigManager,
        "get_pipeline_config",
        return_value=SimpleNamespace(app_id="pipe", rag_pipeline_variables=[]),
    )
    mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})

    mocker.patch("services.knowledge.dataset_service.DocumentService.get_documents_position", return_value=1)
    features = SimpleNamespace()
    get_features = mocker.patch("services.feature_service.FeatureService.get_features", return_value=features)
    check_limits = mocker.patch("services.knowledge.dataset_service.DocumentService.check_document_creation_limits")

    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        return_value=MagicMock(),
    )
    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        return_value=MagicMock(),
    )

    task_proxy = MagicMock()
    mocker.patch.object(module, "RagPipelineTaskProxy", return_value=task_proxy)

    result = generator.generate(
        session=sqlite_session,
        pipeline=pipeline,
        workflow=workflow,
        user=_build_user(),
        args=_build_args(),
        invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
        streaming=False,
    )

    assert result["batch"]
    assert len(result["documents"]) == 2
    check_limits.assert_called_once_with(len(datasource_info_list), features)
    persisted_documents = sqlite_session.scalars(
        select(Document).where(Document.dataset_id == DATASET_ID).order_by(Document.position)
    ).all()
    assert [document.name for document in persisted_documents] == ["file1", "file2"]
    persisted_logs = sqlite_session.scalars(
        select(DocumentPipelineExecutionLog).where(DocumentPipelineExecutionLog.pipeline_id == PIPELINE_ID)
    ).all()
    assert {log.document_id for log in persisted_logs} == {document.id for document in persisted_documents}
    task_proxy.delay.assert_called_once()
    get_features.assert_called_once_with(TENANT_ID)


def test_generate_published_pipeline_rejects_when_document_creation_limits_exceeded(
    generator, mocker: MockerFixture, sqlite_session: Session
):
    pipeline, _, workflow = _persist_pipeline_scope(sqlite_session)

    datasource_info_list = [{"name": "file1"}, {"name": "file2"}]
    mocker.patch.object(
        generator,
        "_format_datasource_info_list",
        return_value=datasource_info_list,
    )
    mocker.patch.object(
        module.PipelineConfigManager,
        "get_pipeline_config",
        return_value=SimpleNamespace(app_id="pipe", rag_pipeline_variables=[]),
    )

    features = SimpleNamespace()
    mocker.patch("services.feature_service.FeatureService.get_features", return_value=features)
    check_limits = mocker.patch(
        "services.knowledge.dataset_service.DocumentService.check_document_creation_limits",
        side_effect=ValueError("document limit exceeded"),
    )

    with pytest.raises(ValueError, match="document limit exceeded"):
        generator.generate(
            session=sqlite_session,
            pipeline=pipeline,
            workflow=workflow,
            user=_build_user(),
            args=_build_args(),
            invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
            streaming=False,
        )

    check_limits.assert_called_once_with(len(datasource_info_list), features)
    assert sqlite_session.scalars(select(Document)).all() == []


def test_generate_published_pipeline_validates_inputs_before_creating_documents(
    generator, mocker: MockerFixture, sqlite_session: Session
):
    """Given a persisted pipeline, rejected inputs leave no pending document rows."""
    pipeline, _, workflow = _persist_pipeline_scope(sqlite_session)

    mocker.patch.object(generator, "_format_datasource_info_list", return_value=[{"name": "file1"}])
    mocker.patch.object(
        generator,
        "_prepare_user_inputs",
        side_effect=ValueError("source_files is required in input form"),
    )
    get_features = mocker.patch("services.feature_service.FeatureService.get_features")
    build_document = mocker.patch.object(generator, "_build_document")

    with pytest.raises(ValueError, match="source_files is required in input form"):
        generator.generate(
            session=sqlite_session,
            pipeline=pipeline,
            workflow=workflow,
            user=_build_user(),
            args=_build_args(),
            invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
            streaming=False,
        )

    get_features.assert_not_called()
    build_document.assert_not_called()
    assert not sqlite_session.new


def test_generate_published_pipeline_prepares_inputs_once(generator, mocker: MockerFixture, sqlite_session: Session):
    """Given two datasource items, prepare inputs once and pass the result to both runs."""
    pipeline, _, workflow = _persist_pipeline_scope(sqlite_session)

    mocker.patch.object(generator, "_format_datasource_info_list", return_value=[{"name": "file1"}, {"name": "file2"}])
    prepare_inputs = mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})
    mocker.patch("services.knowledge.dataset_service.DocumentService.get_documents_position", return_value=1)
    mocker.patch("services.feature_service.FeatureService.get_features", return_value=FeatureModel())
    mocker.patch("services.knowledge.dataset_service.DocumentService.check_document_creation_limits")
    mocker.patch.object(module.DifyCoreRepositoryFactory, "create_workflow_execution_repository")
    mocker.patch.object(module.DifyCoreRepositoryFactory, "create_workflow_node_execution_repository")
    task_proxy_cls = mocker.patch.object(module, "RagPipelineTaskProxy")

    generator.generate(
        session=sqlite_session,
        pipeline=pipeline,
        workflow=workflow,
        user=_build_user(),
        args=_build_args(),
        invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
        streaming=False,
    )

    prepare_inputs.assert_called_once()
    invoke_entities = task_proxy_cls.call_args.args[2]
    assert [entity["application_generate_entity"]["inputs"] for entity in invoke_entities] == [{"k": "v"}, {"k": "v"}]


def test_generate_is_retry_calls_generate(generator, mocker: MockerFixture, sqlite_session: Session):
    pipeline, _, workflow = _persist_pipeline_scope(sqlite_session)

    mocker.patch.object(
        generator,
        "_format_datasource_info_list",
        return_value=[{"name": "file"}],
    )
    mocker.patch.object(
        module.PipelineConfigManager,
        "get_pipeline_config",
        return_value=SimpleNamespace(app_id="pipe", rag_pipeline_variables=[]),
    )
    mocker.patch.object(generator, "_prepare_user_inputs", return_value={"k": "v"})

    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        return_value=MagicMock(),
    )
    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        return_value=MagicMock(),
    )

    generate = mocker.patch.object(generator, "_generate", return_value={"result": "ok"})

    args = _build_args()
    args["original_document_id"] = "document-1"

    result = generator.generate(
        session=sqlite_session,
        pipeline=pipeline,
        workflow=workflow,
        user=_build_user(),
        args=args,
        invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
        streaming=True,
        is_retry=True,
    )

    assert result == {"result": "ok"}
    application_generate_entity = generate.call_args.kwargs["application_generate_entity"]
    assert application_generate_entity.document_id == "document-1"
    assert application_generate_entity.original_document_id is None


def test_generate_worker_handles_errors(
    generator,
    mocker: MockerFixture,
    sqlite_session: Session,
    sqlite_engine: Engine,
):
    flask_app = MagicMock()
    flask_app.app_context.return_value = contextlib.nullcontext()
    mocker.patch.object(module, "preserve_flask_contexts", _dummy_preserve)
    _persist_worker_records(sqlite_session)
    _patch_sqlite_engine(mocker, sqlite_engine)

    application_generate_entity = FakeRagPipelineGenerateEntity(
        app_config=SimpleNamespace(tenant_id=TENANT_ID, app_id=PIPELINE_ID, workflow_id=WORKFLOW_ID),
        invoke_from=InvokeFrom.WEB_APP,
        user_id=USER_ID,
    )

    runner_instance = MagicMock()
    runner_instance.prepare.side_effect = ValueError("bad")
    mocker.patch.object(module, "PipelineRunner", return_value=runner_instance)

    queue_manager = MagicMock()
    generator._generate_worker(
        flask_app=flask_app,
        application_generate_entity=application_generate_entity,
        queue_manager=queue_manager,
        context=contextlib.nullcontext(),
        variable_loader=MagicMock(),
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )

    queue_manager.publish_error.assert_called_once()


def test_generate_worker_sets_system_user_id_for_external_call(
    generator,
    mocker: MockerFixture,
    sqlite_session: Session,
    sqlite_engine: Engine,
):
    flask_app = MagicMock()
    flask_app.app_context.return_value = contextlib.nullcontext()
    mocker.patch.object(module, "preserve_flask_contexts", _dummy_preserve)
    _persist_worker_records(sqlite_session)
    _patch_sqlite_engine(mocker, sqlite_engine)

    application_generate_entity = FakeRagPipelineGenerateEntity(
        app_config=SimpleNamespace(tenant_id=TENANT_ID, app_id=PIPELINE_ID, workflow_id=WORKFLOW_ID),
        invoke_from=InvokeFrom.WEB_APP,
        user_id=USER_ID,
    )

    runner_instance = MagicMock()
    execution_driver = mocker.patch.object(generator, "_execution_driver")
    workflow_execution_repository = MagicMock()
    workflow_node_execution_repository = MagicMock()
    mocker.patch.object(module, "PipelineRunner", return_value=runner_instance)

    generator._generate_worker(
        flask_app=flask_app,
        application_generate_entity=application_generate_entity,
        queue_manager=MagicMock(),
        context=contextlib.nullcontext(),
        variable_loader=MagicMock(),
        workflow_execution_repository=workflow_execution_repository,
        workflow_node_execution_repository=workflow_node_execution_repository,
    )

    runner_kwargs = module.PipelineRunner.call_args.kwargs
    assert runner_kwargs["system_user_id"] == "session"
    assert runner_kwargs["execution_driver"] is execution_driver
    assert runner_kwargs["documents"] is generator._documents
    assert "workflow_execution_repository" not in runner_kwargs
    assert "workflow_node_execution_repository" not in runner_kwargs
    execution_driver.assert_called_once_with(
        runner_instance, None, workflow_execution_repository, workflow_node_execution_repository
    )


def test_generate_raises_when_workflow_not_found(generator, mocker: MockerFixture, sqlite_session: Session):
    flask_app = MagicMock()
    mocker.patch.object(module, "preserve_flask_contexts", _dummy_preserve)

    session = sqlite_session

    with pytest.raises(ValueError, match="Workflow not found: wf"):
        generator._generate(
            session=session,
            flask_app=flask_app,
            context=contextlib.nullcontext(),
            pipeline=_build_pipeline(),
            workflow_id="wf",
            user=_build_user(),
            application_generate_entity=FakeRagPipelineGenerateEntity(
                task_id="t",
                app_config=SimpleNamespace(app_id="pipe"),
                user_id="user",
                invoke_from=InvokeFrom.DEBUGGER,
            ),
            invoke_from=InvokeFrom.DEBUGGER,
            workflow_execution_repository=MagicMock(),
            workflow_node_execution_repository=MagicMock(),
            streaming=True,
        )


def test_generate_success_returns_converted(generator, mocker: MockerFixture, sqlite_session: Session):
    flask_app = MagicMock()
    mocker.patch.object(module, "preserve_flask_contexts", _dummy_preserve)

    workflow = Workflow(
        id="00000000-0000-0000-0000-000000000001",
        tenant_id="00000000-0000-0000-0000-000000000002",
        app_id="00000000-0000-0000-0000-000000000003",
        type=WorkflowType.RAG_PIPELINE,
        version=Workflow.VERSION_DRAFT,
        graph="{}",
        _features="{}",
        created_by="00000000-0000-0000-0000-000000000004",
    )
    sqlite_session.add(workflow)
    sqlite_session.commit()
    session = sqlite_session

    queue_manager = MagicMock()
    mocker.patch.object(module, "PipelineQueueManager", return_value=queue_manager)

    worker_thread = MagicMock()
    worker_thread.is_alive.return_value = False
    mocker.patch.object(module.threading, "Thread", return_value=worker_thread)

    mocker.patch.object(generator, "_get_draft_var_saver_factory", return_value=MagicMock())
    mocker.patch.object(generator, "_handle_response", return_value="response")
    mocker.patch.object(module.WorkflowAppGenerateResponseConverter, "convert", return_value="converted")

    result = generator._generate(
        session=session,
        flask_app=flask_app,
        context=contextlib.nullcontext(),
        pipeline=_build_pipeline(),
        workflow_id=workflow.id,
        user=_build_user(),
        application_generate_entity=FakeRagPipelineGenerateEntity(
            task_id="t",
            app_config=SimpleNamespace(app_id="pipe"),
            user_id="user",
            invoke_from=InvokeFrom.DEBUGGER,
        ),
        invoke_from=InvokeFrom.DEBUGGER,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        streaming=True,
    )

    assert result == "converted"
    worker_thread.join.assert_called_once_with(timeout=300)


def test_single_iteration_generate_validates_inputs(generator, sqlite_session: Session):
    with pytest.raises(ValueError, match="node_id is required"):
        generator.single_iteration_generate(
            _build_pipeline(), _build_workflow(), "", _build_user(), {}, session=sqlite_session
        )

    with pytest.raises(ValueError, match="inputs is required"):
        generator.single_iteration_generate(
            _build_pipeline(),
            _build_workflow(),
            "node",
            _build_user(),
            {"inputs": None},
            session=sqlite_session,
        )


def test_single_iteration_generate_dataset_required(generator, sqlite_session: Session):
    pipeline = _build_pipeline()

    with pytest.raises(ValueError, match="Pipeline dataset is required"):
        generator.single_iteration_generate(
            pipeline,
            _build_workflow(),
            "node",
            _build_user(),
            {"inputs": {"a": 1}},
            session=sqlite_session,
        )


def test_single_iteration_generate_success(
    generator,
    mocker: MockerFixture,
    sqlite_session: Session,
):
    pipeline, _, workflow = _persist_pipeline_scope(sqlite_session)

    mocker.patch.object(
        module.PipelineConfigManager,
        "get_pipeline_config",
        return_value=SimpleNamespace(app_id="pipe", tenant_id="tenant"),
    )
    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        return_value=MagicMock(),
    )
    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        return_value=MagicMock(),
    )
    mocker.patch.object(module, "WorkflowDraftVariableService", return_value=MagicMock())
    mocker.patch.object(module, "DraftVarLoader", return_value=MagicMock())

    mocker.patch.object(generator, "_generate", return_value={"ok": True})

    result = generator.single_iteration_generate(
        pipeline,
        workflow,
        "node",
        _build_user(),
        {"inputs": {"a": 1}},
        streaming=False,
        session=sqlite_session,
    )

    assert result == {"ok": True}


def test_single_loop_generate_success(
    generator,
    mocker: MockerFixture,
    sqlite_session: Session,
):
    pipeline, _, workflow = _persist_pipeline_scope(sqlite_session)

    mocker.patch.object(
        module.PipelineConfigManager,
        "get_pipeline_config",
        return_value=SimpleNamespace(app_id="pipe", tenant_id="tenant"),
    )
    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        return_value=MagicMock(),
    )
    mocker.patch.object(
        module.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        return_value=MagicMock(),
    )
    mocker.patch.object(module, "WorkflowDraftVariableService", return_value=MagicMock())
    mocker.patch.object(module, "DraftVarLoader", return_value=MagicMock())

    mocker.patch.object(generator, "_generate", return_value={"ok": True})

    result = generator.single_loop_generate(
        pipeline,
        workflow,
        "node",
        _build_user(),
        {"inputs": {"a": 1}},
        streaming=False,
        session=sqlite_session,
    )

    assert result == {"ok": True}


def test_handle_response_value_error_triggers_generate_task_stopped(generator, mocker: MockerFixture):
    _build_pipeline()
    workflow = _build_workflow()
    app_entity = FakeRagPipelineGenerateEntity(task_id="t")

    task_pipeline = MagicMock()
    task_pipeline.process.side_effect = ValueError("I/O operation on closed file.")
    mocker.patch.object(module, "WorkflowAppGenerateTaskPipeline", return_value=task_pipeline)

    with pytest.raises(GenerateTaskStoppedError):
        generator._handle_response(
            application_generate_entity=app_entity,
            workflow=workflow,
            queue_manager=MagicMock(),
            user=_build_user(),
            draft_var_saver_factory=MagicMock(),
            stream=False,
        )


def test_build_document_sets_metadata_for_builtin_fields(generator, monkeypatch):
    created_at = datetime(2026, 10, 16, 8, 0, 0)
    monkeypatch.setattr(module, "naive_utc_now", lambda: created_at)

    document = generator._build_document(
        tenant_id="tenant",
        dataset_id="ds",
        built_in_field_enabled=True,
        datasource_type=DatasourceProviderType.LOCAL_FILE,
        datasource_info={"name": "file"},
        created_from="rag-pipeline",
        position=1,
        account=_build_user(),
        batch="batch",
        document_form="text",
    )

    assert document.name == "file"
    assert document.doc_metadata == {
        BuiltInField.document_name: "file",
        BuiltInField.uploader: "User",
        BuiltInField.upload_date: 1792137600,
        BuiltInField.last_update_date: 1792137600,
        BuiltInField.source: "file_upload",
    }


def test_build_document_supports_online_drive_datasource_type(generator):
    document = generator._build_document(
        tenant_id="tenant",
        dataset_id="ds",
        built_in_field_enabled=True,
        datasource_type=DatasourceProviderType.ONLINE_DRIVE,
        datasource_info={"id": "file-1", "bucket": "bucket-1", "name": "drive.pdf", "type": "file"},
        created_from="rag-pipeline",
        position=1,
        account=_build_user(),
        batch="batch",
        document_form="text",
    )

    assert DataSourceType(document.data_source_type) == DataSourceType.ONLINE_DRIVE
    assert document.name == "drive.pdf"


def _build_document_for(generator, datasource_type: DatasourceProviderType, datasource_info: dict):
    return generator._build_document(
        tenant_id="tenant",
        dataset_id="ds",
        built_in_field_enabled=True,
        datasource_type=datasource_type,
        datasource_info=datasource_info,
        created_from="rag-pipeline",
        position=1,
        account=_build_user(),
        batch="batch",
        document_form="text",
    )


def test_build_document_truncates_overlong_website_title(generator):
    # A crawler can return the whole page body as the title, which overflows documents.name.
    title = "# Docs " + "x" * 5000

    document = _build_document_for(
        generator,
        DatasourceProviderType.WEBSITE_CRAWL,
        {"title": title, "source_url": "https://example.com/llms.txt"},
    )

    assert len(document.name) == module.DOCUMENT_NAME_MAX_LENGTH
    assert document.name.startswith("# Docs x")
    assert document.doc_metadata[BuiltInField.document_name] == document.name


@pytest.mark.parametrize(
    ("datasource_type", "datasource_info", "expected"),
    [
        (
            DatasourceProviderType.WEBSITE_CRAWL,
            {"title": "", "source_url": "https://example.com/a"},
            "https://example.com/a",
        ),
        (DatasourceProviderType.WEBSITE_CRAWL, {"title": None}, "untitled"),
        (DatasourceProviderType.WEBSITE_CRAWL, {"title": "  Page  title \n"}, "Page  title"),
        (DatasourceProviderType.LOCAL_FILE, {}, "untitled"),
        (DatasourceProviderType.LOCAL_FILE, {"name": "   "}, "untitled"),
        (DatasourceProviderType.ONLINE_DOCUMENT, {"page": None}, "untitled"),
        (DatasourceProviderType.ONLINE_DOCUMENT, {"page": {"page_name": "p" * 300}}, "p" * 255),
        (DatasourceProviderType.ONLINE_DRIVE, {"name": 123}, "untitled"),
    ],
)
def test_build_document_normalizes_name(generator, datasource_type, datasource_info, expected):
    assert _build_document_for(generator, datasource_type, datasource_info).name == expected


def test_build_document_invalid_datasource_type(generator):
    with pytest.raises(ValueError, match="Unsupported datasource type: invalid"):
        generator._build_document(
            tenant_id="tenant",
            dataset_id="ds",
            built_in_field_enabled=False,
            datasource_type="invalid",
            datasource_info={},
            created_from="rag-pipeline",
            position=1,
            account=_build_user(),
            batch="batch",
            document_form="text",
        )


def test_format_datasource_info_list_non_online_drive(generator):
    result = generator._format_datasource_info_list(
        DatasourceProviderType.LOCAL_FILE,
        [{"name": "file"}],
        _build_pipeline(),
        _build_workflow(),
        "start",
        _build_user(),
    )

    assert result == [{"name": "file"}]


def test_format_datasource_info_list_missing_node_data(generator):
    workflow = _build_workflow()

    with pytest.raises(ValueError, match="Datasource node data not found"):
        generator._format_datasource_info_list(
            DatasourceProviderType.ONLINE_DRIVE,
            [],
            _build_pipeline(),
            workflow,
            "start",
            _build_user(),
        )


def test_format_datasource_info_list_online_drive_folder(generator, mocker: MockerFixture):
    workflow = _build_workflow(
        graph={
            "nodes": [
                {
                    "id": "start",
                    "data": {
                        "plugin_id": "p",
                        "provider_name": "provider",
                        "datasource_name": "drive",
                        "credential_id": "cred",
                    },
                }
            ]
        },
    )

    runtime = MagicMock()
    runtime.runtime = SimpleNamespace(credentials=None)
    runtime.datasource_provider_type.return_value = DatasourceProviderType.ONLINE_DRIVE

    mocker.patch(
        "core.datasource.datasource_manager.DatasourceManager.get_datasource_runtime",
        return_value=runtime,
    )
    mocker.patch.object(module.DatasourceProviderService, "get_datasource_credentials", return_value={"k": "v"})

    mocker.patch.object(
        generator,
        "_get_files_in_folder",
        side_effect=lambda *args, **kwargs: args[4].append({"id": "f"}),
    )

    result = generator._format_datasource_info_list(
        DatasourceProviderType.ONLINE_DRIVE,
        [{"id": "folder", "type": "folder", "name": "Folder", "bucket": "b"}],
        _build_pipeline(),
        workflow,
        "start",
        _build_user(),
    )

    assert result == [{"id": "f"}]


def test_format_datasource_info_list_online_drive_file_preserves_credential_id(generator, mocker: MockerFixture):
    workflow = _build_workflow(
        graph={
            "nodes": [
                {
                    "id": "start",
                    "data": {
                        "plugin_id": "p",
                        "provider_name": "provider",
                        "datasource_name": "drive",
                        "credential_id": "cred",
                    },
                }
            ]
        },
    )

    class RuntimeCredentials:
        credentials = None

    class Runtime:
        runtime = RuntimeCredentials()

        def datasource_provider_type(self):
            return DatasourceProviderType.ONLINE_DRIVE

    mocker.patch(
        "core.datasource.datasource_manager.DatasourceManager.get_datasource_runtime",
        return_value=Runtime(),
    )
    mocker.patch.object(module.DatasourceProviderService, "get_datasource_credentials", return_value={"k": "v"})

    result = generator._format_datasource_info_list(
        DatasourceProviderType.ONLINE_DRIVE,
        [
            {"id": "file-1", "name": "report.txt", "bucket": "b", "credential_id": "cred-1"},
            {"id": "file-2", "name": "notes.txt", "bucket": "b"},
        ],
        _build_pipeline(),
        workflow,
        "start",
        _build_user(),
    )

    assert result[0]["credential_id"] == "cred-1"
    assert result[1]["credential_id"] is None


def test_get_files_in_folder_propagates_credential_id(generator):
    class File:
        def __init__(self, id, name, type):
            self.id = id
            self.name = name
            self.type = type

    class FilesPage:
        def __init__(self, files, is_truncated=False, next_page_parameters=None):
            self.files = files
            self.is_truncated = is_truncated
            self.next_page_parameters = next_page_parameters

    class Result:
        def __init__(self, result):
            self.result = result

    class Runtime:
        def datasource_provider_type(self):
            return DatasourceProviderType.ONLINE_DRIVE

        def online_drive_browse_files(self, user_id, request, provider_type):
            return iter([Result([FilesPage([File("f1", "file1", "file")])])])

    all_files = []

    generator._get_files_in_folder(
        datasource_runtime=Runtime(),
        prefix="root",
        bucket="b",
        user_id="user",
        all_files=all_files,
        datasource_info={"credential_id": "cred-1"},
    )

    assert all_files == [{"id": "f1", "name": "file1", "bucket": "b", "credential_id": "cred-1"}]


def test_get_files_in_folder_recurses_and_collects(generator):
    class File:
        def __init__(self, id, name, type):
            self.id = id
            self.name = name
            self.type = type

    class FilesPage:
        def __init__(self, files, is_truncated=False, next_page_parameters=None):
            self.files = files
            self.is_truncated = is_truncated
            self.next_page_parameters = next_page_parameters

    class Result:
        def __init__(self, result):
            self.result = result

    class Runtime:
        def __init__(self):
            self.calls = []

        def datasource_provider_type(self):
            return DatasourceProviderType.ONLINE_DRIVE

        def online_drive_browse_files(self, user_id, request, provider_type):
            self.calls.append(request.next_page_parameters)
            if request.prefix == "fd":
                return iter([Result([FilesPage([File("f2", "file2", "file")], False, None)])])
            if request.next_page_parameters is None:
                return iter(
                    [
                        Result(
                            [FilesPage([File("f1", "file", "file"), File("fd", "folder", "folder")], True, {"page": 2})]
                        )
                    ]
                )
            return iter([Result([FilesPage([File("f2", "file2", "file")], False, None)])])

    runtime = Runtime()
    all_files = []

    generator._get_files_in_folder(
        datasource_runtime=runtime,
        prefix="root",
        bucket="b",
        user_id="user",
        all_files=all_files,
        datasource_info={},
    )

    assert {f["id"] for f in all_files} == {"f1", "f2"}


def test_get_files_in_folder_handles_empty_folder(generator):
    """An empty folder must return an empty file list without recursion errors."""

    class FilesPage:
        def __init__(self, files, is_truncated=False, next_page_parameters=None):
            self.files = files
            self.is_truncated = is_truncated
            self.next_page_parameters = next_page_parameters

    class Result:
        def __init__(self, result):
            self.result = result

    class Runtime:
        def datasource_provider_type(self):
            return DatasourceProviderType.ONLINE_DRIVE

        def online_drive_browse_files(self, user_id, request, provider_type):
            # Empty folder: returns a page with no files, not truncated
            return iter([Result([FilesPage([], False, None)])])

    runtime = Runtime()
    all_files: list = []

    generator._get_files_in_folder(
        datasource_runtime=runtime,
        prefix="empty-folder",
        bucket="b",
        user_id="user",
        all_files=all_files,
        datasource_info={},
    )

    assert all_files == []


def test_get_files_in_folder_handles_empty_folder_with_false_truncation(generator):
    """An empty folder that incorrectly reports is_truncated=True must not recurse forever."""

    call_count = 0

    class FilesPage:
        def __init__(self, files, is_truncated=False, next_page_parameters=None):
            self.files = files
            self.is_truncated = is_truncated
            self.next_page_parameters = next_page_parameters

    class Result:
        def __init__(self, result):
            self.result = result

    class Runtime:
        def datasource_provider_type(self):
            return DatasourceProviderType.ONLINE_DRIVE

        def online_drive_browse_files(self, user_id, request, provider_type):
            nonlocal call_count
            call_count += 1
            # Empty folder that incorrectly claims truncation
            return iter([Result([FilesPage([], True, {"page": 2})])])

    runtime = Runtime()
    all_files: list = []

    generator._get_files_in_folder(
        datasource_runtime=runtime,
        prefix="buggy-folder",
        bucket="b",
        user_id="user",
        all_files=all_files,
        datasource_info={},
    )

    assert all_files == []
    # Should only be called once -- the empty-page guard prevents further recursion
    assert call_count == 1


def test_get_files_in_folder_handles_self_referencing_folder(generator):
    """A folder that lists itself as a child must not recurse infinitely."""

    class File:
        def __init__(self, id, name, type):
            self.id = id
            self.name = name
            self.type = type

    class FilesPage:
        def __init__(self, files, is_truncated=False, next_page_parameters=None):
            self.files = files
            self.is_truncated = is_truncated
            self.next_page_parameters = next_page_parameters

    class Result:
        def __init__(self, result):
            self.result = result

    call_count = 0

    class Runtime:
        def datasource_provider_type(self):
            return DatasourceProviderType.ONLINE_DRIVE

        def online_drive_browse_files(self, user_id, request, provider_type):
            nonlocal call_count
            call_count += 1
            # The folder returns itself as a child (self-reference)
            return iter([Result([FilesPage([File("self-ref", "myfolder", "folder")], False, None)])])

    runtime = Runtime()
    all_files: list = []

    generator._get_files_in_folder(
        datasource_runtime=runtime,
        prefix="self-ref",
        bucket="b",
        user_id="user",
        all_files=all_files,
        datasource_info={},
    )

    assert all_files == []
    # Should only be called once -- the visited-set guard prevents re-entry
    assert call_count == 1


UPLOAD_FILE_ID = "00000000-0000-0000-0000-000000000009"
DOCUMENT_ID = "00000000-0000-0000-0000-00000000000a"
OTHER_DOCUMENT_ID = "00000000-0000-0000-0000-00000000000b"


class _ScanEntity:
    """The fields of a pipeline run entity that the file admission check reads."""

    def __init__(
        self,
        *,
        datasource_type: str = DatasourceProviderType.LOCAL_FILE.value,
        datasource_info: dict[str, str] | None = None,
    ) -> None:
        self.datasource_type = datasource_type
        self.datasource_info = datasource_info or {"related_id": UPLOAD_FILE_ID, "name": "report.docx"}
        self.dataset_id = DATASET_ID
        self.document_id = DOCUMENT_ID


def test_scan_local_file_fails_only_its_own_document_when_the_file_is_rejected(generator, sqlite_session: Session):
    _persist_pipeline_scope(sqlite_session)
    for document_id in (DOCUMENT_ID, OTHER_DOCUMENT_ID):
        document = generator._build_document(
            tenant_id=TENANT_ID,
            dataset_id=DATASET_ID,
            built_in_field_enabled=False,
            datasource_type=DatasourceProviderType.LOCAL_FILE,
            datasource_info={"related_id": UPLOAD_FILE_ID, "name": "report.docx"},
            created_from="rag-pipeline",
            position=1,
            account=_build_user(),
            batch="batch",
            document_form="text_model",
        )
        document.id = document_id
        sqlite_session.add(document)
    sqlite_session.commit()
    rejection = '"report.docx" was blocked by the malware scan: Evil.A detected. The original file was deleted.'
    generator._file_admission.rejection = rejection

    with pytest.raises(module.PipelineFileRejectedError, match="Evil.A"):
        generator._scan_local_file(pipeline=_build_pipeline(), application_generate_entity=_ScanEntity())

    assert generator._file_admission.calls == [
        {"tenant_id": TENANT_ID, "dataset_id": DATASET_ID, "upload_file_id": UPLOAD_FILE_ID}
    ]
    sqlite_session.expire_all()
    rejected = sqlite_session.get(Document, DOCUMENT_ID)
    untouched = sqlite_session.get(Document, OTHER_DOCUMENT_ID)
    assert rejected.indexing_status == "error"
    assert rejected.error == rejection
    assert untouched.indexing_status != "error"
    assert untouched.error is None


def test_scan_local_file_lets_allowed_files_and_other_datasources_through(generator):
    pipeline = _build_pipeline()

    generator._scan_local_file(pipeline=pipeline, application_generate_entity=_ScanEntity())
    assert len(generator._file_admission.calls) == 1

    generator._scan_local_file(
        pipeline=pipeline,
        application_generate_entity=_ScanEntity(datasource_type=DatasourceProviderType.WEBSITE_CRAWL.value),
    )
    generator._scan_local_file(
        pipeline=pipeline, application_generate_entity=_ScanEntity(datasource_info={"name": "no reference"})
    )
    assert len(generator._file_admission.calls) == 1
