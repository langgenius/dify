import contextlib
import json
from dataclasses import dataclass
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, create_autospec

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

import core.app.apps.pipeline.pipeline_generator as module
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.datasource.entities.datasource_entities import DatasourceProviderType
from core.rag.index_processor.constant.built_in_field import BuiltInField
from models.dataset import Dataset, Pipeline
from models.enums import DataSourceType, EndUserType
from models.model import EndUser
from models.workflow import Workflow, WorkflowType
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentAttachmentWriter
from services.data_source.credential_gateway import DatasourceProviderCredentialStore
from services.data_source.provider_service import DatasourceProviderService
from services.workflow_run_agg import WorkflowRunAgg

TENANT_ID = "00000000-0000-0000-0000-000000000001"
PIPELINE_ID = "00000000-0000-0000-0000-000000000002"
DATASET_ID = "00000000-0000-0000-0000-000000000003"
WORKFLOW_ID = "00000000-0000-0000-0000-000000000004"
USER_ID = "00000000-0000-0000-0000-000000000005"


class FakeRagPipelineGenerateEntity(SimpleNamespace):
    class SingleIterationRunEntity(SimpleNamespace):
        pass

    class SingleLoopRunEntity(SimpleNamespace):
        pass

    def model_dump(self):
        return dict(self.__dict__)


@pytest.fixture
def generator(mocker: MockerFixture, sqlite_engine: Engine):
    gen = module.PipelineGenerator(
        execution_driver=WorkflowRunAgg.run,
        documents=SQLAlchemyDocumentRepository(session_factory=sessionmaker(bind=sqlite_engine)),
        datasource_providers=DatasourceProviderService(
            credentials=create_autospec(DatasourceProviderCredentialStore, instance=True)
        ),
        attachment_writer=SQLAlchemySegmentAttachmentWriter(),
    )

    _patch_sqlite_engine(mocker, sqlite_engine)
    mocker.patch.object(module, "RagPipelineGenerateEntity", FakeRagPipelineGenerateEntity)
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
        is_anonymous=True,
    )
    session.add_all([workflow, end_user])
    session.commit()


def _dummy_preserve[**P](*args: P.args, **kwargs: P.kwargs):
    return contextlib.nullcontext()


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
        workflow=_build_workflow(),
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
        workflow=_build_workflow(),
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
    queue_manager = MagicMock()
    mocker.patch.object(module, "PipelineQueueManager", return_value=queue_manager)

    worker_thread = MagicMock()
    worker_thread.is_alive.return_value = False
    mocker.patch.object(module.threading, "Thread", return_value=worker_thread)

    mocker.patch.object(generator, "_get_draft_var_saver_factory", return_value=MagicMock())
    mocker.patch.object(generator, "_handle_response", return_value="response")
    mocker.patch.object(module.WorkflowAppGenerateResponseConverter, "convert", return_value="converted")

    result = generator.run(
        flask_app=flask_app,
        context=contextlib.nullcontext(),
        pipeline=_build_pipeline(),
        workflow=workflow,
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

    mocker.patch.object(generator, "run", return_value={"ok": True})

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

    mocker.patch.object(generator, "run", return_value={"ok": True})

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

    document = generator.build_document(
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
    document = generator.build_document(
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


def test_build_document_invalid_datasource_type(generator):
    with pytest.raises(ValueError, match="Unsupported datasource type: invalid"):
        generator.build_document(
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
    result = generator.expand_datasource_info_list(
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
        generator.expand_datasource_info_list(
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
    get_credentials = mocker.patch.object(
        module.DatasourceProviderService, "get_datasource_credentials", return_value={"k": "v"}
    )

    mocker.patch.object(
        generator,
        "_get_files_in_folder",
        side_effect=lambda *args, **kwargs: args[4].append({"id": args[1], "credential_id": args[5]["credential_id"]}),
    )

    result = generator.expand_datasource_info_list(
        DatasourceProviderType.ONLINE_DRIVE,
        [
            {"id": "folder-a", "type": "folder", "name": "Folder A", "bucket": "b", "credential_id": "cred-a"},
            {"id": "folder-b", "type": "folder", "name": "Folder B", "bucket": "b", "credential_id": "cred-b"},
        ],
        _build_pipeline(),
        workflow,
        "start",
        _build_user(),
    )

    assert result == [
        {"id": "folder-a", "credential_id": "cred-a"},
        {"id": "folder-b", "credential_id": "cred-b"},
    ]
    assert [call.kwargs["credential_id"] for call in get_credentials.call_args_list] == ["cred-a", "cred-b"]


def test_format_datasource_info_list_distinguishes_no_credentials_from_missing_id(
    generator, monkeypatch: pytest.MonkeyPatch
):
    from core.datasource.datasource_manager import DatasourceManager

    workflow = _build_workflow(
        graph={
            "nodes": [
                {
                    "id": "start",
                    "data": {
                        "plugin_id": "p",
                        "provider_name": "provider",
                        "datasource_name": "drive",
                        "credential_id": "stored-private",
                    },
                }
            ]
        },
    )

    @dataclass
    class RuntimeState:
        credentials: dict[str, str]

    @dataclass
    class Runtime:
        runtime: RuntimeState

    no_credentials_runtime = Runtime(RuntimeState({"unexpected": "default"}))
    stored_credentials_runtime = Runtime(RuntimeState({}))
    runtimes = iter([no_credentials_runtime, stored_credentials_runtime])
    credential_calls: list[dict[str, object]] = []

    def get_runtime(**_kwargs):
        return next(runtimes)

    def get_credentials(**kwargs):
        credential_calls.append(kwargs)
        return {"token": "stored-secret"}

    monkeypatch.setattr(DatasourceManager, "get_datasource_runtime", get_runtime)
    monkeypatch.setattr(generator._datasource_providers, "get_datasource_credentials", get_credentials)

    explicit_none = generator.expand_datasource_info_list(
        DatasourceProviderType.ONLINE_DRIVE,
        [{"id": "public-file", "type": "file", "name": "Public", "credential_id": None}],
        _build_pipeline(),
        workflow,
        "start",
        _build_user(),
    )
    missing_id = generator.expand_datasource_info_list(
        DatasourceProviderType.ONLINE_DRIVE,
        [{"id": "private-file", "type": "file", "name": "Private"}],
        _build_pipeline(),
        workflow,
        "start",
        _build_user(),
    )

    assert explicit_none == [{"id": "public-file", "name": "Public", "bucket": None, "credential_id": None}]
    assert no_credentials_runtime.runtime.credentials == {}
    assert missing_id == [{"id": "private-file", "name": "Private", "bucket": None, "credential_id": "stored-private"}]
    assert stored_credentials_runtime.runtime.credentials == {"token": "stored-secret"}
    assert [call["credential_id"] for call in credential_calls] == ["stored-private"]


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
            self.calls.append((request.prefix, request.next_page_parameters))
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
            return iter([Result([FilesPage([File("f3", "file3", "file")], False, None)])])

    runtime = Runtime()
    all_files = []

    generator._get_files_in_folder(
        datasource_runtime=runtime,
        prefix="root",
        bucket="b",
        user_id="user",
        all_files=all_files,
        datasource_info={"credential_id": "actor-visible"},
    )

    assert {f["id"] for f in all_files} == {"f1", "f2", "f3"}
    assert {f["credential_id"] for f in all_files} == {"actor-visible"}
    assert runtime.calls == [("root", None), ("fd", None), ("root", {"page": 2})]


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
