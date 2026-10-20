import ast
import inspect
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from models.enums import AppTriggerType, WorkflowRunTriggeredFrom
from models.model import AppMode
from repositories.workflow.definition_repository import workflow_snapshot
from services.errors.app import WorkflowNotFoundError
from services.workflow.contracts import WorkflowSnapshot
from services.workflow.entities import TriggerData, WorkflowTaskData
from tasks import async_workflow_tasks
from tests.unit_tests.model_factories import make_account, make_app, make_workflow


def _session_context(session: MagicMock) -> MagicMock:
    context = MagicMock()
    context.__enter__.return_value = session
    context.__exit__.return_value = False
    return context


def test_execute_workflow_projects_the_persisted_workflow_before_generation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workflow_model = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    app = make_app(app_id="app-1", tenant_id="tenant-1", workflow_id=workflow_model.id)
    user = make_account(account_id="account-1")
    trigger_data = TriggerData(
        app_id=app.id,
        tenant_id=app.tenant_id,
        workflow_id=workflow_model.id,
        root_node_id="start",
        inputs={"question": "hello"},
        trigger_type=AppTriggerType.TRIGGER_SCHEDULE,
        trigger_from=WorkflowRunTriggeredFrom.SCHEDULE,
    )
    trigger_log = SimpleNamespace(
        id="trigger-log-1",
        app_id=app.id,
        workflow_id=workflow_model.id,
        trigger_data=trigger_data.model_dump_json(),
        status=None,
    )

    session = MagicMock()
    session.scalar.side_effect = [app, workflow_model]
    task_session_factory = MagicMock()
    task_session_factory.create_session.return_value = _session_context(session)
    task_session_factory.get_session_maker.return_value = MagicMock()
    trigger_log_repository = MagicMock()
    trigger_log_repository.get_by_id.return_value = trigger_log
    generator = MagicMock()

    monkeypatch.setattr(async_workflow_tasks, "session_factory", task_session_factory)
    monkeypatch.setattr(
        async_workflow_tasks,
        "SQLAlchemyWorkflowTriggerLogRepository",
        MagicMock(return_value=trigger_log_repository),
    )
    monkeypatch.setattr(async_workflow_tasks, "_get_user", MagicMock(return_value=user))
    monkeypatch.setattr(async_workflow_tasks, "build_workflow_execution_dependencies", MagicMock())
    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", MagicMock(return_value=generator))
    monkeypatch.setattr(async_workflow_tasks, "TriggerPostLayer", MagicMock(return_value=MagicMock()))

    async_workflow_tasks._execute_workflow_common(
        WorkflowTaskData(workflow_trigger_log_id=trigger_log.id),
        MagicMock(),
        MagicMock(),
    )

    execution_workflow = generator.generate.call_args.kwargs["workflow"]
    assert isinstance(execution_workflow, WorkflowSnapshot)
    assert execution_workflow == workflow_snapshot(workflow_model)
    assert execution_workflow is not workflow_model


