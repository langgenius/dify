from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from graphon.nodes.human_input.entities import FormDefinition, ParagraphInputConfig, UserActionConfig
from graphon.nodes.human_input.enums import FormInputType
from models.human_input import RecipientType
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    _build_human_input_required_reason,
)


class _FakeScalarResult:
    def __init__(self, rows: list[str]) -> None:
        self._rows = rows

    def all(self) -> list[str]:
        return self._rows


class _FakeExecuteResult:
    rowcount: int | None

    def __init__(self, *, rowcount: int | None = None) -> None:
        self.rowcount = rowcount


class _FakeSession:
    def __init__(self, *, execute_results: list[_FakeExecuteResult], scalar_batches: list[list[str]] | None = None):
        self._execute_results = execute_results
        self._scalar_batches = scalar_batches or []

    def __enter__(self) -> _FakeSession:
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> None:
        return None

    def execute(self, _stmt: object) -> _FakeExecuteResult:
        return self._execute_results.pop(0)

    def scalars(self, _stmt: object) -> _FakeScalarResult:
        return _FakeScalarResult(self._scalar_batches.pop(0))

    def commit(self) -> None:
        return None


class _FakeSessionMaker:
    def __init__(self, sessions: list[_FakeSession]) -> None:
        self._sessions = sessions

    def __call__(self) -> _FakeSession:
        return self._sessions.pop(0)


def _build_form_model() -> SimpleNamespace:
    expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
    definition = FormDefinition(
        form_content="content",
        inputs=[ParagraphInputConfig(type=FormInputType.PARAGRAPH, output_variable_name="name")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        rendered_content="rendered",
        expiration_time=expiration_time,
        default_values={"name": "Alice"},
        node_title="Ask Name",
        display_in_ui=True,
    )
    return SimpleNamespace(
        id="form-1",
        node_id="node-1",
        form_definition=definition.model_dump_json(),
        expiration_time=expiration_time,
    )


def _build_reason_model() -> SimpleNamespace:
    return SimpleNamespace(form_id="form-1", node_id="node-1")


def test_delete_runs_by_ids_treats_unknown_rowcount_as_zero() -> None:
    session = _FakeSession(execute_results=[_FakeExecuteResult(rowcount=None)])
    repository = DifyAPISQLAlchemyWorkflowRunRepository(_FakeSessionMaker([session]))

    assert repository.delete_runs_by_ids(["run-1"]) == 0


def test_delete_runs_by_app_treats_unknown_rowcount_as_zero() -> None:
    session = _FakeSession(
        scalar_batches=[["run-1"]],
        execute_results=[_FakeExecuteResult(rowcount=None)],
    )
    repository = DifyAPISQLAlchemyWorkflowRunRepository(_FakeSessionMaker([session]))

    assert repository.delete_runs_by_app("tenant-1", "app-1") == 0


def test_build_human_input_required_reason_prefers_standalone_web_app_token() -> None:
    reason = _build_human_input_required_reason(
        _build_reason_model(),
        _build_form_model(),
        [
            SimpleNamespace(recipient_type=RecipientType.BACKSTAGE, access_token="btok"),
            SimpleNamespace(recipient_type=RecipientType.CONSOLE, access_token="ctok"),
            SimpleNamespace(recipient_type=RecipientType.STANDALONE_WEB_APP, access_token="wtok"),
        ],
    )

    assert reason.node_title == "Ask Name"
    assert reason.resolved_default_values == {"name": "Alice"}
    assert not hasattr(reason, "form_token")


def test_build_human_input_required_reason_falls_back_to_console_token() -> None:
    reason = _build_human_input_required_reason(
        _build_reason_model(),
        _build_form_model(),
        [
            SimpleNamespace(recipient_type=RecipientType.BACKSTAGE, access_token="btok"),
            SimpleNamespace(recipient_type=RecipientType.CONSOLE, access_token="ctok"),
        ],
    )

    assert reason.node_id == "node-1"
    assert reason.actions[0].id == "approve"
    assert not hasattr(reason, "form_token")
