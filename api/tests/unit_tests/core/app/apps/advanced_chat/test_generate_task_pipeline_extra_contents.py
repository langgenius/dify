from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from unittest import mock

import pytest

from core.app.apps.advanced_chat import generate_task_pipeline as pipeline_module
from core.app.entities.queue_entities import QueueWorkflowPausedEvent
from core.workflow.entities.pause_reason import HumanInputRequired
from models.enums import MessageStatus
from models.execution_extra_content import HumanInputContent


def _build_pipeline() -> pipeline_module.AdvancedChatAppGenerateTaskPipeline:
    pipeline = pipeline_module.AdvancedChatAppGenerateTaskPipeline.__new__(
        pipeline_module.AdvancedChatAppGenerateTaskPipeline
    )
    pipeline._workflow_run_id = "run-1"
    pipeline._message_id = "message-1"
    pipeline._workflow_tenant_id = "tenant-1"
    return pipeline


def test_persist_human_input_extra_content_adds_record(monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline = _build_pipeline()
    monkeypatch.setattr(pipeline, "_load_human_input_form_id", lambda **kwargs: "form-1")

    captured_session: dict[str, mock.Mock] = {}

    @contextmanager
    def fake_session():
        session = mock.Mock()
        session.scalar.return_value = None
        captured_session["session"] = session
        yield session

    pipeline._database_session = fake_session  # type: ignore[method-assign]

    pipeline._persist_human_input_extra_content(node_id="node-1")

    session = captured_session["session"]
    session.add.assert_called_once()
    content = session.add.call_args.args[0]
    assert isinstance(content, HumanInputContent)
    assert content.workflow_run_id == "run-1"
    assert content.message_id == "message-1"
    assert content.form_id == "form-1"


def test_persist_human_input_extra_content_skips_when_form_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline = _build_pipeline()
    monkeypatch.setattr(pipeline, "_load_human_input_form_id", lambda **kwargs: None)

    called = {"value": False}

    @contextmanager
    def fake_session():
        called["value"] = True
        session = mock.Mock()
        yield session

    pipeline._database_session = fake_session  # type: ignore[method-assign]

    pipeline._persist_human_input_extra_content(node_id="node-1")

    assert called["value"] is False


def test_persist_human_input_extra_content_skips_when_existing(monkeypatch: pytest.MonkeyPatch) -> None:
    pipeline = _build_pipeline()
    monkeypatch.setattr(pipeline, "_load_human_input_form_id", lambda **kwargs: "form-1")

    captured_session: dict[str, mock.Mock] = {}

    @contextmanager
    def fake_session():
        session = mock.Mock()
        session.scalar.return_value = HumanInputContent(
            workflow_run_id="run-1",
            message_id="message-1",
            form_id="form-1",
        )
        captured_session["session"] = session
        yield session

    pipeline._database_session = fake_session  # type: ignore[method-assign]

    pipeline._persist_human_input_extra_content(node_id="node-1")

    session = captured_session["session"]
    session.add.assert_not_called()


def test_handle_workflow_paused_event_persists_human_input_extra_content() -> None:
    pipeline = _build_pipeline()
    pipeline._application_generate_entity = SimpleNamespace(task_id="task-1")
    pipeline._workflow_response_converter = mock.Mock()
    pipeline._workflow_response_converter.workflow_pause_to_stream_response.return_value = []
    pipeline._ensure_graph_runtime_initialized = mock.Mock(side_effect=ValueError())
    pipeline._save_message = mock.Mock()
    message = SimpleNamespace(status=MessageStatus.NORMAL)
    pipeline._get_message = mock.Mock(return_value=message)
    pipeline._persist_human_input_extra_content = mock.Mock()
    pipeline._base_task_pipeline = mock.Mock()
    pipeline._base_task_pipeline.queue_manager = mock.Mock()
    pipeline._message_saved_on_pause = False

    @contextmanager
    def fake_session():
        session = mock.Mock()
        yield session

    pipeline._database_session = fake_session  # type: ignore[method-assign]

    reason = HumanInputRequired(
        form_id="form-1",
        form_content="content",
        inputs=[],
        actions=[],
        node_id="node-1",
        node_title="Approval",
        form_token="token-1",
        resolved_placeholder_values={},
    )
    event = QueueWorkflowPausedEvent(reasons=[reason], outputs={}, paused_nodes=["node-1"])

    list(pipeline._handle_workflow_paused_event(event))

    pipeline._persist_human_input_extra_content.assert_called_once_with(form_id="form-1", node_id="node-1")
    assert message.status == MessageStatus.PAUSED