def test_resume_workflow_projects_the_persisted_workflow_before_resuming(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workflow_model = make_workflow(workflow_id="workflow-1", tenant_id="tenant-1", app_id="app-1")
    app = make_app(app_id="app-1", tenant_id="tenant-1", workflow_id=workflow_model.id)
    user = make_account(account_id="account-1")
    workflow_run = SimpleNamespace(
        id="workflow-run-1",
        task_id="task-1",
        workflow_id=workflow_model.id,
        app_id=app.id,
        triggered_from=WorkflowRunTriggeredFrom.SCHEDULE,
    )
    pause_entity = MagicMock(id="pause-1", workflow_execution_id=workflow_run.id)
    pause_entity.get_state.return_value = b"serialized-resumption-context"
    workflow_run_repository = MagicMock()
    workflow_run_repository.get_workflow_pause.return_value = pause_entity
    workflow_run_repository.get_workflow_run_by_id_without_tenant.return_value = workflow_run

    generate_entity = WorkflowAppGenerateEntity(
        task_id="task-1",
        app_config=WorkflowUIBasedAppConfig(
            tenant_id=app.tenant_id,
            app_id=app.id,
            app_mode=AppMode.WORKFLOW,
            workflow_id=workflow_model.id,
        ),
        inputs={},
        files=[],
        user_id=user.id,
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        workflow_execution_id=workflow_run.id,
    )
    resumption_context = MagicMock()
    resumption_context.get_generate_entity.return_value = generate_entity
    resumption_context.serialized_graph_runtime_state = "serialized-runtime-state"
    response_stream_filter = MagicMock()
    resumption_context.get_response_stream_filter.return_value = response_stream_filter
    graph_runtime_state = MagicMock()

    session = MagicMock()
    session.scalar.side_effect = [workflow_model, app]
    resumed_session_factory = MagicMock()
    resumed_session_factory.return_value = _session_context(session)
    generator = MagicMock()
    execution_repository = MagicMock()
    node_execution_repository = MagicMock()

    monkeypatch.setattr(async_workflow_tasks, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(async_workflow_tasks, "sessionmaker", MagicMock(return_value=resumed_session_factory))
    monkeypatch.setattr(
        async_workflow_tasks.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        MagicMock(return_value=workflow_run_repository),
    )
    monkeypatch.setattr(
        async_workflow_tasks.WorkflowResumptionContext,
        "loads",
        MagicMock(return_value=resumption_context),
    )
    monkeypatch.setattr(
        async_workflow_tasks.RuntimeState,
        "from_snapshot",
        MagicMock(return_value=graph_runtime_state),
    )
    monkeypatch.setattr(async_workflow_tasks, "_get_user", MagicMock(return_value=user))
    monkeypatch.setattr(
        async_workflow_tasks.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        MagicMock(return_value=execution_repository),
    )
    monkeypatch.setattr(
        async_workflow_tasks.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        MagicMock(return_value=node_execution_repository),
    )
    monkeypatch.setattr(async_workflow_tasks, "build_workflow_execution_dependencies", MagicMock())
    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", MagicMock(return_value=generator))
    monkeypatch.setattr(async_workflow_tasks, "_query_trigger_log_info", MagicMock(return_value=None))

    async_workflow_tasks.resume_workflow_execution.run({"workflow_run_id": workflow_run.id})

    resumed_workflow = generator.resume.call_args.kwargs["workflow"]
    assert isinstance(resumed_workflow, WorkflowSnapshot)
    assert resumed_workflow == workflow_snapshot(workflow_model)
    assert resumed_workflow is not workflow_model
    workflow_run_repository.resume_workflow_pause.assert_called_once_with(workflow_run.id, pause_entity)
    workflow_run_repository.delete_workflow_pause.assert_called_once_with(pause_entity)


def test_workflow_not_found_error_message_is_a_single_formatted_string():
    # Regression: previously raised with printf-style positional args
    # ("...%s...", id1, id2), which made Exception store them as a tuple
    # and str(exc) rendered the literal tuple instead of a readable message.
    workflow_run_id = "wr-123"
    workflow_id = "wf-456"

    exc = WorkflowNotFoundError(f"Workflow not found: workflow_run_id={workflow_run_id}, workflow_id={workflow_id}")

    # The exception must stringify to the fully-interpolated message and must
    # not contain unresolved %s placeholders nor tuple punctuation.
    rendered = str(exc)
    assert rendered == "Workflow not found: workflow_run_id=wr-123, workflow_id=wf-456"
    assert "%s" not in rendered
    assert not rendered.startswith("(")
    assert exc.args == ("Workflow not found: workflow_run_id=wr-123, workflow_id=wf-456",)


def test_app_not_found_error_message_is_a_single_formatted_string():
    # Same regression check for the _AppNotFoundError raise site in the same
    # function (resume_workflow_execution).
    app_id = "app-789"
    workflow_run_id = "wr-123"

    exc = async_workflow_tasks._AppNotFoundError(f"App not found: app_id={app_id}, workflow_run_id={workflow_run_id}")

    rendered = str(exc)
    assert rendered == "App not found: app_id=app-789, workflow_run_id=wr-123"
    assert "%s" not in rendered
    assert not rendered.startswith("(")
    assert exc.args == ("App not found: app_id=app-789, workflow_run_id=wr-123",)


def _collect_raise_calls_in(func_name: str) -> list[ast.Call]:
    """Walk the AST of async_workflow_tasks and return every Call inside a Raise
    inside the function named ``func_name``.

    This lets us assert at unit-test time that no raise site in a critical
    function passes printf-style positional args to an Exception constructor
    (which would otherwise be stored verbatim in ``exc.args`` and stringify
    as a tuple-repr instead of a human-readable message).
    """
    source = inspect.getsource(async_workflow_tasks)
    tree = ast.parse(source)
    raises: list[ast.Call] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == func_name:
            for sub in ast.walk(node):
                if isinstance(sub, ast.Raise) and isinstance(sub.exc, ast.Call):
                    raises.append(sub.exc)
    return raises


def test_resume_workflow_execution_raises_do_not_use_printf_positional_args():
    """Regression: ``resume_workflow_execution`` previously raised
    ``WorkflowNotFoundError("Workflow not found: workflow_run_id=%s, ...", run_id, wf_id)``
    and ``_AppNotFoundError("App not found: app_id=%s, ...", app_id, run_id)``.

    Python's ``Exception.__init__`` then stored all three as ``exc.args`` and
    ``str(exc)`` produced ``("Workflow not found: ...%s...", 'id1', 'id2')``
    rather than a usable message.

    Lock this in by walking the function's AST: every ``raise SomeError(...)``
    inside ``resume_workflow_execution`` must pass exactly one positional
    argument (the rendered message), or be a no-arg raise. If anyone reverts
    to the printf pattern, this test fails fast at unit-test time.
    """
    raise_calls = _collect_raise_calls_in("resume_workflow_execution")

    assert raise_calls, "Expected raise sites inside resume_workflow_execution to inspect"
    for call in raise_calls:
        assert len(call.args) <= 1, (
            f"raise {ast.unparse(call)} passes {len(call.args)} positional args; "
            "Exception classes accept a single rendered message. Use an f-string "
            "instead of printf-style ('...%s...', val1, val2)."
        )
        # Also reject %s in a literal first arg as belt-and-braces.
        if call.args and isinstance(call.args[0], ast.Constant) and isinstance(call.args[0].value, str):
            assert "%s" not in call.args[0].value, (
                f"raise {ast.unparse(call)} still contains '%s' in its message; use an f-string."
            )
