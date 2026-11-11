"""Tool traces observe committed files, never an unfinished or rolled-back invocation."""

from collections.abc import Generator
from typing import override

import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import ToolInvoked, TraceCorrelation, TraceEvent
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from core.app.entities.app_invoke_entities import InvokeFrom
from core.callback_handler.agent_tool_callback_handler import DifyAgentCallbackHandler
from core.tools.__base.tool import Tool
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage, ToolProviderType
from models.model import Conversation, Message, MessageFile
from repositories.app.generation_repository import AppGenerationRepository
from services.tools.tool_engine import ToolEngine


class AttachmentTool(Tool):
    """Produce one file link, optionally failing before invocation completion."""

    def __init__(self, *, fail: bool) -> None:
        super().__init__(
            entity=ToolEntity(
                identity=ToolIdentity(
                    author="test", name="attachment", label=I18nObject(en_US="Attachment"), provider="test"
                )
            ),
            runtime=ToolRuntime(tenant_id="tenant", invoke_from=InvokeFrom.DEBUGGER),
        )
        self.fail = fail

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
    ) -> Generator[ToolInvokeMessage]:
        """Yield a local link; an injected failure leaves the invocation incomplete."""
        yield ToolInvokeMessage(
            type=ToolInvokeMessage.MessageType.LINK,
            message=ToolInvokeMessage.TextMessage(text="/files/tools/tool-file-1.txt"),
            meta={"mime_type": "text/plain"},
        )
        if self.fail:
            raise RuntimeError("tool failed after yielding")


class CommittedFilesRecorder:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions
        self.observations: list[tuple[TraceEvent, list[str]]] = []

    def emit(self, event: TraceEvent) -> None:
        """Observe durable files from a separate connection at delivery time."""
        with self.sessions() as session:
            self.observations.append((event, list(session.scalars(select(MessageFile.id)))))


@pytest.mark.parametrize("failure", [None, "tool", "commit"])
@pytest.mark.parametrize("traced", [True, False])
def test_agent_tool_trace_follows_file_commit(
    sqlite_session_factory: sessionmaker[Session],
    agent_records: tuple[Conversation, Message],
    failure: str | None,
    traced: bool,
) -> None:
    """Successful calls expose committed files to tracing; either failure emits nothing."""
    _, message = agent_records
    recorder = CommittedFilesRecorder(sqlite_session_factory)
    scope = TraceScope(
        emitter=recorder,
        tenant_id="tenant",
        app_id="app1",
        user_id="user",
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
    )

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("commit rejected")

    if failure == "commit":
        event.listen(sqlite_session_factory, "before_commit", reject_commit)
    try:
        with sqlite_session_factory() as session:
            text, files, meta = ToolEngine.agent_invoke(
                session=session,
                tool=AttachmentTool(fail=failure == "tool"),
                tool_parameters={"query": "hello"},
                user_id="user",
                tenant_id="tenant",
                message=message,
                invoke_from=InvokeFrom.DEBUGGER,
                agent_tool_callback=DifyAgentCallbackHandler(),
                trace_scope=scope if traced else None,
                records=AppGenerationRepository(sqlite_session_factory),
            )
    finally:
        if failure == "commit":
            event.remove(sqlite_session_factory, "before_commit", reject_commit)

    with sqlite_session_factory() as session:
        committed = list(session.scalars(select(MessageFile)))
    if failure is not None:
        assert meta.error is not None
        assert files == []
        assert committed == []
        assert recorder.observations == []
    else:
        assert meta.error is None
        assert len(files) == 1
        assert [file.id for file in committed] == files
        assert committed[0].message_id == message.id
        assert committed[0].upload_file_id == "tool-file-1"
        if traced:
            [(emitted, visible_files)] = recorder.observations
            assert visible_files == files
            assert (emitted.tenant_id, emitted.app_id, emitted.user_id) == ("tenant", "app1", "user")
            payload = emitted.payload
            assert isinstance(payload, ToolInvoked)
            assert payload.message_id == message.id
            assert payload.tool_inputs == {"query": "hello"}
            assert payload.tool_outputs == text
            assert payload.error == meta.error
            assert payload.time_cost == meta.time_cost
            assert payload.tool_config == meta.tool_config
            assert payload.started_at <= payload.ended_at
        else:
            assert recorder.observations == []
