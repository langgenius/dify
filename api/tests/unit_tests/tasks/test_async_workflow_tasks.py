import ast
import inspect
from dataclasses import dataclass, field

import pytest

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, WorkflowAppGenerateEntity
from models.enums import AppTriggerType, WorkflowRunTriggeredFrom
from models.model import AppMode
from repositories.workflow.definition_repository import workflow_snapshot
from services.errors.app import WorkflowNotFoundError
from services.workflow.contracts import WorkflowSnapshot
from services.workflow.entities import TriggerData, WorkflowTaskData
from tasks import async_workflow_tasks
from tests.helpers.unit.model_factories import make_account, make_app, make_workflow


class _StubSession:
    def __init__(self, items: list[object]) -> None:
        self._items = iter(items)

    def scalar(self, *_args: object, **_kwargs: object) -> object:
        return next(self._items)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def flush(self) -> None:
        pass


class _SessionContext:
    def __init__(self, session: object) -> None:
        self.session = session

    def __enter__(self) -> object:
        return self.session

    def __exit__(self, *_args: object) -> None:
        pass


@dataclass
class _CallArgs:
    kwargs: dict[str, object]


class _TrackedGeneratorMethod:
    def __init__(self) -> None:
        self.call_args: _CallArgs | None = None

    def __call__(self, **kwargs: object) -> None:
        self.call_args = _CallArgs(kwargs)


class _GeneratorStub:
    def __init__(self) -> None:
        self.generate = _TrackedGeneratorMethod()
        self.resume = _TrackedGeneratorMethod()


class _SessionFactoryStub:
    def __init__(self, session: object) -> None:
        self.session = session

    def create_session(self) -> _SessionContext:
        return _SessionContext(self.session)

    def get_session_maker(self) -> object:
        return object()


class _TriggerLogRepoStub:
    def __init__(self, log: object) -> None:
        self.log = log

    def get_by_id(self, _id: str) -> object:
        return self.log

    def update(self, _log: object) -> None:
        pass


class _TrackedRepoMethod:
    def __init__(self) -> None:
        self.calls: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def __call__(self, *args: object, **kwargs: object) -> None:
        self.calls.append((args, kwargs))

    def assert_called_once_with(self, *args: object, **kwargs: object) -> None:
        assert self.calls == [(args, kwargs)]


class _WorkflowRunRepoStub:
    def __init__(self, run: object, pause: object) -> None:
        self.run = run
        self.pause = pause
        self.resume_workflow_pause = _TrackedRepoMethod()
        self.delete_workflow_pause = _TrackedRepoMethod()

    def get_workflow_pause(self, _id: str) -> object:
        return self.pause

    def get_workflow_run_by_id_without_tenant(self, _id: str) -> object:
        return self.run


class _ResumptionContextStub:
    def __init__(self, generate_entity: object) -> None:
        self._generate_entity = generate_entity
        self.serialized_graph_runtime_state = "serialized-runtime-state"

    def get_generate_entity(self) -> object:
        return self._generate_entity

    def get_response_stream_filter(self) -> object:
        return object()


@dataclass
class _TriggerLog:
    id: str
    app_id: str
    workflow_id: str
    trigger_data: str
    status: object = None


@dataclass
class _WorkflowRun:
    id: str
    task_id: str
    workflow_id: str
    app_id: str
    triggered_from: object


@dataclass
class _PauseEntity:
    id: str
    workflow_execution_id: str

    def get_state(self) -> bytes:
        return b"serialized-resumption-context"


