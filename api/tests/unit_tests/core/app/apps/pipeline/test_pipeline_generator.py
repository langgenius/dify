import contextlib
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock

import pytest
from pytest_mock import MockerFixture

import core.app.apps.pipeline.pipeline_generator as module
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import InvokeFrom
from core.datasource.entities.datasource_entities import DatasourceProviderType
from models.enums import DataSourceType


class FakeRagPipelineGenerateEntity(SimpleNamespace):
    class SingleIterationRunEntity(SimpleNamespace):
        pass

    class SingleLoopRunEntity(SimpleNamespace):
        pass

    def model_dump(self):
        return dict(self.__dict__)


@pytest.fixture
def generator(mocker: MockerFixture):
    gen = module.PipelineGenerator()

    mocker.patch.object(module, "RagPipelineGenerateEntity", FakeRagPipelineGenerateEntity)
    mocker.patch.object(module, "RagPipelineInvokeEntity", side_effect=lambda **kwargs: kwargs)
    mocker.patch.object(module.contexts, "plugin_tool_providers", SimpleNamespace(set=MagicMock()))
    mocker.patch.object(module.contexts, "plugin_tool_providers_lock", SimpleNamespace(set=MagicMock()))

    return gen


def _build_pipeline_dataset():
    return SimpleNamespace(
        id="ds",
        name="dataset",
        description="desc",
        chunk_structure="chunk",
        built_in_field_enabled=True,
        tenant_id="tenant",
    )


def _build_pipeline():
    pipeline = MagicMock(tenant_id="tenant", id="pipe")
    pipeline.retrieve_dataset.return_value = _build_pipeline_dataset()
    return pipeline


def _build_workflow():
    return MagicMock(id="wf", graph_dict={"nodes": [], "edges": []}, tenant_id="tenant")


def _build_user():
    return MagicMock(id="user", name="User", session_id="session")


def _build_args():
    return {
        "inputs": {"k": "v"},
        "start_node_id": "start",
        "datasource_type": DatasourceProviderType.LOCAL_FILE.value,
        "datasource_info_list": [{"name": "file"}],
    }


def _patch_session(mocker, session):
    mocker.patch.object(module, "Session", return_value=session)
    mocker.patch.object(type(module.db), "engine", new_callable=PropertyMock, return_value=MagicMock())


def _dummy_preserve(*args, **kwargs):
    return contextlib.nullcontext()


class DummySession:
    def __init__(self):
        self.scalar = MagicMock()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_generate_dataset_missing(generator, mocker: MockerFixture):
    pipeline = _build_pipeline()
    pipeline.retrieve_dataset.return_value = None

    session = DummySession()
    _patch_session(mocker, session)

    with pytest.raises(ValueError):
        generator.generate(
            pipeline=pipeline,
            workflow=_build_workflow(),
            user=_build_user(),
            args=_build_args(),
            invoke_from=InvokeFrom.WEB_APP,
            streaming=False,
        )


def test_generate_debugger_calls_generate(generator, mocker: MockerFixture):
    pipeline = _build_pipeline()
    workflow = _build_workflow()

    session = DummySession()
    _patch_session(mocker, session)

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
        pipeline=pipeline,
        workflow=workflow,
        user=_build_user(),
        args=_build_args(),
        invoke_from=InvokeFrom.DEBUGGER,
        streaming=True,
    )

    assert result == {"result": "ok"}


