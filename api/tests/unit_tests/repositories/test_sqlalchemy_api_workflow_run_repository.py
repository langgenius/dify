from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from graphon.entities import WorkflowExecution
from graphon.nodes.human_input.entities import FormDefinition, ParagraphInputConfig, UserActionConfig
from graphon.nodes.human_input.enums import FormInputType
from models.human_input import RecipientType
from repositories.sqlalchemy_api_workflow_run_repository import (
    DifyAPISQLAlchemyWorkflowRunRepository,
    _build_human_input_required_reason,
)


class _ConcreteRunRepo(DifyAPISQLAlchemyWorkflowRunRepository):
    def save(self, execution: WorkflowExecution) -> None:
        pass


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


def _make_run_repo() -> tuple[_ConcreteRunRepo, MagicMock]:
    session = MagicMock()
    session_maker = MagicMock()
    session_maker.return_value.__enter__.return_value = session
    return _ConcreteRunRepo(session_maker), session


def test_delete_runs_by_ids_rowcount_none_returns_zero() -> None:
    repo, session = _make_run_repo()
    delete_result = MagicMock()
    delete_result.rowcount = None
    session.execute.return_value = delete_result

    assert repo.delete_runs_by_ids(["run-1", "run-2"]) == 0


def test_delete_runs_by_app_rowcount_none_returns_zero() -> None:
    repo, session = _make_run_repo()
    # select returns one ID (< default batch_size), loop exits after first batch
    session.scalars.return_value.all.return_value = ["run-1"]
    delete_result = MagicMock()
    delete_result.rowcount = None
    session.execute.return_value = delete_result

    assert repo.delete_runs_by_app("tenant-1", "app-1") == 0
