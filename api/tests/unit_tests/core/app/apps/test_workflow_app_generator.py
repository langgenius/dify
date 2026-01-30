from types import SimpleNamespace
from unittest.mock import MagicMock

from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY, WorkflowAppGenerator


def test_should_prepare_user_inputs_defaults_to_true():
    args = {"inputs": {}}

    assert WorkflowAppGenerator()._should_prepare_user_inputs(args)


def test_should_prepare_user_inputs_skips_when_flag_truthy():
    args = {"inputs": {}, SKIP_PREPARE_USER_INPUTS_KEY: True}

    assert not WorkflowAppGenerator()._should_prepare_user_inputs(args)


def test_should_prepare_user_inputs_keeps_validation_when_flag_false():
    args = {"inputs": {}, SKIP_PREPARE_USER_INPUTS_KEY: False}

    assert WorkflowAppGenerator()._should_prepare_user_inputs(args)


def test_resume_delegates_to_generate(mocker):
    generator = WorkflowAppGenerator()
    mock_generate = mocker.patch.object(generator, "_generate", return_value="ok")

    application_generate_entity = SimpleNamespace(stream=False, invoke_from="debugger")
    runtime_state = MagicMock(name="runtime-state")
    pause_config = MagicMock(name="pause-config")

    result = generator.resume(
        app_model=MagicMock(),
        workflow=MagicMock(),
        user=MagicMock(),
        application_generate_entity=application_generate_entity,
        graph_runtime_state=runtime_state,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        graph_engine_layers=("layer",),
        pause_state_config=pause_config,
        variable_loader=MagicMock(),
    )

    assert result == "ok"
    mock_generate.assert_called_once()
    kwargs = mock_generate.call_args.kwargs
    assert kwargs["graph_runtime_state"] is runtime_state
    assert kwargs["pause_state_config"] is pause_config
    assert kwargs["streaming"] is False
    assert kwargs["invoke_from"] == "debugger"


def test_generate_appends_pause_layer_and_forwards_state(mocker):
    generator = WorkflowAppGenerator()

    mock_queue_manager = MagicMock()
    mocker.patch("core.app.apps.workflow.app_generator.WorkflowAppQueueManager", return_value=mock_queue_manager)

    fake_current_app = MagicMock()
    fake_current_app._get_current_object.return_value = MagicMock()
    mocker.patch("core.app.apps.workflow.app_generator.current_app", fake_current_app)

    mocker.patch(
        "core.app.apps.workflow.app_generator.WorkflowAppGenerateResponseConverter.convert",
        return_value="converted",
    )
    mocker.patch.object(WorkflowAppGenerator, "_handle_response", return_value="response")
    mocker.patch.object(WorkflowAppGenerator, "_get_draft_var_saver_factory", return_value=MagicMock())

    pause_layer = MagicMock(name="pause-layer")
    mocker.patch(
        "core.app.apps.workflow.app_generator.PauseStatePersistenceLayer",
        return_value=pause_layer,
    )

    dummy_session = MagicMock()
    dummy_session.close = MagicMock()
    mocker.patch("core.app.apps.workflow.app_generator.db.session", dummy_session)

    worker_kwargs: dict[str, object] = {}

    class DummyThread:
        def __init__(self, target, kwargs):
            worker_kwargs["target"] = target
            worker_kwargs["kwargs"] = kwargs

        def start(self):
            return None

    mocker.patch("core.app.apps.workflow.app_generator.threading.Thread", DummyThread)

    app_model = SimpleNamespace(mode="workflow")
    app_config = SimpleNamespace(app_id="app", tenant_id="tenant", workflow_id="wf")
    application_generate_entity = SimpleNamespace(
        task_id="task",
        user_id="user",
        invoke_from="service-api",
        app_config=app_config,
        files=[],
        stream=True,
        workflow_execution_id="run",
    )

    graph_runtime_state = MagicMock()

    result = generator._generate(
        app_model=app_model,
        workflow=MagicMock(),
        user=MagicMock(),
        application_generate_entity=application_generate_entity,
        invoke_from="service-api",
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        streaming=True,
        graph_engine_layers=("base-layer",),
        graph_runtime_state=graph_runtime_state,
        pause_state_config=SimpleNamespace(session_factory=MagicMock(), state_owner_user_id="owner"),
    )

    assert result == "converted"
    assert worker_kwargs["kwargs"]["graph_engine_layers"] == ("base-layer", pause_layer)
    assert worker_kwargs["kwargs"]["graph_runtime_state"] is graph_runtime_state


def test_resume_path_runs_worker_with_runtime_state(mocker):
    generator = WorkflowAppGenerator()
    runtime_state = MagicMock(name="runtime-state")

    pause_layer = MagicMock(name="pause-layer")
    mocker.patch("core.app.apps.workflow.app_generator.PauseStatePersistenceLayer", return_value=pause_layer)

    queue_manager = MagicMock()
    mocker.patch("core.app.apps.workflow.app_generator.WorkflowAppQueueManager", return_value=queue_manager)

    mocker.patch.object(generator, "_handle_response", return_value="raw-response")
    mocker.patch(
        "core.app.apps.workflow.app_generator.WorkflowAppGenerateResponseConverter.convert",
        side_effect=lambda response, invoke_from: response,
    )

    fake_db = SimpleNamespace(session=MagicMock(), engine=MagicMock())
    mocker.patch("core.app.apps.workflow.app_generator.db", fake_db)

    workflow = SimpleNamespace(
        id="workflow", tenant_id="tenant", app_id="app", graph_dict={}, type="workflow", version="1"
    )
    end_user = SimpleNamespace(session_id="end-user-session")
    app_record = SimpleNamespace(id="app")

    session = MagicMock()
    session.__enter__.return_value = session
    session.__exit__.return_value = False
    session.scalar.side_effect = [workflow, end_user, app_record]
    mocker.patch("core.app.apps.workflow.app_generator.session_factory", return_value=session)

    runner_instance = MagicMock()

    def runner_ctor(**kwargs):
        assert kwargs["graph_runtime_state"] is runtime_state
        return runner_instance

    mocker.patch("core.app.apps.workflow.app_generator.WorkflowAppRunner", side_effect=runner_ctor)

    class ImmediateThread:
        def __init__(self, target, kwargs):
            target(**kwargs)

        def start(self):
            return None

    mocker.patch("core.app.apps.workflow.app_generator.threading.Thread", ImmediateThread)

    mocker.patch(
        "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_execution_repository",
        return_value=MagicMock(),
    )
    mocker.patch(
        "core.app.apps.workflow.app_generator.DifyCoreRepositoryFactory.create_workflow_node_execution_repository",
        return_value=MagicMock(),
    )

    pause_config = SimpleNamespace(session_factory=MagicMock(), state_owner_user_id="owner")

    app_model = SimpleNamespace(mode="workflow")
    app_config = SimpleNamespace(app_id="app", tenant_id="tenant", workflow_id="workflow")
    application_generate_entity = SimpleNamespace(
        task_id="task",
        user_id="user",
        invoke_from="service-api",
        app_config=app_config,
        files=[],
        stream=True,
        workflow_execution_id="run",
        trace_manager=MagicMock(),
    )

    result = generator.resume(
        app_model=app_model,
        workflow=workflow,
        user=MagicMock(),
        application_generate_entity=application_generate_entity,
        graph_runtime_state=runtime_state,
        workflow_execution_repository=MagicMock(),
        workflow_node_execution_repository=MagicMock(),
        pause_state_config=pause_config,
    )

    assert result == "raw-response"
    runner_instance.run.assert_called_once()
    queue_manager.graph_runtime_state = runtime_state
