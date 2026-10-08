from collections.abc import Generator
from dataclasses import replace
from typing import override

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.callback_handler.workflow_tool_callback_handler import DifyWorkflowCallbackHandler
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolProviderType
from extensions.application_services.workflow import build_workflow_execution_dependencies
from graphon.nodes.tool.exc import ToolRuntimeInvocationError
from graphon.nodes.tool_runtime_entities import ToolRuntimeHandle, ToolRuntimeMessage
from services.workflow.execution.adapters.node_runtime import DifyToolNodeRuntime
from services.workflow.execution.ports import WorkflowToolInvoker
from tests.workflow_test_utils import build_test_run_context


class _TrackingSession(Session):
    was_closed: bool = False

    @override
    def close(self) -> None:
        self.was_closed = True
        super().close()


class _LazyTool(Tool):
    def __init__(self, *, fail_after_first_message: bool = False) -> None:
        super().__init__(
            entity=ToolEntity(
                identity=ToolIdentity(
                    author="test",
                    name="lazy-tool",
                    label=I18nObject(en_US="Lazy tool"),
                    provider="test-provider",
                )
            ),
            runtime=ToolRuntime(tenant_id="tenant-1", user_id="user-1"),
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
        assert user_id == "user-1"
        assert tool_parameters == {"query": "hello"}
        assert conversation_id is None
        assert app_id == "app-1"
        assert message_id is None
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


class _CapturingInvoker(WorkflowToolInvoker):
    def __init__(self, delegate: WorkflowToolInvoker) -> None:
        self._delegate = delegate
        self.streams: list[Generator[ToolInvokeMessage, None, None]] = []

    @override
    def __call__(
        self,
        *,
        tool: Tool,
        tool_parameters: dict[str, object],
        user_id: str,
        workflow_tool_callback: DifyWorkflowCallbackHandler,
        workflow_call_depth: int,
        conversation_id: str | None = None,
        app_id: str | None = None,
        message_id: str | None = None,
    ) -> Generator[ToolInvokeMessage, None, None]:
        stream = self._delegate(
            tool=tool,
            tool_parameters=tool_parameters,
            user_id=user_id,
            workflow_tool_callback=workflow_tool_callback,
            workflow_call_depth=workflow_call_depth,
            conversation_id=conversation_id,
            app_id=app_id,
            message_id=message_id,
        )
        self.streams.append(stream)
        return stream


def _build_runtime(
    sqlite_engine: Engine, *, capture_invoker: bool = False
) -> tuple[DifyToolNodeRuntime, _CapturingInvoker | None]:
    sessions: sessionmaker[Session] = sessionmaker(
        bind=sqlite_engine,
        class_=_TrackingSession,
        expire_on_commit=False,
    )
    dependencies = build_workflow_execution_dependencies(sessions)
    capturing_invoker = _CapturingInvoker(dependencies.tool_invoker) if capture_invoker else None
    if capturing_invoker is not None:
        dependencies = replace(dependencies, tool_invoker=capturing_invoker)
    runtime = DifyToolNodeRuntime(
        build_test_run_context(tenant_id="tenant-1", app_id="app-1", user_id="user-1"),
        workflow_runtime=dependencies,
    )
    return runtime, capturing_invoker


def _invoke(runtime: DifyToolNodeRuntime, tool: Tool) -> Generator[ToolRuntimeMessage, None, None]:
    return runtime.invoke(
        tool_runtime=ToolRuntimeHandle(raw=tool),
        tool_parameters={"query": "hello"},
        workflow_call_depth=2,
        provider_name="test-provider",
    )


def test_tool_runtime_keeps_session_open_until_lazy_output_is_consumed(sqlite_engine: Engine) -> None:
    runtime, _ = _build_runtime(sqlite_engine)
    tool = _LazyTool()

    messages = list(_invoke(runtime, tool))

    assert len(tool.sessions) == 1
    assert tool.sessions[0].was_closed
    assert tool.events == ["before-first-message", "after-first-message", "after-second-message"]
    assert [message.message for message in messages] == [
        ToolRuntimeMessage.TextMessage(text="first"),
        ToolRuntimeMessage.TextMessage(text="second"),
    ]


def test_tool_runtime_closes_session_when_lazy_output_raises(sqlite_engine: Engine) -> None:
    runtime, _ = _build_runtime(sqlite_engine)
    tool = _LazyTool(fail_after_first_message=True)
    messages = _invoke(runtime, tool)

    assert next(messages).message == ToolRuntimeMessage.TextMessage(text="first")
    with pytest.raises(ToolRuntimeInvocationError, match="tool failed after yielding"):
        next(messages)

    assert len(tool.sessions) == 1
    assert tool.sessions[0].was_closed
    assert tool.events == ["before-first-message", "after-first-message"]


def test_tool_runtime_closes_retained_inner_stream_when_consumer_stops_early(sqlite_engine: Engine) -> None:
    runtime, capturing_invoker = _build_runtime(sqlite_engine, capture_invoker=True)
    assert capturing_invoker is not None
    tool = _LazyTool()
    messages = _invoke(runtime, tool)

    assert next(messages).message == ToolRuntimeMessage.TextMessage(text="first")
    assert len(capturing_invoker.streams) == 1
    retained_inner_stream = capturing_invoker.streams[0]
    assert not tool.sessions[0].was_closed

    messages.close()

    assert tool.sessions[0].was_closed
    with pytest.raises(StopIteration):
        next(retained_inner_stream)