def test_generate_published_pipeline_creates_documents_and_delay(generator, mocker: MockerFixture):
    pipeline = _build_pipeline()
    workflow = _build_workflow()

    session = DummySession()
    _patch_session(mocker, session)

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

    mocker.patch("services.dataset_service.DocumentService.get_documents_position", return_value=1)

    document1 = SimpleNamespace(
        id="doc1",
        position=1,
        data_source_type=DatasourceProviderType.LOCAL_FILE,
        data_source_info="{}",
        name="file1",
        indexing_status="",
        error=None,
        enabled=True,
    )
    document2 = SimpleNamespace(
        id="doc2",
        position=2,
        data_source_type=DatasourceProviderType.LOCAL_FILE,
        data_source_info="{}",
        name="file2",
        indexing_status="",
        error=None,
        enabled=True,
    )
    mocker.patch.object(generator, "_build_document", side_effect=[document1, document2])

    mocker.patch.object(module, "DocumentPipelineExecutionLog", return_value=MagicMock())

    db_session = MagicMock()
    mocker.patch.object(module.db, "session", db_session)

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
        pipeline=pipeline,
        workflow=workflow,
        user=_build_user(),
        args=_build_args(),
        invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
        streaming=False,
    )

    assert result["batch"]
    assert len(result["documents"]) == 2
    task_proxy.delay.assert_called_once()


def test_generate_is_retry_calls_generate(generator, mocker: MockerFixture):
    pipeline = _build_pipeline()
    workflow = _build_workflow()

    session = DummySession()
    _patch_session(mocker, session)

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
        pipeline=pipeline,
        workflow=workflow,
        user=_build_user(),
        args=_build_args(),
        invoke_from=InvokeFrom.PUBLISHED_PIPELINE,
        streaming=True,
        is_retry=True,
    )

    assert result == {"result": "ok"}


def test_generate_worker_handles_errors(generator, mocker: MockerFixture):
    flask_app = MagicMock()
    flask_app.app_context.return_value = contextlib.nullcontext()
    mocker.patch.object(module, "preserve_flask_contexts", _dummy_preserve)
    mocker.patch.object(module.db, "session", MagicMock(close=MagicMock()))
    mocker.patch.object(type(module.db), "engine", new_callable=PropertyMock, return_value=MagicMock())

    application_generate_entity = FakeRagPipelineGenerateEntity(
        app_config=SimpleNamespace(tenant_id="tenant", app_id="pipe", workflow_id="wf"),
        invoke_from=InvokeFrom.WEB_APP,
        user_id="user",
    )

    session = DummySession()
    session.scalar.side_effect = [MagicMock(), MagicMock(session_id="session")]
    _patch_session(mocker, session)

    runner_instance = MagicMock()
    runner_instance.run.side_effect = ValueError("bad")
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


def test_generate_worker_sets_system_user_id_for_external_call(generator, mocker: MockerFixture):
    flask_app = MagicMock()
    flask_app.app_context.return_value = contextlib.nullcontext()
    mocker.patch.object(module, "preserve_flask_contexts", _dummy_preserve)
    mocker.patch.object(module.db, "session", MagicMock(close=MagicMock()))
    mocker.patch.object(type(module.db), "engine", new_callable=PropertyMock, return_value=MagicMock())

    application_generate_entity = FakeRagPipelineGenerateEntity(
        app_config=SimpleNamespace(tenant_id="tenant", app_id="pipe", workflow_id="wf"),
        invoke_from=InvokeFrom.WEB_APP,
        user_id="user",
    )

    session = DummySession()
    session.scalar.side_effect = [MagicMock(), MagicMock(session_id="session")]
    _patch_session(mocker, session)

    runner_instance = MagicMock()
    mocker.patch.object(module, "PipelineRunner", return_value=runner_instance)

    generator._generate_worker(
        flask_app=flask_app,
        application_generate_entity=application_generate_entity,
        queue_manager=MagicMock(),
        context=contextlib.nullcontext(),
        variable_loader=MagicMock(),
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
    )

    assert module.PipelineRunner.call_args.kwargs["system_user_id"] == "session"


