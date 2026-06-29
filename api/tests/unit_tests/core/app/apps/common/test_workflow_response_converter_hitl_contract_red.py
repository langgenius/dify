from __future__ import annotations

import importlib
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.human_input import FormDefinition, ParagraphInputConfig, UserActionConfig
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.entities.pause_reason import HitlRequired
from graphon.runtime import GraphRuntimeState, VariablePool


class _FakeSession:
    def __init__(self, *, execute_rows=()) -> None:
        self._execute_rows = execute_rows

    def execute(self, _stmt):
        return list(self._execute_rows)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _build_form_definition_json(*, expiration_time: datetime) -> str:
    return FormDefinition(
        form_content="Need manager approval",
        inputs=[ParagraphInputConfig(output_variable_name="decision_comment")],
        user_actions=[UserActionConfig(id="approve", title="Approve")],
        rendered_content="Need manager approval",
        expiration_time=expiration_time,
        default_values={"decision_comment": "prefilled from dify"},
        node_title="Approval Gate",
        display_in_ui=True,
    ).model_dump_json()


def _build_converter(module):
    application_generate_entity = SimpleNamespace(
        inputs={},
        files=[],
        invoke_from=InvokeFrom.OPENAPI,
        app_config=SimpleNamespace(app_id="app-id", tenant_id="tenant-id"),
    )
    system_variables = build_system_variables(
        user_id="user-1",
        app_id="app-id",
        workflow_id="workflow-id",
        workflow_execution_id="run-id",
    )
    user = SimpleNamespace(id="account-id", name="Tester", email="tester@example.com")
    return module.WorkflowResponseConverter(
        application_generate_entity=application_generate_entity,
        user=user,
        system_variables=system_variables,
    )


def test_workflow_pause_converter_rehydrates_hitl_payload_from_form_definition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = importlib.import_module("core.app.apps.common.workflow_response_converter")
    converter = _build_converter(module)
    converter.workflow_start_to_stream_response(
        task_id="task",
        workflow_run_id="run-id",
        workflow_id="workflow-id",
        reason=WorkflowStartReason.INITIAL,
    )

    expiration_time = datetime(2024, 1, 1, tzinfo=UTC)
    resolved_session_ids: list[str] = []

    class _Binding:
        @staticmethod
        def resolve_form_id_from_session_id(*, session_id: str) -> str:
            resolved_session_ids.append(session_id)
            return "form-1"

    monkeypatch.setattr(
        module,
        "Session",
        lambda **_: _FakeSession(
            execute_rows=[("form-1", expiration_time, _build_form_definition_json(expiration_time=expiration_time))]
        ),
    )
    monkeypatch.setattr(module, "db", SimpleNamespace(engine=object()))
    monkeypatch.setattr(module, "session_binding", _Binding(), raising=False)
    monkeypatch.setattr(
        module,
        "load_form_dispositions_by_form_id",
        lambda form_ids, session=None, surface=None: {
            "form-1": module.FormDisposition(form_token="token-1", approval_channels=["console"])
        },
    )

    responses = converter.workflow_pause_to_stream_response(
        event=SimpleNamespace(
            reasons=[HitlRequired(session_id="session-1", node_id="node-1", node_title="Approval Gate")],
            outputs={"answer": "value"},
            paused_nodes=["node-1"],
        ),
        task_id="task",
        graph_runtime_state=GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0),
    )

    assert resolved_session_ids == ["session-1"]

    human_input_response = responses[0]
    assert human_input_response.data.form_id == "session-1"
    assert human_input_response.data.node_id == "node-1"
    assert human_input_response.data.node_title == "Approval Gate"
    assert human_input_response.data.form_content == "Need manager approval"
    assert human_input_response.data.inputs[0].output_variable_name == "decision_comment"
    assert human_input_response.data.actions[0].id == "approve"
    assert human_input_response.data.resolved_default_values == {"decision_comment": "prefilled from dify"}
    assert human_input_response.data.form_token == "token-1"
    assert human_input_response.data.display_in_ui is True
    assert human_input_response.data.expiration_time == int(expiration_time.timestamp())

    pause_response = responses[-1]
    assert pause_response.data.reasons == [
        {
            "TYPE": "hitl_required",
            "session_id": "session-1",
            "node_id": "node-1",
            "node_title": "Approval Gate",
            "form_token": "token-1",
            "approval_channels": ["console"],
            "expiration_time": int(expiration_time.timestamp()),
        }
    ]
