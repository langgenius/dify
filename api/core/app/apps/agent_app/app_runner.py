"""Agent App runner: drive Agent backend turns for chat and finalization flows.

Unlike the legacy ``AgentChatAppRunner`` (which runs an in-process ReAct loop),
this runner delegates to the Agent backend, consumes the streamed event flow,
republishes the assistant answer through the existing EasyUI chat task
pipeline, and saves the latest module state snapshot on the persistent Binding.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Mapping
from contextlib import suppress
from decimal import Decimal
from typing import Any, Literal

from dify_agent.protocol.tool_call_limits import (
    AGENT_TOOL_ACTIVITY_META_KEY,
    AgentToolActivity,
    AgentToolActivityStatus,
    agent_tool_activity_from_metadata,
    runtime_tool_failed,
    unconfirmed_reservation,
    validated_call_limit,
)
from pydantic import JsonValue
from sqlalchemy import select

from clients.agent_backend import (
    AgentBackendAgentMessageDeltaInternalEvent,
    AgentBackendError,
    AgentBackendInternalEventType,
    AgentBackendRunCancelledInternalEvent,
    AgentBackendRunClient,
    AgentBackendRunEventAdapter,
    AgentBackendRunFailedError,
    AgentBackendRunFailedInternalEvent,
    AgentBackendRunSucceededInternalEvent,
    AgentBackendStreamInternalEvent,
)
from core.app.apps.agent_app.runtime_request_builder import (
    AgentAppRuntimeBuildContext,
    AgentAppRuntimeRequest,
    AgentAppRuntimeRequestBuilder,
)
from core.app.apps.agent_app.session_store import (
    AgentAppSessionScope,
    AgentAppWorkspaceStore,
    StoredAgentAppSession,
)
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.apps.exc import GenerateTaskStoppedError
from core.app.entities.app_invoke_entities import DifyRunContext
from core.app.entities.queue_entities import (
    QueueAgentMessageEvent,
    QueueAgentThoughtEvent,
    QueueLLMChunkEvent,
    QueueMessageEndEvent,
    QueueRetrieverResourcesEvent,
)
from core.db.session_factory import create_session
from core.tools.entities.common_entities import I18nObjectDict
from extensions.tracing import application_tracing_hooks
from graphon.file import File
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    ImagePromptMessageContent,
    PromptMessage,
    UserPromptMessage,
)
from graphon.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from models.agent import AgentConfigVersionKind
from models.agent_config_entities import AgentSoulConfig
from models.enums import CreatorUserRole
from models.model import Message, MessageAgentThought
from services.agent.knowledge_citations import knowledge_sources_from_tool_part

logger = logging.getLogger(__name__)


class _DefaultSessionScopeSnapshotId:
    pass


_DEFAULT_SESSION_SCOPE_SNAPSHOT_ID = _DefaultSessionScopeSnapshotId()

_AGENT_BACKEND_INVOKE_ERROR_BY_REASON: Mapping[str, type[InvokeError]] = {
    "InvokeAuthorizationError": InvokeAuthorizationError,
    "InvokeBadRequestError": InvokeBadRequestError,
    "CredentialsValidateFailedError": InvokeBadRequestError,
    "InvokeConnectionError": InvokeConnectionError,
    "InvokeRateLimitError": InvokeRateLimitError,
    "InvokeServerUnavailableError": InvokeServerUnavailableError,
}


def _agent_backend_failure_to_exception(event: AgentBackendRunFailedInternalEvent) -> Exception:
    if event.error_type is None:
        err_cls = _AGENT_BACKEND_INVOKE_ERROR_BY_REASON.get(event.reason or "")
        if err_cls is not None:
            return err_cls(event.error)
    message = event.error or "Agent backend run did not complete successfully."
    return AgentBackendRunFailedError(
        event.run_id,
        {
            "error": event.error,
            "reason": event.reason,
            "source_event_id": event.source_event_id,
        },
        message=message,
        error_type=event.error_type,
        reason=event.reason,
        source_event_id=event.source_event_id,
    )


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
    before the tool. Within the owning stream and its sequential replays,
    native run/call identities reuse one thought row and terminal states never
    regress. Structured activity metadata is persisted
    before queue notification, including after the user stops consuming SSE.
    Prepared tool labels are copied for this run and frozen on the persisted
    thought; reconstructing a recorder never relabels an existing invocation.
    """

    def __init__(
        self,
        *,
        dify_context: DifyRunContext,
        message_id: str,
        queue_manager: AppQueueManager,
        tool_labels: Mapping[str, I18nObjectDict] | None = None,
    ) -> None:
        self._dify_context = dify_context
        self._message_id = message_id
        self._queue_manager = queue_manager
        self._tool_labels = {name: label.copy() for name, label in (tool_labels or {}).items()}
        self._next_position = 1
        self._thinking_by_index: dict[int, str] = {}
        self._answer_thought_id: str | None = None
        self._tool_by_index: dict[int, str] = {}
        self._tool_by_call_id: dict[str, str] = {}
        self._open_tool_by_name: dict[str, set[str]] = {}
        self._knowledge_receipts: set[str] = set()
        self._run_id: str | None = None
        self._activities: dict[str, AgentToolActivity] = {}
        self._finished_tools: set[str] = set()
        self._restore_tool_identities()

    def _restore_tool_identities(self) -> None:
        """Restore identities for this committed message and its owning App.

        The runner supplies a validated message/App context. Old rows without
        the typed sidecar retain their display position but assert no native
        identity or quota. Sequential stream replays reuse persisted rows.
        """
        with create_session() as session:
            rows = session.scalars(
                select(MessageAgentThought)
                .join(Message, Message.id == MessageAgentThought.message_id)
                .where(Message.id == self._message_id, Message.app_id == self._dify_context.app_id)
                .order_by(MessageAgentThought.position, MessageAgentThought.id)
            ).all()
            self._next_position = max((row.position for row in rows), default=0) + 1
            for row in rows:
                activity = agent_tool_activity_from_metadata(row.tool_meta)
                if activity is not None:
                    self._activities[row.id] = activity
                    self._tool_by_call_id[activity.id] = row.id
                    if activity.status in {"started", "running"}:
                        self._open_tool_by_name.setdefault(activity.tool_name, set()).add(row.id)
                    else:
                        self._finished_tools.add(row.id)

    def _bind_run(self, run_id: str) -> None:
        """Bind one recorder to exactly one native run before applying events."""
        if self._run_id is not None and self._run_id != run_id:
            raise ValueError("An Agent process recorder cannot combine different native runs")
        self._run_id = run_id

    def _call_key(self, tool_call_id: str) -> str:
        """Scope native ids by their run; direct legacy helpers keep their old key."""
        return f"{self._run_id}:{tool_call_id}" if self._run_id is not None else tool_call_id

    def _activity(
        self,
        *,
        tool_call_id: str | None,
        tool_name: str | None,
        status: AgentToolActivityStatus,
        part: Mapping[str, JsonValue] | None = None,
    ) -> AgentToolActivity | None:
        """Build allowlisted metadata from a native call, never from model claims."""
        if self._run_id is None or tool_call_id is None:
            return None
        thought_id = self._tool_by_call_id.get(self._call_key(tool_call_id))
        previous = self._activities.get(thought_id) if thought_id is not None else None
        name = tool_name or (previous.tool_name if previous is not None else None)
        if name is None:
            return None
        metadata = part.get("metadata") if part is not None else None
        limit = validated_call_limit(metadata)
        error: str | None = None
        if part is not None:
            if limit is not None and limit.execution_status == "not_executed":
                status = "not_executed"
                error = (
                    f"Call limit reached ({limit.limit} per run). This request was not executed."
                    if limit.reason == "call_limit_reached"
                    else "Duplicate tool call. This request was not executed."
                )
            elif (
                part.get("part_kind") == "retry-prompt"
                or part.get("outcome") == "failure"
                or runtime_tool_failed(metadata, has_quota=limit is not None)
            ):
                status = "failed"
                error = (_json_or_text(part.get("content")) or "Tool call failed.")[: 16 * 1024]
        return AgentToolActivity(
            id=self._call_key(tool_call_id),
            run_id=self._run_id,
            tool_call_id=tool_call_id,
            tool_name=name,
            status=status,
            error=error,
            call_limit=limit,
        )

    def finish(
        self,
        terminal: AgentBackendRunSucceededInternalEvent
        | AgentBackendRunFailedInternalEvent
        | AgentBackendRunCancelledInternalEvent,
    ) -> None:
        """Persist unfinished calls using the owning run's authoritative terminal.

        Completed records stay unchanged. A retained reservation with no tool
        result becomes unconfirmed, never successful or definitively unexecuted.
        A stopped queue cannot prevent any row from being committed.
        """
        self._bind_run(terminal.run_id)
        for thought_id, activity in list(self._activities.items()):
            if activity.run_id == terminal.run_id and activity.status in {"started", "running"}:
                status: AgentToolActivityStatus = "failed"
                error = "Tool call did not return a result."
                if isinstance(terminal, AgentBackendRunCancelledInternalEvent):
                    status = "cancelled"
                    error = terminal.message or terminal.reason or "Tool call was cancelled before its result returned."
                elif isinstance(terminal, AgentBackendRunFailedInternalEvent):
                    error = terminal.error or error
                updated = AgentToolActivity(
                    id=activity.id,
                    run_id=activity.run_id,
                    tool_call_id=activity.tool_call_id,
                    tool_name=activity.tool_name,
                    status=status,
                    error=error[: 16 * 1024],
                    call_limit=unconfirmed_reservation(activity.tool_call_id, terminal.tool_call_limits),
                )
                self._update_thought(thought_id, tool_activity=updated)
                self._mark_tool_observed(thought_id)

    def _publish_thought(self, thought_id: str) -> None:
        """Notify only after commit; a concurrent Stop cannot discard saved metadata."""
        if not self._queue_manager.is_stopped():
            # A concurrent Stop may reject publication after the durable commit.
            with suppress(GenerateTaskStoppedError):
                self._queue_manager.publish(
                    QueueAgentThoughtEvent(agent_thought_id=thought_id), PublishFrom.APPLICATION_MANAGER
                )

    def handle_stream_event(self, event: AgentBackendStreamInternalEvent) -> None:
        """Apply one validated owning-run stream event without replaying terminal tools."""
        self._bind_run(event.run_id)
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

    def trim_answer_suffix(self, final_answer: str) -> None:
        if not final_answer or self._answer_thought_id is None:
            return

        with create_session() as session:
            row = session.get(MessageAgentThought, self._answer_thought_id)
            if row is None:
                return

            answer = row.answer or ""
            overlap = _suffix_prefix_overlap_length(answer, final_answer)
            if overlap == 0:
                return

            row.answer = answer[:-overlap]
            if _is_empty_answer_only_thought(row):
                session.delete(row)
                self._answer_thought_id = None
                session.commit()
                return

            session.commit()
        self._queue_manager.publish(
            QueueAgentThoughtEvent(agent_thought_id=self._answer_thought_id), PublishFrom.APPLICATION_MANAGER
        )

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
                tool_call_id=_native_call_id(data.get("tool_call_id")),
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

    def _record_tool_call_delta(self, index: int, delta: dict[str, JsonValue]) -> None:
        """Persist partial tool input, retaining one row for each native identity."""
        self._close_thinking_segments()
        tool_call_id = _native_call_id(delta.get("tool_call_id"))
        tool_name = _string_or_none(delta.get("tool_name_delta"))
        args_delta = delta.get("args_delta")
        thought_id = self._lookup_tool_thought(index=index, tool_call_id=tool_call_id)
        if thought_id in self._finished_tools:
            if index >= 0 and thought_id is not None:
                self._tool_by_index[index] = thought_id
            return
        activity = self._activity(tool_call_id=tool_call_id, tool_name=tool_name, status="started")
        if thought_id is None:
            thought_id = self._create_thought(
                tool=tool_name, tool_input=_json_or_text(args_delta), tool_activity=activity
            )
            self._remember_tool_thought(
                index=index, tool_call_id=tool_call_id, tool_name=tool_name, thought_id=thought_id
            )
            return

        self._update_thought(
            thought_id,
            tool=tool_name,
            tool_input_delta=_json_or_text(args_delta),
            tool_activity=activity,
        )
        self._remember_tool_thought(index=index, tool_call_id=tool_call_id, tool_name=tool_name, thought_id=thought_id)

    def _record_tool_call_part(self, index: int, part: dict[str, JsonValue]) -> None:
        """Start a native invocation without letting replay or index reuse regress it."""
        self._close_thinking_segments()
        tool_call_id = _native_call_id(part.get("tool_call_id"))
        tool_name = _string_or_none(part.get("tool_name"))
        thought_id = self._lookup_tool_thought(index=index, tool_call_id=tool_call_id)
        if thought_id in self._finished_tools:
            if index >= 0 and thought_id is not None:
                self._tool_by_index[index] = thought_id
            return
        activity = self._activity(tool_call_id=tool_call_id, tool_name=tool_name, status="running")
        if thought_id is None:
            thought_id = self._create_thought(
                tool=tool_name, tool_input=_json_or_text(part.get("args")), tool_activity=activity
            )
            self._remember_tool_thought(
                index=index, tool_call_id=tool_call_id, tool_name=tool_name, thought_id=thought_id
            )
            return

        self._update_thought(
            thought_id,
            tool=tool_name,
            tool_input=_json_or_text(part.get("args")),
            tool_activity=activity,
        )
        self._remember_tool_thought(index=index, tool_call_id=tool_call_id, tool_name=tool_name, thought_id=thought_id)

    def _record_tool_return_part(self, part: dict[str, JsonValue]) -> None:
        """Persist native observations and validated status/quota as separate values."""
        self._close_thinking_segments()
        sources = []
        for source in knowledge_sources_from_tool_part(part):
            citation = source.knowledge_fs_citation
            if citation and citation.id not in self._knowledge_receipts and len(self._knowledge_receipts) < 200:
                self._knowledge_receipts.add(citation.id)
                sources.append(source)
        if sources:
            self._queue_manager.publish(
                QueueRetrieverResourcesEvent(retriever_resources=sources), PublishFrom.APPLICATION_MANAGER
            )
        tool_call_id = _native_call_id(part.get("tool_call_id"))
        tool_name = _string_or_none(part.get("tool_name"))
        content = part.get("content")
        if content is None:
            content = part
        self._record_tool_observation(
            tool_call_id=tool_call_id,
            tool_name=tool_name,
            observation=content,
            activity=self._activity(tool_call_id=tool_call_id, tool_name=tool_name, status="succeeded", part=part),
        )

    def _record_tool_observation(
        self,
        *,
        tool_call_id: str | None,
        tool_name: str | None,
        observation: Any,
        activity: AgentToolActivity | None = None,
    ) -> None:
        """Complete one known call once, keeping its identity for sequential replay."""
        self._close_thinking_segments()
        thought_id = self._lookup_observation_thought(tool_call_id=tool_call_id, tool_name=tool_name)
        if thought_id in self._finished_tools:
            return
        if thought_id is None:
            thought_id = self._create_thought(
                tool=tool_name, observation=_json_or_text(observation), tool_activity=activity
            )
            self._remember_tool_thought(index=-1, tool_call_id=tool_call_id, tool_name=tool_name, thought_id=thought_id)
        else:
            self._update_thought(thought_id, observation=_json_or_text(observation), tool_activity=activity)
        self._mark_tool_observed(thought_id)

    def _lookup_tool_thought(self, *, index: int, tool_call_id: str | None) -> str | None:
        """Prefer stable ids; a reused model part index cannot alias another native call."""
        if tool_call_id and self._call_key(tool_call_id) in self._tool_by_call_id:
            return self._tool_by_call_id[self._call_key(tool_call_id)]
        if index < 0:
            return None
        thought_id = self._tool_by_index.get(index)
        activity = self._activities.get(thought_id) if thought_id is not None else None
        if tool_call_id and activity is not None and activity.tool_call_id != tool_call_id:
            return None
        return thought_id

    def _remember_tool_thought(
        self, *, index: int, tool_call_id: str | None, tool_name: str | None, thought_id: str
    ) -> None:
        if index >= 0:
            self._tool_by_index[index] = thought_id
        if tool_call_id:
            self._tool_by_call_id[self._call_key(tool_call_id)] = thought_id
        if tool_name:
            self._open_tool_by_name.setdefault(tool_name, set()).add(thought_id)

    def _lookup_observation_thought(self, *, tool_call_id: str | None, tool_name: str | None) -> str | None:
        if tool_call_id:
            return self._tool_by_call_id.get(self._call_key(tool_call_id))
        if tool_name:
            open_thought_ids = {
                thought_id
                for thought_id in self._open_tool_by_name.get(tool_name, set())
                if (activity := self._activities.get(thought_id)) is None or activity.run_id == self._run_id
            }
            if len(open_thought_ids) == 1:
                return next(iter(open_thought_ids))
        return None

    def _mark_tool_observed(self, thought_id: str) -> None:
        """Close transient matching while retaining stable identity to reject replay."""
        self._finished_tools.add(thought_id)
        self._tool_by_index = {index: value for index, value in self._tool_by_index.items() if value != thought_id}
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
        observation: str | None = None,
        tool_activity: AgentToolActivity | None = None,
    ) -> str:
        """Commit a process row and its allowlisted metadata before publishing it."""
        row = MessageAgentThought(
            message_id=self._message_id,
            message_chain_id=None,
            thought=thought or "",
            tool=tool or "",
            tool_labels_str=self._labels_for_tool(tool),
            tool_meta_str=json.dumps(
                {AGENT_TOOL_ACTIVITY_META_KEY: tool_activity.model_dump(mode="json")} if tool_activity else {},
                ensure_ascii=False,
            ),
            tool_input=tool_input or "",
            observation=observation or "",
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
        with create_session() as session:
            session.add(row)
            session.commit()
            thought_id = str(row.id)
        if tool_activity is not None:
            self._activities[thought_id] = tool_activity
        self._publish_thought(thought_id)
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
        tool_activity: AgentToolActivity | None = None,
    ) -> None:
        """Commit an actual row change; identical replay emits no additional update."""
        with create_session() as session:
            row = session.get(MessageAgentThought, thought_id)
            if row is None:
                return
            changed = False

            if thought_delta:
                row.thought = f"{row.thought or ''}{thought_delta}"
                changed = True
            if tool and row.tool != tool:
                row.tool = tool
                row.tool_labels_str = self._labels_for_tool(tool)
                changed = True
            if tool_input is not None and row.tool_input != tool_input:
                row.tool_input = tool_input
                changed = True
            if tool_input_delta:
                row.tool_input = f"{row.tool_input or ''}{tool_input_delta}"
                changed = True
            if observation is not None and row.observation != observation:
                row.observation = observation
                changed = True
            if answer_delta:
                row.answer = f"{row.answer or ''}{answer_delta}"
                changed = True
            if tool_activity is not None and self._activities.get(thought_id) != tool_activity:
                metadata = row.tool_meta
                if not isinstance(metadata, dict):
                    metadata = {}
                metadata[AGENT_TOOL_ACTIVITY_META_KEY] = tool_activity.model_dump(mode="json")
                row.tool_meta_str = json.dumps(metadata, ensure_ascii=False)
                changed = True
            if not changed:
                return

            session.commit()
        if tool_activity is not None:
            self._activities[thought_id] = tool_activity
        self._publish_thought(thought_id)

    def _created_by_role(self) -> CreatorUserRole:
        if self._dify_context.invoke_from.runs_as_account():
            return CreatorUserRole.ACCOUNT
        return CreatorUserRole.END_USER

    def _labels_for_tool(self, tool: str | None) -> str:
        """Freeze the prepared label for a new name, falling back for native tools.

        The run's prepared labels contain only declared display metadata.
        Existing rows retain their original labels unless their technical
        name is still being assembled by the native stream.
        """
        if not tool:
            return "{}"
        label = self._tool_labels.get(tool) or {"en_US": tool, "zh_Hans": tool}
        return json.dumps({tool: label}, ensure_ascii=False)