def test_generate_raises_when_workflow_not_found(generator, mocker: MockerFixture):
    flask_app = MagicMock()
    mocker.patch.object(module, "preserve_flask_contexts", _dummy_preserve)

    session = MagicMock()
    session.get.return_value = None
    mocker.patch.object(module.db, "session", session)

    with pytest.raises(ValueError):
        generator._generate(
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


def test_generate_success_returns_converted(generator, mocker: MockerFixture):
    flask_app = MagicMock()
    mocker.patch.object(module, "preserve_flask_contexts", _dummy_preserve)

    workflow = MagicMock(id="wf", tenant_id="tenant", app_id="pipe", graph_dict={})
    session = MagicMock()
    session.get.return_value = workflow
    mocker.patch.object(module.db, "session", session)

    queue_manager = MagicMock()
    mocker.patch.object(module, "PipelineQueueManager", return_value=queue_manager)

    worker_thread = MagicMock()
    mocker.patch.object(module.threading, "Thread", return_value=worker_thread)

    mocker.patch.object(generator, "_get_draft_var_saver_factory", return_value=MagicMock())
    mocker.patch.object(generator, "_handle_response", return_value="response")
    mocker.patch.object(module.WorkflowAppGenerateResponseConverter, "convert", return_value="converted")

    result = generator._generate(
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

    assert result == "converted"


def test_single_iteration_generate_validates_inputs(generator, mocker: MockerFixture):
    with pytest.raises(ValueError):
        generator.single_iteration_generate(_build_pipeline(), _build_workflow(), "", _build_user(), {})

    with pytest.raises(ValueError):
        generator.single_iteration_generate(
            _build_pipeline(), _build_workflow(), "node", _build_user(), {"inputs": None}
        )


def test_single_iteration_generate_dataset_required(generator, mocker: MockerFixture):
    pipeline = _build_pipeline()
    pipeline.retrieve_dataset.return_value = None

    session = DummySession()
    _patch_session(mocker, session)

    with pytest.raises(ValueError):
        generator.single_iteration_generate(
            pipeline,
            _build_workflow(),
            "node",
            _build_user(),
            {"inputs": {"a": 1}},
        )


def test_single_iteration_generate_success(generator, mocker: MockerFixture):
    pipeline = _build_pipeline()

    session = DummySession()
    _patch_session(mocker, session)

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
    mocker.patch.object(module.db, "session", MagicMock(return_value=MagicMock()))

    mocker.patch.object(module, "WorkflowDraftVariableService", return_value=MagicMock())
    mocker.patch.object(module, "DraftVarLoader", return_value=MagicMock())

    mocker.patch.object(generator, "_generate", return_value={"ok": True})

    result = generator.single_iteration_generate(
        pipeline,
        _build_workflow(),
        "node",
        _build_user(),
        {"inputs": {"a": 1}},
        streaming=False,
    )

    assert result == {"ok": True}


def test_single_loop_generate_success(generator, mocker: MockerFixture):
    pipeline = _build_pipeline()

    session = DummySession()
    _patch_session(mocker, session)

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
    mocker.patch.object(module.db, "session", MagicMock(return_value=MagicMock()))

    mocker.patch.object(module, "WorkflowDraftVariableService", return_value=MagicMock())
    mocker.patch.object(module, "DraftVarLoader", return_value=MagicMock())

    mocker.patch.object(generator, "_generate", return_value={"ok": True})

    result = generator.single_loop_generate(
        pipeline,
        _build_workflow(),
        "node",
        _build_user(),
        {"inputs": {"a": 1}},
        streaming=False,
    )

    assert result == {"ok": True}


def test_handle_response_value_error_triggers_generate_task_stopped(generator, mocker: MockerFixture):
    pipeline = _build_pipeline()
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


def test_build_document_sets_metadata_for_builtin_fields(generator, mocker: MockerFixture):
    class DummyDocument(SimpleNamespace):
        pass

    mocker.patch.object(module, "Document", side_effect=lambda **kwargs: DummyDocument(**kwargs))

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
    assert document.doc_metadata


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


def test_build_document_invalid_datasource_type(generator):
    with pytest.raises(ValueError):
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
    workflow = MagicMock(graph_dict={"nodes": []})

    with pytest.raises(ValueError):
        generator._format_datasource_info_list(
            DatasourceProviderType.ONLINE_DRIVE,
            [],
            _build_pipeline(),
            workflow,
            "start",
            _build_user(),
        )


def test_format_datasource_info_list_online_drive_folder(generator, mocker: MockerFixture):
    workflow = MagicMock(
        graph_dict={
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
        }
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
