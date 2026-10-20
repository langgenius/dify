from collections.abc import Mapping
from dataclasses import dataclass

import pytest
from sqlalchemy.orm import Session

from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolParameter
from models import Account
from models.model import App, AppMode, EndUser
from models.tools import WorkflowToolProvider
from models.workflow import Workflow
from services.tools.workflow.tool import WorkflowTool
from tests.unit_tests.model_factories import make_account, make_app, make_workflow


@dataclass(frozen=True)
class _WorkflowQueries:
    app_model: App
    workflow_model: Workflow
    actor_model: Account

    def provider(self, *, tenant_id: str, provider_id: str) -> WorkflowToolProvider | None:
        raise AssertionError(f"provider lookup is not expected during invocation: {tenant_id=}, {provider_id=}")

    def provider_for_app(self, *, tenant_id: str, app_id: str) -> WorkflowToolProvider | None:
        raise AssertionError(f"provider lookup is not expected during invocation: {tenant_id=}, {app_id=}")

    def providers(self, *, tenant_id: str) -> list[WorkflowToolProvider]:
        raise AssertionError(f"provider lookup is not expected during invocation: {tenant_id=}")

    def app(self, *, tenant_id: str, app_id: str) -> App:
        assert (tenant_id, app_id) == ("tenant-1", "app-1")
        return self.app_model

    def workflow(self, *, tenant_id: str, app_id: str, version: str) -> Workflow:
        assert (tenant_id, app_id, version) == ("tenant-1", "app-1", "published")
        return self.workflow_model

    def current_workflow(self, *, tenant_id: str, app_id: str) -> Workflow:
        raise AssertionError(f"current-workflow lookup is not expected during invocation: {tenant_id=}, {app_id=}")

    def labels(self, *, tenant_id: str, provider_ids: list[str]) -> dict[str, list[str]]:
        raise AssertionError(f"label lookup is not expected during invocation: {tenant_id=}, {provider_ids=}")

    def actor(self, *, tenant_id: str, user_id: str) -> Account | EndUser | None:
        assert (tenant_id, user_id) == ("tenant-1", "account-1")
        return self.actor_model


@dataclass(frozen=True)
class _GenerateCall:
    app_model: App
    workflow: Workflow
    user: Account | EndUser
    args: Mapping[str, object]
    invoke_from: InvokeFrom
    streaming: bool
    call_depth: int
    pause_state_config: object | None


def test_public_invoke_passes_explicit_session_and_uses_available_workflow_generator(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = make_app(mode=AppMode.WORKFLOW)
    workflow = make_workflow(version="published")
    actor = make_account()
    calls: list[_GenerateCall] = []

    def generate(
        _generator: WorkflowAppGenerator,
        *,
        app_model: App,
        workflow: Workflow,
        user: Account | EndUser,
        args: Mapping[str, object],
        invoke_from: InvokeFrom,
        streaming: bool,
        call_depth: int,
        pause_state_config: object | None,
    ) -> dict[str, object]:
        calls.append(
            _GenerateCall(
                app_model=app_model,
                workflow=workflow,
                user=user,
                args=args,
                invoke_from=invoke_from,
                streaming=streaming,
                call_depth=call_depth,
                pause_state_config=pause_state_config,
            )
        )
        return {"data": {"outputs": {"answer": "forty-two"}}}

    monkeypatch.setattr(WorkflowAppGenerator, "generate", generate)

    parameter = ToolParameter.get_simple_instance(
        name="question",
        llm_description="Question to answer",
        typ=ToolParameter.ToolParameterType.STRING,
        required=True,
    )
    tool = WorkflowTool(
        workflow_app_id="app-1",
        workflow_as_tool_id="workflow-tool-1",
        version="published",
        workflow_entities={},
        workflow_call_depth=2,
        entity=ToolEntity(
            identity=ToolIdentity(
                author="test",
                name="answer",
                label=I18nObject(en_US="Answer"),
                provider="workflow-provider-1",
            ),
            parameters=[parameter],
        ),
        runtime=ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.EXPLORE),
        queries=_WorkflowQueries(app_model=app, workflow_model=workflow, actor_model=actor),
        draft_variable_saver=None,
    )

    with Session() as session:
        messages = list(
            tool.invoke(
                session=session,
                user_id="account-1",
                tool_parameters={"question": "What is six times seven?"},
            )
        )

    assert calls == [
        _GenerateCall(
            app_model=app,
            workflow=workflow,
            user=actor,
            args={"inputs": {"question": "What is six times seven?"}, "files": []},
            invoke_from=InvokeFrom.EXPLORE,
            streaming=False,
            call_depth=3,
            pause_state_config=None,
        )
    ]
    assert [message.type for message in messages] == [
        ToolInvokeMessage.MessageType.VARIABLE,
        ToolInvokeMessage.MessageType.TEXT,
        ToolInvokeMessage.MessageType.JSON,
    ]

    variable_message = messages[0].message
    assert isinstance(variable_message, ToolInvokeMessage.VariableMessage)
    assert variable_message.variable_name == "answer"
    assert variable_message.variable_value == "forty-two"

    text_message = messages[1].message
    assert isinstance(text_message, ToolInvokeMessage.TextMessage)
    assert text_message.text == '{"answer": "forty-two"}'

    json_message = messages[2].message
    assert isinstance(json_message, ToolInvokeMessage.JsonMessage)
    assert json_message.json_object == {"answer": "forty-two"}
    assert json_message.suppress_output is True
