import ast
import inspect

from core.app.apps.workflow.app_generator import SKIP_PREPARE_USER_INPUTS_KEY
from services.errors.app import WorkflowNotFoundError
from services.workflow.entities import WebhookTriggerData
from tasks import async_workflow_tasks


def test_build_generator_args_sets_skip_flag_for_webhook():
    trigger_data = WebhookTriggerData(
        app_id="app",
        tenant_id="tenant",
        workflow_id="workflow",
        root_node_id="node",
        inputs={"webhook_data": {"body": {"foo": "bar"}}},
    )

    args = async_workflow_tasks._build_generator_args(trigger_data)

    assert args[SKIP_PREPARE_USER_INPUTS_KEY] is True
    assert args["inputs"]["webhook_data"]["body"]["foo"] == "bar"


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


# ---------------------------------------------------------------------------
# Rollback of poisoned session in _execute_workflow_common failure path
# ---------------------------------------------------------------------------
#
# Regression: when WorkflowAppGenerator.generate() raised a SQLAlchemy
# flush error, the session was left in a failed-transaction state. The
# bookkeeping block then attempted session.commit() and raised
# PendingRollbackError, dropping the failure record.
#
# The fix rolls back the session inside the except block before the
# bookkeeping updates, and reloads trigger_log from the repository.


def test_execute_workflow_common_rolls_back_poisoned_session_before_bookkeeping(monkeypatch):
    from contextlib import contextmanager
    from unittest.mock import MagicMock

    from tasks import async_workflow_tasks

    session = MagicMock(name="session")
    trigger_log = MagicMock(name="trigger_log")
    trigger_log.id = "trigger-log-1"

    @contextmanager
    def _session_ctx():
        yield session

    monkeypatch.setattr(async_workflow_tasks, "session_factory")
    async_workflow_tasks.session_factory.create_session = _session_ctx

    repo = MagicMock(name="repo")
    repo.get_by_id.return_value = trigger_log
    monkeypatch.setattr(
        async_workflow_tasks, "SQLAlchemyWorkflowTriggerLogRepository", lambda _session: repo
    )

    # generator.generate() raises a SQLAlchemy flush error.
    generator = MagicMock(name="generator")
    generator.generate.side_effect = RuntimeError("flush error")

    class _FakeGenerator:
        def __init__(self):
            self._g = generator

        def generate(self, **kwargs):
            return self._g.generate(**kwargs)

    monkeypatch.setattr(async_workflow_tasks, "WorkflowAppGenerator", _FakeGenerator)

    # Configure the rest of the mocks the function needs. Anything not
    # explicitly configured returns a MagicMock, which is enough for this
    # smoke check on the rollback/commit ordering.
    task_data = MagicMock(name="task_data")
    task_data.workflow_trigger_log_id = "trigger-log-1"
    scheduler = MagicMock(name="scheduler")
    entity = MagicMock(name="entity")

    async_workflow_tasks._execute_workflow_common(task_data, scheduler, entity)

    # The session must have been rolled back before the bookkeeping commit.
    session.rollback.assert_called_once()
    # And the bookkeeping commit must succeed.
    assert session.commit.called, "expected the bookkeeping commit to be called"
    # trigger_log must be re-fetched after the rollback so attribute writes
    # bind to the now-clean session.
    repo.get_by_id.assert_called_with("trigger-log-1")
    # The bookkeeping write should mark the log as FAILED with the original error.
    assert trigger_log.status == async_workflow_tasks.WorkflowTriggerStatus.FAILED
    assert trigger_log.error == "flush error"