@dataclass
class _Db:
    engine: object = field(default_factory=object)


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
    trigger_log = _TriggerLog(
        id="trigger-log-1",
        app_id=app.id,
        workflow_id=workflow_model.id,
        trigger_data=trigger_data.model_dump_json(),
        status=None,
    )

    session = _StubSession([app, workflow_model])
    task_session_factory = _SessionFactoryStub(session)
    trigger_log_repository = _TriggerLogRepoStub(trigger_log)
    generator = _GeneratorStub()

    monkeypatch.setattr(async_workflow_tasks, "session_factory", task_session_factory)
    monkeypatch.setattr(
        async_workflow_tasks,
        "SQLAlchemyWorkflowTriggerLogRepository",
        lambda *_args, **_kwargs: trigger_log_repository,
    )
    monkeypatch.setattr(async_workflow_tasks, "_get_user", lambda *_args, **_kwargs: user)
    monkeypatch.setattr(async_workflow_tasks, "build_workflow_execution_dependencies", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", lambda *_args, **_kwargs: generator)
    monkeypatch.setattr(async_workflow_tasks, "TriggerPostLayer", lambda *_args, **_kwargs: object())

    async_workflow_tasks._execute_workflow_common(
        WorkflowTaskData(workflow_trigger_log_id=trigger_log.id),
        object(),  # type: ignore[arg-type]
        object(),  # type: ignore[arg-type]
    )

    assert generator.generate.call_args is not None
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
    workflow_run = _WorkflowRun(
        id="workflow-run-1",
        task_id="task-1",
        workflow_id=workflow_model.id,
        app_id=app.id,
        triggered_from=WorkflowRunTriggeredFrom.SCHEDULE,
    )
    pause_entity = _PauseEntity(id="pause-1", workflow_execution_id=workflow_run.id)
    workflow_run_repository = _WorkflowRunRepoStub(workflow_run, pause_entity)

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
        user_from=UserFrom.ACCOUNT,
        stream=False,
        invoke_from=InvokeFrom.WEB_APP,
        workflow_execution_id=workflow_run.id,
    )
    resumption_context = _ResumptionContextStub(generate_entity)
    graph_runtime_state = object()

    session = _StubSession([workflow_model, app])
    resumed_session_factory = _SessionFactoryStub(session)
    generator = _GeneratorStub()
    execution_repository = object()
    node_execution_repository = object()

    monkeypatch.setattr(async_workflow_tasks, "db", _Db())
    monkeypatch.setattr(
        async_workflow_tasks, "sessionmaker", lambda *_args, **_kwargs: resumed_session_factory.create_session
    )
    monkeypatch.setattr(
        async_workflow_tasks.DifyAPIRepositoryFactory,
        "create_api_workflow_run_repository",
        lambda *_args, **_kwargs: workflow_run_repository,
    )
    monkeypatch.setattr(
        async_workflow_tasks.WorkflowResumptionContext,
        "loads",
        lambda *_args, **_kwargs: resumption_context,
    )
    monkeypatch.setattr(
        async_workflow_tasks.RuntimeState,
        "from_snapshot",
        lambda *_args, **_kwargs: graph_runtime_state,
    )
    monkeypatch.setattr(async_workflow_tasks, "_get_user", lambda *_args, **_kwargs: user)
    monkeypatch.setattr(
        async_workflow_tasks.DifyCoreRepositoryFactory,
        "create_workflow_execution_repository",
        lambda *_args, **_kwargs: execution_repository,
    )
    monkeypatch.setattr(
        async_workflow_tasks.DifyCoreRepositoryFactory,
        "create_workflow_node_execution_repository",
        lambda *_args, **_kwargs: node_execution_repository,
    )
    monkeypatch.setattr(async_workflow_tasks, "build_workflow_execution_dependencies", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", lambda *_args, **_kwargs: generator)
    monkeypatch.setattr(async_workflow_tasks, "_query_trigger_log_info", lambda *_args, **_kwargs: None)

    async_workflow_tasks.resume_workflow_execution.run({"workflow_run_id": workflow_run.id})

    assert generator.resume.call_args is not None
    resumed_workflow = generator.resume.call_args.kwargs["workflow"]
    assert isinstance(resumed_workflow, WorkflowSnapshot)
    assert resumed_workflow == workflow_snapshot(workflow_model)
    assert resumed_workflow is not workflow_model
    workflow_run_repository.resume_workflow_pause.assert_called_once_with(workflow_run.id, pause_entity)
    workflow_run_repository.delete_workflow_pause.assert_called_once_with(pause_entity)


def test_workflow_not_found_error_message_is_a_single_formatted_string() -> None:
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


def test_app_not_found_error_message_is_a_single_formatted_string() -> None:
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


def test_resume_workflow_execution_raises_do_not_use_printf_positional_args() -> None:
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
