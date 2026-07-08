"""Agent App runner: drive Agent backend turns for chat and finalization flows.

Unlike the legacy ``AgentChatAppRunner`` (which runs an in-process ReAct loop),
this runner delegates to the Agent backend, consumes the streamed event flow,
republishes the assistant answer through the existing EasyUI chat task
pipeline, and then either saves or retires the conversation-owned runtime
session depending on the turn's exit policy.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Mapping
from decimal import Decimal
from typing import Any, Literal

from dify_agent.layers.ask_human import AskHumanToolArgs
from dify_agent.protocol import DeferredToolResultsPayload
from pydantic import JsonValue

from clients.agent_backend import (
    AgentBackendAgentMessageDeltaInternalEvent,
    AgentBackendDeferredToolCallInternalEvent,
    AgentBackendError,
    AgentBackendInternalEventType,
    AgentBackendRunClient,
    AgentBackendRunEventAdapter,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamInternalEvent,
    AgentBackendTerminalOutputDeltaInternalEvent,
    extract_runtime_layer_specs,
)
from clients.agent_backend.session_cleanup import AgentBackendSessionCleanupPayload
from core.app.apps.agent_app.runtime_request_builder import (
    AgentAppRuntimeBuildContext,
    AgentAppRuntimeRequest,
    AgentAppRuntimeRequestBuilder,
)
from core.app.apps.agent_app.session_store import (
    AgentAppRuntimeSessionStore,
    AgentAppSessionScope,
    StoredAgentAppSession,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import AgentRuntimeExitIntent, DifyRunContext
from core.app.entities.queue_entities import (
    QueueAgentMessageEvent,
    QueueAgentThoughtEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
)
from core.repositories.human_input_repository import HumanInputFormRepository, HumanInputFormRepositoryImpl
from core.workflow.nodes.agent_v2.ask_human_hitl import AskHumanFormBuildError, create_ask_human_form
from core.workflow.nodes.agent_v2.ask_human_resume import build_deferred_tool_results, resolve_ask_human_form
from extensions.ext_database import db
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, UserPromptMessage
from models.agent_config_entities import AgentSoulConfig
from models.enums import CreatorUserRole
from models.model import MessageAgentThought
from tasks.agent_backend_session_cleanup_task import cleanup_conversation_agent_runtime_session

logger = logging.getLogger(__name__)


class _DefaultSessionScopeSnapshotId:
    pass


_DEFAULT_SESSION_SCOPE_SNAPSHOT_ID = _DefaultSessionScopeSnapshotId()


def _prompt_messages_from_query(user_query: str | None) -> list[PromptMessage]:
    if not user_query:
        return []
    return [UserPromptMessage(content=user_query)]


def _llm_usage_from_agent_backend(usage: Mapping[str, Any] | None) -> LLMUsage | None:
    if usage is None:
        return None
    try:
        return LLMUsage.from_metadata(usage)
    except (TypeError, ValueError):
        logger.warning("Failed to parse Agent backend usage metadata: %s", usage, exc_info=True)
        return None


def publish_text_answer(
    *,
    queue_manager: AppQueueManager,
    model_name: str,
    answer: str,
    user_query: str | None = None,
    usage: LLMUsage | None = None,
) -> None:
    """Publish a complete assistant answer as one chunk + message-end.

    The EasyUI chat task pipeline consumes a QueueLLMChunkEvent stream followed
    by a QueueMessageEndEvent; emitting the whole answer as a single chunk lets
    both the backend-produced answer and short-circuited answers (moderation /
    annotation reply) share the exact same persistence + SSE path.
    """
    publish_text_delta(
        queue_manager=queue_manager,
        model_name=model_name,
        delta=answer,
        user_query=user_query,
    )
    publish_message_end(
        queue_manager=queue_manager,
        model_name=model_name,
        answer=answer,
        user_query=user_query,
        usage=usage,
    )


def publish_text_delta(
    *,
    queue_manager: AppQueueManager,
    model_name: str,
    delta: str,
    user_query: str | None = None,
) -> None:
    """Publish one assistant text delta through the EasyUI chat pipeline."""
    if not delta:
        return
    prompt_messages = _prompt_messages_from_query(user_query)
    chunk = LLMResultChunk(
        model=model_name,
        prompt_messages=prompt_messages,
        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=delta)),
    )
    queue_manager.publish(QueueLLMChunkEvent(chunk=chunk), PublishFrom.APPLICATION_MANAGER)


def publish_agent_message_delta(
    *,
    queue_manager: AppQueueManager,
    model_name: str,
    delta: str,
    user_query: str | None = None,
) -> None:
    """Publish one agent-process text delta through the EasyUI chat pipeline."""
    if not delta:
        return
    prompt_messages = _prompt_messages_from_query(user_query)
    chunk = LLMResultChunk(
        model=model_name,
        prompt_messages=prompt_messages,
        delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=delta)),
    )
    queue_manager.publish(QueueAgentMessageEvent(chunk=chunk), PublishFrom.APPLICATION_MANAGER)


def publish_message_end(
    *,
    queue_manager: AppQueueManager,
    model_name: str,
    answer: str,
    user_query: str | None = None,
    usage: LLMUsage | None = None,
) -> None:
    """Publish the terminal assistant result without emitting another delta."""
    prompt_messages = _prompt_messages_from_query(user_query)
    queue_manager.publish(
        QueueMessageEndEvent(
            llm_result=LLMResult(
                model=model_name,
                prompt_messages=prompt_messages,
                message=AssistantPromptMessage(content=answer),
                usage=usage or LLMUsage.empty_usage(),
            ),
        ),
        PublishFrom.APPLICATION_MANAGER,
    )


class _TextDeltaDebouncer:
    """Batch independent model text deltas before agent-message SSE output."""

    def __init__(self, *, debounce_seconds: float) -> None:
        self._debounce_seconds = debounce_seconds
        self._parts: list[str] = []
        self._first_pending_at: float | None = None

    def push(self, delta: str) -> str | None:
        if not delta:
            return None
        if self._debounce_seconds <= 0:
            return delta

        now = time.monotonic()
        if not self._parts:
            self._first_pending_at = now
        self._parts.append(delta)

        if self._first_pending_at is not None and now - self._first_pending_at >= self._debounce_seconds:
            return self.flush()
        return None

    def flush(self) -> str | None:
        if not self._parts:
            return None

        text = "".join(self._parts)
        self._parts = []
        self._first_pending_at = None
        return text


class _AgentProcessRecorder:
    """Persist Agent v2 process streams through the legacy thought model.

    Thinking and answer rows expose snapshot updates for contiguous model-text
    segments. Tool events close currently open text segments so later model text
    starts a fresh row instead of replaying content that was already streamed
    before the tool.
    """

    def __init__(
        self,
        *,
        dify_context: DifyRunContext,
        message_id: str,
        queue_manager: AppQueueManager,
    ) -> None:
        self._dify_context = dify_context
        self._message_id = message_id
        self._queue_manager = queue_manager
        self._next_position = 1
        self._thinking_by_index: dict[int, str] = {}
        self._answer_thought_id: str | None = None
        self._tool_by_index: dict[int, str] = {}
        self._tool_by_call_id: dict[str, str] = {}
        self._open_tool_by_name: dict[str, set[str]] = {}

    def handle_stream_event(self, event: AgentBackendStreamInternalEvent) -> None:
        data = event.data
        if not isinstance(data, dict):
            return

        event_kind = data.get("event_kind")
        if event_kind == "part_delta":
            self._handle_part_delta(data)
        elif event_kind == "part_start":
            self._handle_part(data)
        elif event_kind in {"function_tool_call", "output_tool_call"}:
            self._handle_tool_call_event(data)
        elif event_kind in {"function_tool_result", "output_tool_result"}:
            self._handle_tool_result_event(data)

    def _handle_part_delta(self, data: dict[str, Any]) -> None:
        delta = data.get("delta")
        if not isinstance(delta, dict):
            return

        index = _event_index(data)
        delta_kind = delta.get("part_delta_kind")
        if delta_kind == "thinking":
            content_delta = delta.get("content_delta")
            if isinstance(content_delta, str) and content_delta:
                self._append_thinking(index, content_delta)
            return

        if delta_kind == "tool_call":
            self._record_tool_call_delta(index, delta)

    def _handle_part(self, data: dict[str, Any]) -> None:
        part = data.get("part")
        if not isinstance(part, dict):
            return

        index = _event_index(data)
        part_kind = part.get("part_kind")
        if part_kind == "thinking":
            content = part.get("content")
            if isinstance(content, str) and content:
                self._append_thinking(index, content)
            return

        if part_kind in {"tool-call", "builtin-tool-call"}:
            self._record_tool_call_part(index, part)
            return

        if part_kind in {"tool-return", "builtin-tool-return"}:
            self._record_tool_return_part(part)

    def append_answer_text(self, content_delta: str) -> None:
        if not content_delta:
            return

        self._thinking_by_index.clear()
        if self._answer_thought_id is None:
            self._answer_thought_id = self._create_thought(answer=content_delta)
            return
        self._update_thought(self._answer_thought_id, answer_delta=content_delta)

    def _handle_tool_call_event(self, data: dict[str, Any]) -> None:
        part = data.get("part")
        if isinstance(part, dict):
            self._record_tool_call_part(_event_index(data), part)

    def _handle_tool_result_event(self, data: dict[str, Any]) -> None:
        part = data.get("part") or data.get("result")
        if isinstance(part, dict):
            self._record_tool_return_part(part)
            return

        content = data.get("content")
        if content is not None:
            self._record_tool_observation(
                tool_call_id=_string_or_none(data.get("tool_call_id")),
                tool_name=_string_or_none(data.get("tool_name")),
                observation=content,
            )

    def _append_thinking(self, index: int, content_delta: str) -> None:
        self._answer_thought_id = None
        thought_id = self._thinking_by_index.get(index)
        if thought_id is None:
            thought_id = self._create_thought(thought=content_delta)
            self._thinking_by_index[index] = thought_id
            return
        self._update_thought(thought_id, thought_delta=content_delta)

    def _record_tool_call_delta(self, index: int, delta: dict[str, Any]) -> None:
        self._close_thinking_segments()
        tool_call_id = _string_or_none(delta.get("tool_call_id"))
        tool_name = _string_or_none(delta.get("tool_name_delta"))
        args_delta = delta.get("args_delta")
        thought_id = self._lookup_tool_thought(index=index, tool_call_id=tool_call_id)
        if thought_id is None:
            thought_id = self._create_thought(tool=tool_name, tool_input=_json_or_text(args_delta))
            self._remember_tool_thought(
                index=index, tool_call_id=tool_call_id, tool_name=tool_name, thought_id=thought_id
            )
            return

        self._update_thought(
            thought_id,
            tool=tool_name,
            tool_input_delta=_json_or_text(args_delta),
        )

    def _record_tool_call_part(self, index: int, part: dict[str, Any]) -> None:
        self._close_thinking_segments()
        tool_call_id = _string_or_none(part.get("tool_call_id"))
        tool_name = _string_or_none(part.get("tool_name"))
        thought_id = self._lookup_tool_thought(index=index, tool_call_id=tool_call_id)
        if thought_id is None:
            thought_id = self._create_thought(tool=tool_name, tool_input=_json_or_text(part.get("args")))
            self._remember_tool_thought(
                index=index, tool_call_id=tool_call_id, tool_name=tool_name, thought_id=thought_id
            )
            return

        self._update_thought(
            thought_id,
            tool=tool_name,
            tool_input=_json_or_text(part.get("args")),
        )

    def _record_tool_return_part(self, part: dict[str, Any]) -> None:
        self._close_thinking_segments()
        tool_call_id = _string_or_none(part.get("tool_call_id"))
        tool_name = _string_or_none(part.get("tool_name"))
        content = part.get("content")
        if content is None:
            content = part
        self._record_tool_observation(tool_call_id=tool_call_id, tool_name=tool_name, observation=content)

    def _record_tool_observation(self, *, tool_call_id: str | None, tool_name: str | None, observation: Any) -> None:
        self._close_thinking_segments()
        thought_id = self._lookup_observation_thought(tool_call_id=tool_call_id, tool_name=tool_name)
        if thought_id is None:
            thought_id = self._create_thought(tool=tool_name)
        else:
            self._mark_tool_observed(thought_id)
        self._update_thought(thought_id, observation=_json_or_text(observation))

    def _lookup_tool_thought(self, *, index: int, tool_call_id: str | None) -> str | None:
        if tool_call_id and tool_call_id in self._tool_by_call_id:
            return self._tool_by_call_id[tool_call_id]
        return self._tool_by_index.get(index)

    def _remember_tool_thought(
        self, *, index: int, tool_call_id: str | None, tool_name: str | None, thought_id: str
    ) -> None:
        self._tool_by_index[index] = thought_id
        if tool_call_id:
            self._tool_by_call_id[tool_call_id] = thought_id
        if tool_name:
            self._open_tool_by_name.setdefault(tool_name, set()).add(thought_id)

    def _lookup_observation_thought(self, *, tool_call_id: str | None, tool_name: str | None) -> str | None:
        if tool_call_id:
            return self._tool_by_call_id.get(tool_call_id)
        if tool_name:
            open_thought_ids = self._open_tool_by_name.get(tool_name, set())
            if len(open_thought_ids) == 1:
                return next(iter(open_thought_ids))
        return None

    def _mark_tool_observed(self, thought_id: str) -> None:
        for open_thought_ids in self._open_tool_by_name.values():
            open_thought_ids.discard(thought_id)

    def _close_thinking_segments(self) -> None:
        self._thinking_by_index.clear()
        self._answer_thought_id = None

    def _create_thought(
        self,
        *,
        thought: str | None = None,
        answer: str | None = None,
        tool: str | None = None,
        tool_input: str | None = None,
    ) -> str:
        row = MessageAgentThought(
            message_id=self._message_id,
            message_chain_id=None,
            thought=thought or "",
            tool=tool or "",
            tool_labels_str=_tool_labels(tool),
            tool_meta_str="{}",
            tool_input=tool_input or "",
            observation="",
            tool_process_data=None,
            message="",
            message_token=0,
            message_unit_price=Decimal(0),
            message_price_unit=Decimal("0.001"),
            message_files="",
            answer=answer or "",
            answer_token=0,
            answer_unit_price=Decimal(0),
            answer_price_unit=Decimal("0.001"),
            tokens=0,
            total_price=Decimal(0),
            position=self._next_position,
            currency="USD",
            latency=0,
            created_by_role=self._created_by_role(),
            created_by=self._dify_context.user_id,
        )
        self._next_position += 1
        db.session.add(row)
        db.session.commit()
        thought_id = str(row.id)
        self._queue_manager.publish(
            QueueAgentThoughtEvent(agent_thought_id=thought_id), PublishFrom.APPLICATION_MANAGER
        )
        return thought_id

    def _update_thought(
        self,
        thought_id: str,
        *,
        thought_delta: str | None = None,
        tool: str | None = None,
        tool_input: str | None = None,
        tool_input_delta: str | None = None,
        observation: str | None = None,
        answer_delta: str | None = None,
    ) -> None:
        row = db.session.get(MessageAgentThought, thought_id)
        if row is None:
            return

        if thought_delta:
            row.thought = f"{row.thought or ''}{thought_delta}"
        if tool:
            row.tool = tool
            row.tool_labels_str = _tool_labels(tool)
        if tool_input is not None:
            row.tool_input = tool_input
        if tool_input_delta:
            row.tool_input = f"{row.tool_input or ''}{tool_input_delta}"
        if observation is not None:
            row.observation = observation
        if answer_delta:
            row.answer = f"{row.answer or ''}{answer_delta}"

        db.session.commit()
        self._queue_manager.publish(
            QueueAgentThoughtEvent(agent_thought_id=thought_id), PublishFrom.APPLICATION_MANAGER
        )

    def _created_by_role(self) -> CreatorUserRole:
        if self._dify_context.invoke_from.runs_as_account():
            return CreatorUserRole.ACCOUNT
        return CreatorUserRole.END_USER


def _event_index(data: dict[str, Any]) -> int:
    index = data.get("index")
    return index if isinstance(index, int) else -1


def _string_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def _json_or_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def _tool_labels(tool: str | None) -> str:
    if not tool:
        return "{}"
    return json.dumps({tool: {"en_US": tool, "zh_Hans": tool}}, ensure_ascii=False)


class AgentAppRunner:
    """Runs one Agent App conversation turn against the Agent backend."""

    def __init__(
        self,
        *,
        request_builder: AgentAppRuntimeRequestBuilder,
        agent_backend_client: AgentBackendRunClient,
        event_adapter: AgentBackendRunEventAdapter,
        session_store: AgentAppRuntimeSessionStore,
        text_delta_debounce_seconds: float,
    ) -> None:
        self._request_builder = request_builder
        self._agent_backend_client = agent_backend_client
        self._event_adapter = event_adapter
        self._session_store = session_store
        self._text_delta_debounce_seconds = text_delta_debounce_seconds

    def run(
        self,
        *,
        dify_context: DifyRunContext,
        agent_id: str,
        agent_config_snapshot_id: str,
        agent_config_version_kind: Literal["snapshot", "draft", "build_draft"] = "snapshot",
        agent_soul: AgentSoulConfig,
        conversation_id: str,
        query: str,
        message_id: str,
        model_name: str,
        queue_manager: AppQueueManager,
        session_scope_snapshot_id: str | None | _DefaultSessionScopeSnapshotId = _DEFAULT_SESSION_SCOPE_SNAPSHOT_ID,
        agent_runtime_exit_intent: AgentRuntimeExitIntent = "suspend",
    ) -> None:
        preserve_session = agent_runtime_exit_intent == "suspend"
        scope = self._build_session_scope(
            dify_context=dify_context,
            agent_id=agent_id,
            agent_config_snapshot_id=agent_config_snapshot_id,
            conversation_id=conversation_id,
            session_scope_snapshot_id=session_scope_snapshot_id,
        )
        # ENG-638: if a prior turn paused on ask_human and the form is now answered,
        # resume by threading the human's reply into this run as deferred_tool_results.
        stored = self._session_store.load_active_session(scope)
        runtime = self._build_runtime(
            dify_context=dify_context,
            agent_id=agent_id,
            agent_config_snapshot_id=agent_config_snapshot_id,
            agent_config_version_kind=agent_config_version_kind,
            agent_soul=agent_soul,
            conversation_id=conversation_id,
            query=query,
            idempotency_key=message_id,
            stored=stored,
            message_id=message_id,
            suspend_on_exit=preserve_session,
        )

        create_response = self._agent_backend_client.create_run(runtime.request)
        terminal, streamed_terminal_answer = self._consume_stream(
            create_response.run_id,
            dify_context=dify_context,
            message_id=message_id,
            queue_manager=queue_manager,
            model_name=model_name,
            query=query,
        )

        if isinstance(terminal, AgentBackendDeferredToolCallInternalEvent):
            if not preserve_session:
                self._mark_session_cleaned(scope=scope, backend_run_id=terminal.run_id)
                raise AgentBackendError("Agent App finalization cannot pause for human input.")
            # ENG-635: the agent asked a human. End this turn with the question and
            # a conversation-owned HITL form; a form submission resumes the run.
            self._pause_for_ask_human(
                terminal=terminal,
                scope=scope,
                dify_context=dify_context,
                agent_soul=agent_soul,
                conversation_id=conversation_id,
                message_id=message_id,
                model_name=model_name,
                runtime=runtime,
                queue_manager=queue_manager,
                query=query,
            )
            return

        if not isinstance(terminal, AgentBackendRunSucceededInternalEvent):
            error = getattr(terminal, "error", None) or "Agent backend run did not complete successfully."
            raise AgentBackendError(str(error))

        answer = self._terminal_output_to_answer(terminal.output)
        if preserve_session:
            superseded_sessions = self._load_superseded_sessions(scope=scope)
            self._publish_terminal_answer(
                queue_manager=queue_manager,
                model_name=model_name,
                answer=answer,
                query=query,
                streamed_answer=streamed_terminal_answer,
                usage=_llm_usage_from_agent_backend(terminal.usage),
            )
            session_saved = self._save_session(
                scope=scope,
                backend_run_id=terminal.run_id,
                snapshot=terminal.session_snapshot,
                runtime_layer_specs=extract_runtime_layer_specs(runtime.request.composition),
            )
            if session_saved:
                self._cleanup_superseded_sessions(superseded_sessions)
        else:
            # The backend has already accepted a terminal success with
            # delete-on-exit semantics. Local publish/persistence errors must
            # not keep the API-side session row active, and cleanup failures
            # must not replace the original publish/error outcome.
            try:
                self._publish_terminal_answer(
                    queue_manager=queue_manager,
                    model_name=model_name,
                    answer=answer,
                    query=query,
                    streamed_answer=streamed_terminal_answer,
                    usage=_llm_usage_from_agent_backend(terminal.usage),
                )
            finally:
                self._mark_session_cleaned(scope=scope, backend_run_id=terminal.run_id)

    def _build_session_scope(
        self,
        *,
        dify_context: DifyRunContext,
        agent_id: str,
        agent_config_snapshot_id: str,
        conversation_id: str,
        session_scope_snapshot_id: str | None | _DefaultSessionScopeSnapshotId,
    ) -> AgentAppSessionScope:
        if isinstance(session_scope_snapshot_id, _DefaultSessionScopeSnapshotId):
            effective_session_scope_snapshot_id: str | None = agent_config_snapshot_id
        else:
            effective_session_scope_snapshot_id = session_scope_snapshot_id
        return AgentAppSessionScope(
            tenant_id=dify_context.tenant_id,
            app_id=dify_context.app_id,
            conversation_id=conversation_id,
            agent_id=agent_id,
            agent_config_snapshot_id=effective_session_scope_snapshot_id,
        )

    def _build_runtime(
        self,
        *,
        dify_context: DifyRunContext,
        agent_id: str,
        agent_config_snapshot_id: str,
        agent_config_version_kind: Literal["snapshot", "draft", "build_draft"],
        agent_soul: AgentSoulConfig,
        conversation_id: str,
        query: str,
        idempotency_key: str,
        stored: StoredAgentAppSession | None,
        message_id: str | None,
        suspend_on_exit: bool,
    ) -> AgentAppRuntimeRequest:
        session_snapshot = stored.session_snapshot if stored is not None else None
        deferred_tool_results = (
            self._resolve_pending_ask_human(stored=stored, dify_context=dify_context, message_id=message_id)
            if message_id is not None
            else None
        )
        return self._request_builder.build(
            AgentAppRuntimeBuildContext(
                dify_context=dify_context,
                agent_id=agent_id,
                agent_config_snapshot_id=agent_config_snapshot_id,
                agent_config_version_kind=agent_config_version_kind,
                agent_soul=agent_soul,
                conversation_id=conversation_id,
                user_query=query,
                idempotency_key=idempotency_key,
                session_snapshot=session_snapshot,
                deferred_tool_results=deferred_tool_results,
                suspend_on_exit=suspend_on_exit,
            )
        )

    def _pause_for_ask_human(
        self,
        *,
        terminal: AgentBackendDeferredToolCallInternalEvent,
        scope: AgentAppSessionScope,
        dify_context: DifyRunContext,
        agent_soul: AgentSoulConfig,
        conversation_id: str,
        message_id: str,
        model_name: str,
        runtime: AgentAppRuntimeRequest,
        queue_manager: AppQueueManager,
        query: str,
    ) -> None:
        """End the chat turn on a dify.ask_human call: create a conversation-owned
        HITL form, persist the pause correlation, and surface the question."""
        try:
            created = create_ask_human_form(
                deferred_tool_call=terminal.deferred_tool_call,
                # Chat forms have no workflow node; key by the turn's message id.
                node_id=message_id,
                default_node_title="Agent",
                contacts=agent_soul.human.contacts,
                repository=self._build_form_repository(dify_context),
                conversation_id=conversation_id,
            )
        except AskHumanFormBuildError as error:
            raise AgentBackendError(f"Failed to build ask_human form for Agent App chat: {error}") from error

        # Persist the snapshot + correlation so a form submission can start the
        # second run with the human's answer (ENG-637/638 columns, conversation owner).
        self._save_session(
            scope=scope,
            backend_run_id=terminal.run_id,
            snapshot=terminal.session_snapshot,
            runtime_layer_specs=extract_runtime_layer_specs(runtime.request.composition),
            pending_form_id=created.form_id,
            pending_tool_call_id=terminal.deferred_tool_call.tool_call_id,
        )

        # The structured form is delivered via the HITL surface(s); the chat turn
        # ends by echoing the agent's question so the conversation reflects the ask.
        self._publish_answer(
            queue_manager=queue_manager,
            model_name=model_name,
            answer=self._ask_human_message(created.args),
            query=query,
        )

    def _resolve_pending_ask_human(
        self,
        *,
        stored: StoredAgentAppSession | None,
        dify_context: DifyRunContext,
        message_id: str,
    ) -> DeferredToolResultsPayload | None:
        """Build deferred_tool_results when a pending ask_human form is answered."""
        if stored is None or stored.pending_form_id is None or stored.pending_tool_call_id is None:
            return None
        outcome = resolve_ask_human_form(
            form_id=stored.pending_form_id,
            tenant_id=dify_context.tenant_id,
            node_id=message_id,
        )
        if outcome is None or outcome.deferred_result is None:
            # Form missing or still waiting — run a normal turn, no resume.
            return None
        return build_deferred_tool_results(
            tool_call_id=stored.pending_tool_call_id,
            result=outcome.deferred_result,
        )

    def _build_form_repository(self, dify_context: DifyRunContext) -> HumanInputFormRepository:
        invoke_source = dify_context.invoke_from.value
        return HumanInputFormRepositoryImpl(
            tenant_id=dify_context.tenant_id,
            app_id=dify_context.app_id,
            workflow_execution_id=None,
            invoke_source=invoke_source,
            submission_actor_id=dify_context.user_id if invoke_source in {"debugger", "explore"} else None,
        )

    @staticmethod
    def _ask_human_message(args: AskHumanToolArgs) -> str:
        parts = [args.question]
        if args.markdown:
            parts.append(args.markdown)
        return "\n\n".join(parts)

    def _consume_stream(
        self,
        run_id: str,
        *,
        dify_context: DifyRunContext,
        message_id: str,
        queue_manager: AppQueueManager,
        model_name: str,
        query: str | None,
    ):
        """Consume backend events while preserving raw recorder granularity."""
        terminal = None
        process_recorder = _AgentProcessRecorder(
            dify_context=dify_context,
            message_id=message_id,
            queue_manager=queue_manager,
        )
        text_delta_debouncer = _TextDeltaDebouncer(debounce_seconds=self._text_delta_debounce_seconds)
        streamed_terminal_parts: list[str] = []

        def persist_answer_text(content_delta: str) -> None:
            try:
                process_recorder.append_answer_text(content_delta)
            except Exception:
                db.session.rollback()
                logger.warning(
                    "Failed to persist Agent App answer text: run_id=%s message_id=%s",
                    run_id,
                    message_id,
                    exc_info=True,
                )
            publish_agent_message_delta(
                queue_manager=queue_manager,
                model_name=model_name,
                delta=content_delta,
                user_query=query,
            )

        def flush_pending_agent_message_text() -> None:
            pending_text = text_delta_debouncer.flush()
            if pending_text:
                persist_answer_text(pending_text)

        for public_event in self._agent_backend_client.stream_events(run_id):
            if queue_manager.is_stopped():
                flush_pending_agent_message_text()
                self._cancel_run(run_id)
                raise GenerateTaskStoppedError()
            for internal_event in self._event_adapter.adapt(public_event):
                if queue_manager.is_stopped():
                    flush_pending_agent_message_text()
                    self._cancel_run(run_id)
                    raise GenerateTaskStoppedError()
                if internal_event.type in (
                    AgentBackendInternalEventType.RUN_STARTED,
                    AgentBackendInternalEventType.STREAM_EVENT,
                    AgentBackendInternalEventType.AGENT_MESSAGE_DELTA,
                    AgentBackendInternalEventType.TERMINAL_OUTPUT_DELTA,
                ):
                    if isinstance(internal_event, AgentBackendAgentMessageDeltaInternalEvent):
                        debounced_delta = text_delta_debouncer.push(internal_event.delta)
                        if debounced_delta:
                            persist_answer_text(debounced_delta)
                        continue

                    if isinstance(internal_event, AgentBackendTerminalOutputDeltaInternalEvent):
                        flush_pending_agent_message_text()
                        streamed_terminal_parts.append(internal_event.delta)
                        publish_text_delta(
                            queue_manager=queue_manager,
                            model_name=model_name,
                            delta=internal_event.delta,
                            user_query=query,
                        )
                        continue

                    if isinstance(internal_event, AgentBackendStreamInternalEvent):
                        flush_pending_agent_message_text()
                        try:
                            process_recorder.handle_stream_event(internal_event)
                        except Exception:
                            db.session.rollback()
                            logger.warning(
                                "Failed to persist Agent App process event: run_id=%s message_id=%s event_kind=%s",
                                run_id,
                                message_id,
                                internal_event.event_kind,
                                exc_info=True,
                            )
                        continue
                    continue
                flush_pending_agent_message_text()
                terminal = internal_event
                break
            if terminal is not None:
                break
        flush_pending_agent_message_text()
        return terminal, "".join(streamed_terminal_parts)

    def _cancel_run(self, run_id: str) -> None:
        try:
            self._agent_backend_client.cancel_run(run_id)
        except Exception:
            logger.warning("Failed to cancel stopped Agent App backend run: run_id=%s", run_id, exc_info=True)

    def _publish_answer(
        self, *, queue_manager: AppQueueManager, model_name: str, answer: str, query: str | None
    ) -> None:
        # MVP: emit the full answer as a single chunk + message-end. The chat
        # task pipeline streams the chunk over SSE and persists the message.
        publish_text_answer(queue_manager=queue_manager, model_name=model_name, answer=answer, user_query=query)

    def _publish_terminal_answer(
        self,
        *,
        queue_manager: AppQueueManager,
        model_name: str,
        answer: str,
        query: str | None,
        streamed_answer: str,
        usage: LLMUsage | None,
    ) -> None:
        """Finish a successful turn from the backend terminal output."""
        if not streamed_answer:
            publish_text_answer(
                queue_manager=queue_manager,
                model_name=model_name,
                answer=answer,
                user_query=query,
                usage=usage,
            )
            return

        if answer.startswith(streamed_answer):
            publish_text_delta(
                queue_manager=queue_manager,
                model_name=model_name,
                delta=answer[len(streamed_answer) :],
                user_query=query,
            )
        elif answer != streamed_answer:
            logger.warning(
                "Agent App streamed terminal output does not match terminal output; "
                "using terminal output for message persistence."
            )

        publish_message_end(
            queue_manager=queue_manager,
            model_name=model_name,
            answer=answer,
            user_query=query,
            usage=usage,
        )

    def _save_session(
        self,
        *,
        scope: AgentAppSessionScope,
        backend_run_id: str,
        snapshot: Any,
        runtime_layer_specs: Any,
        pending_form_id: str | None = None,
        pending_tool_call_id: str | None = None,
    ) -> bool:
        try:
            self._session_store.save_active_snapshot(
                scope=scope,
                backend_run_id=backend_run_id,
                snapshot=snapshot,
                runtime_layer_specs=runtime_layer_specs,
                pending_form_id=pending_form_id,
                pending_tool_call_id=pending_tool_call_id,
            )
            return True
        except Exception:
            logger.warning(
                "Failed to persist Agent App conversation session snapshot: "
                "tenant_id=%s app_id=%s conversation_id=%s agent_id=%s",
                scope.tenant_id,
                scope.app_id,
                scope.conversation_id,
                scope.agent_id,
                exc_info=True,
            )
            return False

    def _load_superseded_sessions(self, *, scope: AgentAppSessionScope) -> list[StoredAgentAppSession]:
        try:
            stored_sessions = self._session_store.list_active_sessions_for_conversation(
                tenant_id=scope.tenant_id,
                app_id=scope.app_id,
                conversation_id=scope.conversation_id,
            )
        except Exception:
            logger.warning(
                "Failed to load existing Agent App conversation sessions before snapshot save: "
                "tenant_id=%s app_id=%s conversation_id=%s agent_id=%s",
                scope.tenant_id,
                scope.app_id,
                scope.conversation_id,
                scope.agent_id,
                exc_info=True,
            )
            return []

        return [stored for stored in stored_sessions if stored.scope != scope]

    def _cleanup_superseded_sessions(self, stored_sessions: list[StoredAgentAppSession]) -> None:
        for stored_session in stored_sessions:
            try:
                if stored_session.runtime_layer_specs:
                    payload = AgentBackendSessionCleanupPayload(
                        session_snapshot=stored_session.session_snapshot,
                        runtime_layer_specs=stored_session.runtime_layer_specs,
                        idempotency_key=(
                            f"{stored_session.scope.tenant_id}:{stored_session.scope.app_id}:"
                            f"{stored_session.scope.conversation_id}:{stored_session.scope.agent_id}:"
                            f"{stored_session.scope.agent_config_snapshot_id or 'no-config'}:"
                            f"superseded-session-cleanup:{stored_session.backend_run_id or 'no-run'}"
                        ),
                        metadata={
                            "tenant_id": stored_session.scope.tenant_id,
                            "app_id": stored_session.scope.app_id,
                            "conversation_id": stored_session.scope.conversation_id,
                            "agent_id": stored_session.scope.agent_id,
                            "agent_config_snapshot_id": stored_session.scope.agent_config_snapshot_id,
                            "previous_agent_backend_run_id": stored_session.backend_run_id,
                        },
                    )
                    cleanup_conversation_agent_runtime_session.delay(payload.model_dump(mode="json"))
            except Exception:
                logger.warning(
                    "Failed to enqueue Agent backend cleanup for superseded Agent App session: "
                    "tenant_id=%s app_id=%s conversation_id=%s agent_id=%s backend_run_id=%s",
                    stored_session.scope.tenant_id,
                    stored_session.scope.app_id,
                    stored_session.scope.conversation_id,
                    stored_session.scope.agent_id,
                    stored_session.backend_run_id,
                    exc_info=True,
                )

    def _mark_session_cleaned(
        self,
        *,
        scope: AgentAppSessionScope,
        backend_run_id: str,
    ) -> None:
        """Best-effort delete-on-exit cleanup for the API-side session row.

        Once the Agent backend reaches a terminal event, cleanup persistence
        must not replace the original publish/error outcome for that turn.
        """
        try:
            self._session_store.mark_cleaned(scope=scope, backend_run_id=backend_run_id)
        except Exception:
            logger.warning(
                "Failed to retire Agent App conversation session after delete-on-exit: "
                "tenant_id=%s app_id=%s conversation_id=%s agent_id=%s backend_run_id=%s",
                scope.tenant_id,
                scope.app_id,
                scope.conversation_id,
                scope.agent_id,
                backend_run_id,
                exc_info=True,
            )

    @staticmethod
    def _terminal_output_to_answer(output: JsonValue) -> str:
        """Normalize the backend's terminal output to assistant text.

        Free-text Agent Apps return a plain string; if a structured output is
        configured the value is a JSON object, which we serialize so the chat
        message always has a string body.
        """
        if output is None:
            return ""
        if isinstance(output, str):
            return output
        if isinstance(output, dict):
            text = output.get("text")
            if isinstance(text, str):
                return text
            return json.dumps(output, ensure_ascii=False)
        return json.dumps(output, ensure_ascii=False)


__all__ = ["AgentAppRunner", "publish_message_end", "publish_text_answer", "publish_text_delta"]
