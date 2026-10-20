from collections.abc import Generator
from typing import override
from unittest.mock import patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.draft_variable_saver import DraftVariableSaverFactory
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolProviderType
from extensions.application_services.workflow import (
    WorkflowExecutionDependencies,
    build_workflow_execution_dependencies,
)
from models import Account
from services.tools.plugin_invocation import PluginToolBackwardsInvocation


class _TrackingSession(Session):
    was_closed: bool = False

    @override
    def close(self) -> None:
        self.was_closed = True
        super().close()


class _LazyTool(Tool):
    def __init__(self) -> None:
        super().__init__(
            entity=ToolEntity(
                identity=ToolIdentity(
                    author="test",
                    name="lazy-plugin-tool",
                    label=I18nObject(en_US="Lazy plugin tool"),
                    provider="test-provider",
                )
            ),
            runtime=ToolRuntime(tenant_id="tenant-1", user_id="user-1"),
        )
        self.sessions: list[_TrackingSession] = []

    @override
    def tool_provider_type(self) -> ToolProviderType:
        return ToolProviderType.PLUGIN

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
        self.sessions.append(session)

        assert not session.was_closed
        yield self.create_text_message("first")
        assert not session.was_closed
        yield self.create_text_message("second")


def _runtime(sqlite_engine: Engine) -> WorkflowExecutionDependencies:
    sessions: sessionmaker[Session] = sessionmaker(
        bind=sqlite_engine,
        class_=_TrackingSession,
        expire_on_commit=False,
    )
    return build_workflow_execution_dependencies(sessions)


def _unused_draft_variable_saver(_tenant_id: str, _account: Account) -> DraftVariableSaverFactory:
    raise AssertionError("the patched tool lookup must not call the draft variable saver")


def _invoke(runtime: WorkflowExecutionDependencies) -> Generator[ToolInvokeMessage, None, None]:
    return PluginToolBackwardsInvocation.invoke_tool(
        tenant_id="tenant-1",
        user_id="user-1",
        tool_type=ToolProviderType.PLUGIN,
        provider="test-provider",
        tool_name="lazy-plugin-tool",
        tool_parameters={"query": "hello"},
        workflow_runtime=runtime,
        draft_variable_saver=_unused_draft_variable_saver,
    )


def test_plugin_invocation_closes_transform_and_session_when_consumer_stops_early(sqlite_engine: Engine) -> None:
    runtime = _runtime(sqlite_engine)
    tool = _LazyTool()
    transform_closed = False

    def tracking_transform(
        messages: Generator[ToolInvokeMessage, None, None], **_kwargs: object
    ) -> Generator[ToolInvokeMessage, None, None]:
        nonlocal transform_closed
        try:
            yield from messages
        finally:
            transform_closed = True

    with (
        patch(
            "services.tools.plugin_invocation.ToolManager.get_tool_runtime_from_plugin", return_value=tool
        ) as get_runtime,
        patch(
            "services.tools.plugin_invocation.ToolFileMessageTransformer.transform_tool_invoke_messages",
            side_effect=tracking_transform,
        ),
    ):
        messages = _invoke(runtime)
        get_runtime.assert_called_once()
        assert tool.sessions == []

        assert next(messages).message == ToolInvokeMessage.TextMessage(text="first")
        assert not tool.sessions[0].was_closed
        messages.close()

    assert transform_closed
    assert tool.sessions[0].was_closed


def test_plugin_invocation_closes_session_when_transformer_raises(sqlite_engine: Engine) -> None:
    runtime = _runtime(sqlite_engine)
    tool = _LazyTool()

    def failing_transform(
        messages: Generator[ToolInvokeMessage, None, None], **_kwargs: object
    ) -> Generator[ToolInvokeMessage, None, None]:
        yield next(messages)
        raise RuntimeError("transform failed")

    with (
        patch("services.tools.plugin_invocation.ToolManager.get_tool_runtime_from_plugin", return_value=tool),
        patch(
            "services.tools.plugin_invocation.ToolFileMessageTransformer.transform_tool_invoke_messages",
            side_effect=failing_transform,
        ),
    ):
        messages = _invoke(runtime)
        assert next(messages).message == ToolInvokeMessage.TextMessage(text="first")
        with pytest.raises(RuntimeError, match="transform failed"):
            next(messages)

    assert tool.sessions[0].was_closed
