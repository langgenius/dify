from collections.abc import Generator, Mapping, Sequence
from dataclasses import dataclass
from typing import override
from unittest.mock import create_autospec

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.agent.entities import AgentScratchpadUnit
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.app_invoke_entities import AgentChatAppGenerateEntity, InvokeFrom
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.ops.ops_trace_manager import TraceQueueManager
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
    ToolInvokeMeta,
    ToolProviderType,
)
from extensions.application_services.workflow import build_workflow_execution_dependencies
from graphon.model_runtime.entities import PromptMessage
from models.model import Message
from services.agent.chat.cot_runner import CotAgentRunner
from services.agent.chat.ports import AgentToolInvoker
from services.app.generation.ports import AgentMessageRecords, MessageFileWriter
from tests.unit_tests.model_factories import make_message


class _TrackingSession(Session):
    was_closed: bool = False

    @override
    def close(self) -> None:
        self.was_closed = True
        super().close()


class _LazyTool(Tool):
    def __init__(self, *, fail_after_first_message: bool) -> None:
        super().__init__(
            entity=ToolEntity(
                identity=ToolIdentity(
                    author="test",
                    name="lazy-tool",
                    label=I18nObject(en_US="Lazy tool"),
                    provider="test-provider",
                )
            ),
            runtime=ToolRuntime(tenant_id="tenant-1", invoke_from=InvokeFrom.DEBUGGER),
        )
        self.fail_after_first_message = fail_after_first_message
        self.events: list[str] = []
        self.sessions: list[_TrackingSession] = []

    @override
    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.BUILT_IN

    @override
    def _invoke(
        self,
        session: Session,
        user_id: str,
        tool_parameters: dict[str, object],
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        assert isinstance(session, _TrackingSession)
        self.sessions.append(session)
        assert not session.was_closed
        self.events.append("before-first-message")
        yield self.create_text_message("first")

        assert not session.was_closed
        self.events.append("after-first-message")
        if self.fail_after_first_message:
            raise RuntimeError("tool failed after yielding")

        yield self.create_text_message("second")
        assert not session.was_closed
        self.events.append("after-second-message")


class _NoFilesExpected(MessageFileWriter):
    def create_message_files(
        self, *, tenant_id: str, message_id: str, files: Sequence[Mapping[str, object]]
    ) -> list[str]:
        raise AssertionError(f"no files expected: {tenant_id=}, {message_id=}, {files=}")


@pytest.mark.parametrize("fail_after_first_message", [False, True])
def test_session_bound_invoker_consumes_lazy_messages_before_closing_session(
    fail_after_first_message: bool,
) -> None:
    tool_sessions: sessionmaker[Session] = sessionmaker(class_=_TrackingSession)
    invoker = build_workflow_execution_dependencies(tool_sessions).agent_tool_invoker
    tool = _LazyTool(fail_after_first_message=fail_after_first_message)

    text, files, meta = invoker(
        tool=tool,
        tool_parameters={},
        user_id="account-1",
        tenant_id="tenant-1",
        message=make_message(message_id="message-1", conversation_id="conversation-1"),
        invoke_from=InvokeFrom.DEBUGGER,
        agent_tool_callback=DifyAgentCallbackHandler(),
        records=_NoFilesExpected(),
    )

    assert len(tool.sessions) == 1
    assert tool.sessions[0].was_closed is True
    assert files == []
    if fail_after_first_message:
        assert tool.events == ["before-first-message", "after-first-message"]
        assert "tool failed after yielding" in text
        assert meta.error == "tool failed after yielding"
    else:
        assert tool.events == ["before-first-message", "after-first-message", "after-second-message"]
        assert text == "firstsecond"
        assert meta.error is None


@dataclass(frozen=True)
class _Invocation:
    tool: Tool
    tool_parameters: str | dict[str, object]
    user_id: str
    tenant_id: str
    message: Message
    invoke_from: InvokeFrom
    records: MessageFileWriter


class _RecordingInvoker(AgentToolInvoker):
    def __init__(self) -> None:
        self.calls: list[_Invocation] = []

    def __call__(
        self,
        tool: Tool,
        tool_parameters: str | dict[str, object],
        user_id: str,
        tenant_id: str,
        message: Message,
        invoke_from: InvokeFrom,
        agent_tool_callback: DifyAgentCallbackHandler,
        trace_manager: TraceQueueManager | None = None,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
        *,
        records: MessageFileWriter,
    ) -> tuple[str, list[str], ToolInvokeMeta]:
        assert isinstance(agent_tool_callback, DifyAgentCallbackHandler)
        assert trace_manager is None
        assert conversation_id is None
        assert app_id is None
        assert message_id is None
        self.calls.append(
            _Invocation(
                tool=tool,
                tool_parameters=tool_parameters,
                user_id=user_id,
                tenant_id=tenant_id,
                message=message,
                invoke_from=invoke_from,
                records=records,
            )
        )
        return "port result", ["file-1"], ToolInvokeMeta.empty()


class _CotRunnerHarness(CotAgentRunner):
    def __init__(
        self,
        *,
        tool_invoker: AgentToolInvoker,
        records: AgentMessageRecords,
        queue_manager: AppQueueManager,
        application_generate_entity: AgentChatAppGenerateEntity,
        message: Message,
    ) -> None:
        self._tool_invoker = tool_invoker
        self._records = records
        self.queue_manager = queue_manager
        self.application_generate_entity = application_generate_entity
        self.message = message
        self.user_id = "account-1"
        self.tenant_id = "tenant-1"
        self.agent_callback = DifyAgentCallbackHandler()

    @override
    def _organize_prompt_messages(self) -> list[PromptMessage]:
        return []


def test_cot_runner_invokes_tool_through_injected_port() -> None:
    invoker = _RecordingInvoker()
    records: AgentMessageRecords = create_autospec(AgentMessageRecords, instance=True, spec_set=True)
    queue_manager: AppQueueManager = create_autospec(AppQueueManager, instance=True, spec_set=True)
    application_generate_entity = AgentChatAppGenerateEntity.model_construct(
        task_id="task-1",
        inputs={},
        files=[],
        user_id="account-1",
        stream=False,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    message = make_message(message_id="message-1", conversation_id="conversation-1")
    runner = _CotRunnerHarness(
        tool_invoker=invoker,
        records=records,
        queue_manager=queue_manager,
        application_generate_entity=application_generate_entity,
        message=message,
    )
    tool = _LazyTool(fail_after_first_message=False)
    message_file_ids: list[str] = []

    response, meta = runner._handle_invoke_action(
        action=AgentScratchpadUnit.Action(action_name="lazy-tool", action_input={"query": "hello"}),
        tool_instances={"lazy-tool": tool},
        message_file_ids=message_file_ids,
    )

    assert response == "port result"
    assert meta.error is None
    assert message_file_ids == ["file-1"]
    assert invoker.calls == [
        _Invocation(
            tool=tool,
            tool_parameters={"query": "hello"},
            user_id="account-1",
            tenant_id="tenant-1",
            message=message,
            invoke_from=InvokeFrom.DEBUGGER,
            records=records,
        )
    ]