def _event_index(data: dict[str, Any]) -> int:
    index = data.get("index")
    return index if isinstance(index, int) else -1


def _string_or_none(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized or normalized.lower() in {"none", "null"}:
        return None
    return normalized


def _native_call_id(value: JsonValue) -> str | None:
    """Keep opaque native identities verbatim so their reservation hashes match.

    Keep the existing missing-ID behavior for blank values and legacy
    ``None``/``null`` placeholders. Other native ids retain whitespace padding
    rather than being normalized into another call's identity.
    """
    if not isinstance(value, str) or not value.strip() or value.strip().lower() in {"none", "null"}:
        return None
    return value


def _json_or_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except Exception:
        return str(value)


def _suffix_prefix_overlap_length(text: str, prefix_source: str) -> int:
    max_length = min(len(text), len(prefix_source))
    for length in range(max_length, 0, -1):
        if text.endswith(prefix_source[:length]):
            return length
    return 0


def _is_empty_answer_only_thought(row: MessageAgentThought) -> bool:
    return not any((row.thought, row.answer, row.tool, row.tool_input, row.observation))


class AgentAppRunner:
    """Runs one Agent App conversation turn against the Agent backend."""

    def __init__(
        self,
        *,
        request_builder: AgentAppRuntimeRequestBuilder,
        agent_backend_client: AgentBackendRunClient,
        event_adapter: AgentBackendRunEventAdapter,
        session_store: AgentAppWorkspaceStore,
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
        home_snapshot_id: str | None,
        conversation_id: str,
        query: str,
        inputs: Mapping[str, Any] | None = None,
        message_id: str,
        model_name: str,
        queue_manager: AppQueueManager,
        files: list[File] | None = None,
        image_detail_config: ImagePromptMessageContent.DETAIL | None = None,
        session_scope_snapshot_id: str | None | _DefaultSessionScopeSnapshotId = _DEFAULT_SESSION_SCOPE_SNAPSHOT_ID,
        build_draft_id: str | None = None,
    ) -> None:
        scope = self._build_session_scope(
            dify_context=dify_context,
            agent_id=agent_id,
            agent_config_snapshot_id=agent_config_snapshot_id,
            home_snapshot_id=home_snapshot_id,
            conversation_id=conversation_id,
            session_scope_snapshot_id=session_scope_snapshot_id,
            agent_config_version_kind=AgentConfigVersionKind(agent_config_version_kind),
            build_draft_id=build_draft_id,
        )
        stored = self._session_store.load_or_create(scope)
        runtime = self._build_runtime(
            dify_context=dify_context,
            agent_id=agent_id,
            agent_config_snapshot_id=agent_config_snapshot_id,
            agent_config_version_kind=agent_config_version_kind,
            agent_soul=agent_soul,
            binding_id=stored.binding_id,
            backend_binding_ref=stored.backend_binding_ref,
            conversation_id=conversation_id,
            query=query,
            inputs=inputs or {},
            files=tuple(files or ()),
            image_detail_config=image_detail_config,
            idempotency_key=message_id,
            stored=stored,
        )

        create_response = self._agent_backend_client.create_run(runtime.request)
        terminal, process_recorder = self._consume_stream(
            create_response.run_id,
            dify_context=dify_context,
            message_id=message_id,
            queue_manager=queue_manager,
            model_name=model_name,
            query=query,
            session_scope=scope,
            binding_id=runtime.binding_id,
            tool_labels=runtime.tool_labels,
        )

        terminal_usage = None
        if isinstance(
            terminal,
            AgentBackendRunSucceededInternalEvent
            | AgentBackendRunFailedInternalEvent
            | AgentBackendRunCancelledInternalEvent,
        ):
            terminal_usage = _llm_usage_from_agent_backend(terminal.usage)
            self._persist_message_usage(
                message_id=message_id,
                usage=terminal_usage,
            )

        if isinstance(terminal, AgentBackendRunFailedInternalEvent | AgentBackendRunCancelledInternalEvent):
            # None means no post-exit snapshot was produced; leave the previously stored session snapshot untouched.
            if terminal.session_snapshot is not None:
                self._save_session(
                    scope=scope,
                    binding_id=runtime.binding_id,
                    snapshot=terminal.session_snapshot,
                )

        if not isinstance(terminal, AgentBackendRunSucceededInternalEvent):
            if isinstance(terminal, AgentBackendRunFailedInternalEvent):
                reason = terminal.reason
                if terminal.error_type is None and reason == "binding_lost":
                    raise AgentBackendError("The retained agent working environment is no longer available.")
                raise _agent_backend_failure_to_exception(terminal)
            raise AgentBackendError("Agent backend run did not complete successfully.")

        answer = self._terminal_output_to_answer(terminal.output)
        try:
            process_recorder.trim_answer_suffix(answer)
        except Exception:
            logger.warning(
                "Failed to trim Agent App answer text: run_id=%s message_id=%s",
                terminal.run_id,
                message_id,
                exc_info=True,
            )
        try:
            self._publish_terminal_answer(
                queue_manager=queue_manager,
                model_name=model_name,
                answer=answer,
                query=query,
                usage=terminal_usage,
            )
        except GenerateTaskStoppedError:
            # Stop can become visible after stream consumption returned its
            # success but before the final chunk/end reaches the consumer.
            self._finish_stopped_terminal(
                terminal,
                dify_context=dify_context,
                session_scope=scope,
                binding_id=runtime.binding_id,
                message_id=message_id,
            )
            raise
        self._save_session(
            scope=scope,
            binding_id=runtime.binding_id,
            snapshot=terminal.session_snapshot,
        )
        tracing_hooks = application_tracing_hooks()
        if tracing_hooks is not None:
            tracing_hooks.capture_agent_app_terminal(
                tenant_id=dify_context.tenant_id,
                app_id=dify_context.app_id,
                message_id=message_id,
                outcome="succeeded",
                output=answer,
            )

    def _build_session_scope(
        self,
        *,
        dify_context: DifyRunContext,
        agent_id: str,
        agent_config_snapshot_id: str,
        home_snapshot_id: str | None,
        conversation_id: str,
        session_scope_snapshot_id: str | None | _DefaultSessionScopeSnapshotId,
        agent_config_version_kind: AgentConfigVersionKind,
        build_draft_id: str | None = None,
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
            agent_config_snapshot_id=effective_session_scope_snapshot_id or agent_config_snapshot_id,
            home_snapshot_id=home_snapshot_id,
            agent_config_version_kind=agent_config_version_kind,
            build_draft_id=build_draft_id,
        )

    def _build_runtime(
        self,
        *,
        dify_context: DifyRunContext,
        agent_id: str,
        agent_config_snapshot_id: str,
        agent_config_version_kind: Literal["snapshot", "draft", "build_draft"],
        agent_soul: AgentSoulConfig,
        binding_id: str,
        backend_binding_ref: str,
        conversation_id: str,
        query: str,
        inputs: Mapping[str, Any],
        files: tuple[File, ...],
        image_detail_config: ImagePromptMessageContent.DETAIL | None,
        idempotency_key: str,
        stored: StoredAgentAppSession,
    ) -> AgentAppRuntimeRequest:
        session_snapshot = stored.session_snapshot
        return self._request_builder.build(
            AgentAppRuntimeBuildContext(
                dify_context=dify_context,
                agent_id=agent_id,
                agent_config_snapshot_id=agent_config_snapshot_id,
                agent_config_version_kind=agent_config_version_kind,
                agent_soul=agent_soul,
                conversation_id=conversation_id,
                user_query=query,
                inputs=inputs,
                files=files,
                image_detail_config=image_detail_config,
                idempotency_key=idempotency_key,
                binding_id=binding_id,
                backend_binding_ref=backend_binding_ref,
                session_snapshot=session_snapshot,
            )
        )

    def _consume_stream(
        self,
        run_id: str,
        *,
        dify_context: DifyRunContext,
        message_id: str,
        queue_manager: AppQueueManager,
        model_name: str,
        query: str | None,
        session_scope: AgentAppSessionScope,
        binding_id: str,
        tool_labels: Mapping[str, I18nObjectDict] | None = None,
    ):
        """Consume backend events while preserving raw recorder granularity."""
        terminal = None
        process_recorder = _AgentProcessRecorder(
            dify_context=dify_context,
            message_id=message_id,
            queue_manager=queue_manager,
            tool_labels=tool_labels,
        )
        text_delta_debouncer = _TextDeltaDebouncer(debounce_seconds=self._text_delta_debounce_seconds)
        last_event_id: str | None = None

        def persist_answer_text(content_delta: str) -> None:
            try:
                process_recorder.append_answer_text(content_delta)
            except Exception:
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

        cancellation_attempted = False

        def cancel_current_run() -> None:
            """Finish retained tool metadata once even when Stop races a text flush."""
            nonlocal cancellation_attempted
            if not cancellation_attempted:
                cancellation_attempted = True
                self._cancel_run(
                    run_id,
                    after=last_event_id,
                    session_scope=session_scope,
                    binding_id=binding_id,
                    message_id=message_id,
                    dify_context=dify_context,
                    queue_manager=queue_manager,
                    process_recorder=process_recorder,
                )

        try:
            public_events = self._agent_backend_client.stream_events(
                run_id,
                should_stop=queue_manager.is_stopped,
            )
            for public_event in public_events:
                if public_event.id is not None:
                    last_event_id = public_event.id
                internal_events = self._event_adapter.adapt(public_event)
                for internal_event in internal_events:
                    if isinstance(
                        internal_event,
                        AgentBackendRunSucceededInternalEvent
                        | AgentBackendRunFailedInternalEvent
                        | AgentBackendRunCancelledInternalEvent,
                    ):
                        # A terminal frame may already have arrived when stop
                        # becomes visible. Keep the observed runtime result.
                        terminal = internal_event
                        break
                if terminal is not None:
                    break
                if queue_manager.is_stopped():
                    raise GenerateTaskStoppedError()
                for internal_event in internal_events:
                    if queue_manager.is_stopped():
                        raise GenerateTaskStoppedError()
                    if internal_event.type in (
                        AgentBackendInternalEventType.RUN_STARTED,
                        AgentBackendInternalEventType.STREAM_EVENT,
                        AgentBackendInternalEventType.AGENT_MESSAGE_DELTA,
                    ):
                        if isinstance(internal_event, AgentBackendAgentMessageDeltaInternalEvent):
                            debounced_delta = text_delta_debouncer.push(internal_event.delta)
                            if debounced_delta:
                                persist_answer_text(debounced_delta)
                            continue

                        if isinstance(internal_event, AgentBackendStreamInternalEvent):
                            flush_pending_agent_message_text()
                            try:
                                process_recorder.handle_stream_event(internal_event)
                            except Exception:
                                logger.warning(
                                    "Failed to persist Agent App process event: run_id=%s message_id=%s event_kind=%s",
                                    run_id,
                                    message_id,
                                    internal_event.event_kind,
                                    exc_info=True,
                                )
                            continue
                        continue
        except GenerateTaskStoppedError:
            with suppress(GenerateTaskStoppedError):
                flush_pending_agent_message_text()
            cancel_current_run()
            raise
        except Exception as error:
            with suppress(GenerateTaskStoppedError):
                flush_pending_agent_message_text()
            cancel_current_run()
            if queue_manager.is_stopped():
                raise GenerateTaskStoppedError() from error
            raise
        if terminal is not None:
            process_recorder.finish(terminal)
        try:
            flush_pending_agent_message_text()
        except GenerateTaskStoppedError:
            if terminal is not None:
                self._finish_stopped_terminal(
                    terminal,
                    dify_context=dify_context,
                    session_scope=session_scope,
                    binding_id=binding_id,
                    message_id=message_id,
                )
            else:
                cancel_current_run()
            raise
        if queue_manager.is_stopped():
            if terminal is not None:
                self._finish_stopped_terminal(
                    terminal,
                    dify_context=dify_context,
                    session_scope=session_scope,
                    binding_id=binding_id,
                    message_id=message_id,
                )
            else:
                cancel_current_run()
            raise GenerateTaskStoppedError()
        return terminal, process_recorder

    def _cancel_run(
        self,
        run_id: str,
        *,
        after: str | None,
        session_scope: AgentAppSessionScope,
        binding_id: str,
        message_id: str,
        dify_context: DifyRunContext,
        queue_manager: AppQueueManager,
        process_recorder: _AgentProcessRecorder | None = None,
    ) -> None:
        """Retain terminal usage and thought metadata even after SSE consumption stops."""
        try:
            public_event = self._agent_backend_client.cancel_run_and_wait(run_id, after=after)
            for internal_event in self._event_adapter.adapt(public_event):
                if isinstance(
                    internal_event,
                    AgentBackendRunSucceededInternalEvent
                    | AgentBackendRunFailedInternalEvent
                    | AgentBackendRunCancelledInternalEvent,
                ):
                    recorder = process_recorder or _AgentProcessRecorder(
                        dify_context=dify_context, message_id=message_id, queue_manager=queue_manager
                    )
                    recorder.finish(internal_event)
                    self._finish_stopped_terminal(
                        internal_event,
                        dify_context=dify_context,
                        session_scope=session_scope,
                        binding_id=binding_id,
                        message_id=message_id,
                        queue_manager=queue_manager,
                    )
        except Exception:
            logger.warning(
                "Failed to finish cancelling stopped Agent App backend run: run_id=%s",
                run_id,
                exc_info=True,
            )

    def _finish_stopped_terminal(
        self,
        terminal: AgentBackendRunSucceededInternalEvent
        | AgentBackendRunFailedInternalEvent
        | AgentBackendRunCancelledInternalEvent,
        *,
        dify_context: DifyRunContext,
        session_scope: AgentAppSessionScope,
        binding_id: str,
        message_id: str,
        queue_manager: AppQueueManager | None = None,
    ) -> None:
        """Keep the observed runtime result when the client has requested stop."""
        if terminal.session_snapshot is not None:
            self._save_session(scope=session_scope, binding_id=binding_id, snapshot=terminal.session_snapshot)
        self._persist_message_usage(message_id=message_id, usage=_llm_usage_from_agent_backend(terminal.usage))
        if queue_manager is not None and not queue_manager.is_stopped():
            # A stream error can cancel its runtime only for cleanup. Keep its
            # snapshot/usage, but let the original business failure own the root.
            # Check after cleanup so a Stop observed during its wait still wins.
            return
        tracing_hooks = application_tracing_hooks()
        if tracing_hooks is not None:
            outcome: Literal["succeeded", "failed", "cancelled"]
            if isinstance(terminal, AgentBackendRunSucceededInternalEvent):
                outcome = "succeeded"
            elif isinstance(terminal, AgentBackendRunFailedInternalEvent):
                outcome = "failed"
            else:
                outcome = "cancelled"
            tracing_hooks.capture_agent_app_terminal(
                tenant_id=dify_context.tenant_id,
                app_id=dify_context.app_id,
                message_id=message_id,
                outcome=outcome,
                output=(
                    self._terminal_output_to_answer(terminal.output)
                    if isinstance(terminal, AgentBackendRunSucceededInternalEvent)
                    else None
                ),
            )

    def _publish_terminal_answer(
        self,
        *,
        queue_manager: AppQueueManager,
        model_name: str,
        answer: str,
        query: str | None,
        usage: LLMUsage | None,
    ) -> None:
        """Finish a successful turn from the backend terminal output."""
        publish_text_answer(
            queue_manager=queue_manager,
            model_name=model_name,
            answer=answer,
            usage=usage,
            user_query=query,
        )

    @staticmethod
    def _persist_message_usage(*, message_id: str, usage: LLMUsage | None) -> None:
        """Persist terminal usage independently of the client-facing stream lifecycle."""
        if usage is None or (usage.total_tokens <= 0 and usage.total_price <= 0):
            return
        try:
            # A stopped consumer may have committed its stop intent/partial
            # answer through another session. Merge usage with that latest row
            # under the same short lock used by its save, not an identity-cache
            # snapshot that can erase the intent or newer reported usage.
            with create_session() as session:
                message = session.get(Message, message_id, populate_existing=True, with_for_update=True)
                if message is None:
                    logger.warning("Cannot persist Agent App usage: message not found: %s", message_id)
                    return
                message.message_tokens = usage.prompt_tokens
                message.message_unit_price = usage.prompt_unit_price
                message.message_price_unit = usage.prompt_price_unit
                message.answer_tokens = usage.completion_tokens
                message.answer_unit_price = usage.completion_unit_price
                message.answer_price_unit = usage.completion_price_unit
                message.total_price = usage.total_price
                message.currency = usage.currency
                if usage.latency > 0:
                    message.provider_response_latency = usage.latency

                try:
                    metadata = json.loads(message.message_metadata) if message.message_metadata else {}
                except (json.JSONDecodeError, TypeError):
                    metadata = {}
                if not isinstance(metadata, dict):
                    metadata = {}
                metadata["usage"] = usage.model_dump(mode="json")
                message.message_metadata = json.dumps(metadata, ensure_ascii=False)
                session.commit()
        except Exception:
            logger.warning("Failed to persist partial Agent App usage: message_id=%s", message_id, exc_info=True)

    def _save_session(
        self,
        *,
        scope: AgentAppSessionScope,
        binding_id: str,
        snapshot: Any,
    ) -> bool:
        try:
            self._session_store.save_active_snapshot(
                scope=scope,
                binding_id=binding_id,
                snapshot=snapshot,
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
