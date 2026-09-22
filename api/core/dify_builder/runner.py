"""DifyBuilder program-counter runner: the version-CAS advance loop.

Port of dify-enterprise/server/pkg/enterprise/biz/dify_builder/runner.go. This is
the engine's crux — the loop below is an exact port of ``Runner.Advance``
(``runner.go:46-118``); do not "improve" its shape, only its idiom.

Deltas from the Go source (per the P1 port plan's Global Constraints / ADR):

- ``Turn.Auth ForwardAuth`` doesn't exist here; ``Turn.actor: Actor`` is
  carried through instead (see ``models.py``). The "action consumed, keep
  auth for working steps" rule becomes "action consumed, keep actor".
- Go's ``*string`` run-id sink (``StepResult.runIDSink``, written via
  ``*res.runIDSink = res.Run.ID``) has no Python equivalent — a plain
  ``str`` can't be mutated in place. ``StepResult.run_id_sink`` is instead a
  single-element ``list[str] | None``; the runner writes the saved run id to
  ``run_id_sink[0]``.
- Go returns ``(*Session, error)``; Python raises instead (``ConflictError``
  from a lost CAS race or a stale ``base_version``; a plain error for a
  missing registry entry, mirroring Go's non-sentinel ``fmt.Errorf``).
"""

import logging
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime

from core.dify_builder import recovery
from core.dify_builder.contract import (
    AgentMessageEventData,
    AssistantTurnItem,
    ConversationItemAppendedEventData,
    ExecutionProgress,
    ProgressEventData,
    ReasoningEventData,
    UserItem,
)
from core.dify_builder.errors import ConflictError
from core.dify_builder.models import (
    Checkpoint,
    ConversationItem,
    DifyBuilderContext,
    Run,
    Session,
    Snapshot,
    Turn,
)
from core.dify_builder.ports import DifyBuilderAgent, DifyPort, ReasoningStreamingAgent, Repository
from core.dify_builder.state import PcState, is_terminal, is_waiting

__all__ = ["Env", "Handler", "Runner", "StepResult"]

_MESSAGE_HISTORY_LIMIT = 24
_MAX_REASONING_CHARS = 64_000
_ASSISTANT_TEXT_CHUNK_CHARS = 16
_ASSISTANT_TEXT_BREAKS = frozenset(" \t\r\n.,!?;:，。！？；：")

logger = logging.getLogger(__name__)


def _assistant_text_chunks(text: str) -> list[str]:
    """Split deterministic copy into exact, natural-looking SSE deltas."""
    chunks: list[str] = []
    start = 0
    while len(text) - start > _ASSISTANT_TEXT_CHUNK_CHARS:
        ceiling = start + _ASSISTANT_TEXT_CHUNK_CHARS
        floor = start + (_ASSISTANT_TEXT_CHUNK_CHARS // 2)
        split = next(
            (index + 1 for index in range(ceiling - 1, floor - 1, -1) if text[index] in _ASSISTANT_TEXT_BREAKS),
            ceiling,
        )
        chunks.append(text[start:split])
        start = split
    if start < len(text):
        chunks.append(text[start:])
    return chunks


@dataclass
class _AssistantStream:
    session_id: str
    command_id: str
    operation_id: str
    turn_id: str
    seq: int
    at_version: int
    stage_id: str
    execution: ExecutionProgress
    cards: list[str]
    parts: list[str] = field(default_factory=list)
    text_bytes: int = 0
    sealed_text: str | None = None


@dataclass
class Env:
    dify: DifyPort
    agent: DifyBuilderAgent
    repo: Repository
    now: Callable[[], datetime]
    # Forward native workflow events unchanged. Node summaries remain local to
    # the progress reporter; the frontend consumes the full execution stream.
    emit_workflow: Callable[[Mapping[str, object]], None] | None = None
    # Emit forwards granular canvas mutations (add_*_node, apply_error_fix,
    # ...) as each MutationIntent is applied. None is treated as a no-op --
    # the caller (a handler) decides whether to wire it (opt-in, spec Sec 6):
    # Build wants one event per intent, Edit suppresses these and fires one
    # coarse apply_edit_plan itself instead.
    emit_canvas: Callable[[dict], None] | None = None
    # Called for each assistant text delta and its final marker. The sequence
    # is allocated before streaming; the final marker is emitted after the
    # assistant turn commits, before any attached conversation items.
    emit_message: Callable[[AgentMessageEventData], None] | None = None
    # Called after a CAS commit for every durable, frontend-visible item except
    # assistant_turn. Assistant content already travels through emit_message.
    emit_item: Callable[[ConversationItemAppendedEventData], None] | None = None
    # Called for low-frequency, curated execution-activity deltas while a
    # handler is doing structured cognition or external work. These events are
    # transient; the next CAS-backed commit remains authoritative.
    emit_progress: Callable[[ProgressEventData], None] | None = None
    # Called for model-provided reasoning deltas. Reasoning is accumulated on
    # the current operation and persisted with its assistant turn, independent
    # from observable execution progress.
    emit_reasoning: Callable[[ReasoningEventData], None] | None = None
    # Detects the user's input language (BCP-47) for a turn's user text. None -> no detection.
    # MUST NOT raise: the engine does not guard this call, so the service-layer
    # implementation is responsible for swallowing its own errors and returning a safe fallback.
    detect_language: Callable[[str], str] | None = None
    # Localizes an about-to-be-committed item list into the given language. None -> no-op.
    # MUST NOT raise: the engine does not guard this call, so the service-layer
    # implementation is responsible for swallowing its own errors and returning a safe fallback.
    localize_items: Callable[[list["ConversationItem"], str], list["ConversationItem"]] | None = None
    # Renames the session's app to a model-proposed title (spec N1) and returns
    # the name actually stored, or "" if nothing changed -- the engine records
    # that on the context, so it never claims a name the database does not have.
    # None -> no-op. MUST NOT raise: the engine does not guard this call, so the
    # service-layer implementation swallows its own errors -- a failed rename
    # leaves the derived name in place and never blocks the build.
    rename_app: Callable[[str], str] | None = None
    # Correlation metadata for the handler transition currently running.
    # The runner resets it before every independently committed step.
    session_id: str = ""
    operation_id: str = ""
    stage_id: str = ""
    at_version: int = 0
    event_revision: int = 0
    reasoning_text: str = ""
    command_id: str = ""
    prelocalized_seqs: set[int] = field(default_factory=set)
    assistant_streams: dict[int, _AssistantStream] = field(default_factory=dict)

    def begin_operation(self, session: Session) -> None:
        self.session_id = session.id
        self.operation_id = str(uuid.uuid4())
        self.stage_id = str(session.current_state)
        self.at_version = session.version + 1
        self.event_revision = 0
        self.reasoning_text = ""
        self.prelocalized_seqs.clear()
        self.assistant_streams.clear()
        if isinstance(self.agent, ReasoningStreamingAgent):
            self.agent.set_reasoning_callback(self.record_reasoning)

    def next_event_revision(self) -> int:
        self.event_revision += 1
        return self.event_revision

    def record_reasoning(self, span_id: str, delta: str) -> None:
        if not delta:
            return
        remaining = _MAX_REASONING_CHARS - len(self.reasoning_text)
        if remaining <= 0:
            return
        accepted = delta[:remaining]
        self.reasoning_text += accepted
        if self.emit_reasoning is not None:
            self.emit_reasoning(
                ReasoningEventData(
                    session_id=self.session_id,
                    operation_id=self.operation_id,
                    stage_id=self.stage_id,
                    at_version=self.at_version,
                    revision=self.next_event_revision(),
                    span_id=span_id,
                    delta=accepted,
                )
            )

    def begin_assistant_stream(
        self,
        session: Session,
        *,
        turn_id: str,
        seq: int,
        at_version: int,
        execution: ExecutionProgress,
        cards: list[str] | None = None,
    ) -> None:
        if seq in self.assistant_streams:
            raise RuntimeError(f"dify_builder: assistant stream already exists for seq {seq}")
        self.assistant_streams[seq] = _AssistantStream(
            session_id=session.id,
            command_id=self.command_id,
            operation_id=self.operation_id,
            turn_id=turn_id,
            seq=seq,
            at_version=at_version,
            stage_id=str(session.current_state),
            execution=execution,
            cards=list(cards or []),
        )

    def emit_assistant_delta(self, seq: int, delta: str) -> None:
        if not delta:
            return
        stream = self.assistant_streams[seq]
        if stream.sealed_text is not None:
            raise RuntimeError(f"dify_builder: assistant stream already sealed for seq {seq}")
        stream.parts.append(delta)
        stream.text_bytes += len(delta.encode("utf-8"))
        if self.emit_message is not None:
            self.emit_message(
                AgentMessageEventData(
                    session_id=stream.session_id,
                    command_id=stream.command_id,
                    operation_id=stream.operation_id,
                    turn_id=stream.turn_id,
                    delta=delta,
                    seq=stream.seq,
                    at_version=stream.at_version,
                    revision=self.next_event_revision(),
                    stage_id=stream.stage_id,
                    done=False,
                    text_bytes=stream.text_bytes,
                )
            )

    def seal_assistant_stream(self, seq: int, text: str) -> None:
        stream = self.assistant_streams[seq]
        emitted_text = "".join(stream.parts)
        if emitted_text != text:
            raise RuntimeError(f"dify_builder: streamed assistant text differs from persisted text for seq {seq}")
        stream.sealed_text = text

    def validate_assistant_stream(self, item: ConversationItem) -> None:
        stream = self.assistant_streams.get(item.seq)
        if stream is None or stream.sealed_text is None:
            raise RuntimeError(f"dify_builder: missing sealed assistant stream for seq {item.seq}")
        reply_text = item.payload.get("reply_text")
        persisted_text = reply_text if isinstance(reply_text, str) else ""
        if persisted_text != stream.sealed_text:
            raise RuntimeError(f"dify_builder: assistant stream does not match item for seq {item.seq}")

    def finish_assistant_stream(self, seq: int) -> None:
        stream = self.assistant_streams.pop(seq)
        if stream.sealed_text is None:
            raise RuntimeError(f"dify_builder: assistant stream is not sealed for seq {seq}")
        if self.emit_message is not None:
            self.emit_message(
                AgentMessageEventData(
                    session_id=stream.session_id,
                    command_id=stream.command_id,
                    operation_id=stream.operation_id,
                    turn_id=stream.turn_id,
                    delta="",
                    seq=stream.seq,
                    at_version=stream.at_version,
                    revision=self.next_event_revision(),
                    stage_id=stream.stage_id,
                    done=True,
                    text_bytes=stream.text_bytes,
                    execution=stream.execution,
                    cards=stream.cards,
                )
            )

    def append_assistant_turn(
        self,
        session: Session,
        context: DifyBuilderContext,
        *,
        reply_text: str,
        execution: ExecutionProgress,
        cards: list[str] | None = None,
        turn_id: str | None = None,
    ) -> list[ConversationItem]:
        """Stream deterministic copy and persist the exact accumulated text."""
        item = AssistantTurnItem(
            turn_id=turn_id or self.operation_id or str(uuid.uuid4()),
            stage_id=str(session.current_state),
            execution=execution,
            reply_text=reply_text,
            cards=list(cards or []),
        ).to_item(seq=context.next_seq, at_version=session.version + 1)
        if self.localize_items is not None and context.reply_language:
            item = self.localize_items([item], context.reply_language)[0]
            self.prelocalized_seqs.add(item.seq)
        localized_text = item.payload.get("reply_text")
        text = localized_text if isinstance(localized_text, str) else ""
        self.begin_assistant_stream(
            session,
            turn_id=str(item.payload["turn_id"]),
            seq=item.seq,
            at_version=session.version + 1,
            execution=execution,
            cards=cards,
        )
        for chunk in _assistant_text_chunks(text):
            self.emit_assistant_delta(item.seq, chunk)
        self.seal_assistant_stream(item.seq, text)
        context.next_seq += 1
        return [item]


@dataclass
class StepResult:
    next: PcState
    context: DifyBuilderContext | None = None
    items: list[ConversationItem] = field(default_factory=list)
    checkpoint: Snapshot | None = None  # if set, persist a checkpoint from this snapshot before advancing
    run: Run | None = None  # if set, persist this run before advancing
    run_id_sink: list[str] | None = None  # internal: runner writes the saved run id to run_id_sink[0]


Handler = Callable[[Env, Turn, Session, DifyBuilderContext], StepResult]


class Runner:
    def __init__(self, env: Env, registry: dict[PcState, Handler]) -> None:
        self._env = env
        self._registry = registry

    def _commit(
        self,
        session: Session,
        next_state: PcState,
        context: DifyBuilderContext,
        items: list[ConversationItem],
        *,
        settled: bool,
    ) -> None:
        at_version = session.version + 1
        if self._env.localize_items is not None and context.reply_language:
            pending_localization = [item for item in items if item.seq not in self._env.prelocalized_seqs]
            localized = (
                self._env.localize_items(pending_localization, context.reply_language) if pending_localization else []
            )
            localized_by_seq = {item.seq: item for item in localized}
            items = [localized_by_seq.get(item.seq, item) for item in items]
        for item in items:
            # Handler helpers own conversation sequence numbers; the runner is
            # the only layer that knows which CAS version will make them
            # durable. Stamp every item here so cards can never remain at the
            # placeholder version used while a step is being assembled.
            item.at_version = at_version
            if item.kind == "assistant_turn" and self._env.reasoning_text:
                item.payload["reasoning_text"] = self._env.reasoning_text
            if item.kind == "assistant_turn":
                self._env.validate_assistant_stream(item)
        context.last_command_id = self._env.command_id
        new_version = self._env.repo.compare_and_advance(
            session.id,
            session.version,
            next_state,
            context,
            items,
        )
        session.version = new_version
        session.current_state = next_state
        for item in items:
            if item.kind == "assistant_turn":
                self._env.finish_assistant_stream(item.seq)
        if self._env.emit_item is not None:
            for item in items:
                if item.kind == "assistant_turn":
                    continue
                self._env.emit_item(
                    ConversationItemAppendedEventData(
                        session_id=session.id,
                        command_id=self._env.command_id,
                        item=item,
                    )
                )
        logger.info(
            "dify_builder transition committed",
            extra={
                "session_id": session.id,
                "command_id": self._env.command_id,
                "operation_id": self._env.operation_id,
                "from_stage": self._env.stage_id,
                "to_state": str(next_state),
                "version": new_version,
                "settled": settled,
                "item_count": len(items),
            },
        )

    def fail(self, session_id: str) -> Session:
        """Durably close an unexpected worker failure.

        The generic public copy is intentional: exception details stay in the
        worker log. A failed session remains restartable through the normal
        recovery action instead of being represented only by an expired Redis
        lock or an ephemeral SSE error. The operation metadata captured before
        the failing step also fences out an older worker whose lock expired:
        that worker must not overwrite a newer, non-terminal session head.
        """
        session, context = self._env.repo.get_session(session_id)
        if is_terminal(session.current_state):
            return session
        if self._env.at_version > 0 and (
            session.version != self._env.at_version - 1 or str(session.current_state) != self._env.stage_id
        ):
            raise ConflictError(
                f"dify_builder: refusing stale failure for session {session_id} "
                f"at version {session.version} state {session.current_state}"
            )
        self._env.begin_operation(session)
        items = self._env.append_assistant_turn(
            session,
            context,
            reply_text="The operation could not be completed. Restart from the current draft to continue.",
            execution=ExecutionProgress(status="error"),
        )
        self._commit(session, PcState.FAILED, context, items, settled=True)
        return session

    def advance(self, session_id: str, turn: Turn) -> Session:
        """Run the current state's handler with the turn, then auto-advance
        through working states until it reaches a waiting or terminal state.
        Each transition is a separate CAS commit. The turn's action is only
        consulted by the first (waiting-state) handler; working-state
        handlers ignore it but may use turn.actor to reach Dify. A lost
        version race raises ConflictError with nothing applied.
        """
        s, fc = self._env.repo.get_session(session_id)
        if turn.action is not None:
            self._env.command_id = turn.action.command_id
        self._env.begin_operation(s)

        if self._env.detect_language is not None:
            user_text = turn.action.payload.get("text") if turn.action is not None else None
            if isinstance(user_text, str) and user_text.strip():
                fc.reply_language = self._env.detect_language(user_text)
            elif not fc.reply_language and fc.goal_text:
                fc.reply_language = self._env.detect_language(fc.goal_text)

        action_kind = turn.action.kind if turn.action is not None else ""

        # A retried message may arrive after its user bubble committed but the
        # worker failed before the assistant bubble. Correlate by the
        # client-generated turn id before applying the normal stale-version
        # gate: a complete turn is an idempotent success; a partial turn
        # resumes from the durable head without duplicating the user message.
        message_user_exists = False
        if action_kind == "message" and turn.action is not None:
            turn_id = turn.action.payload.get("client_turn_id")
            if not isinstance(turn_id, str) or not turn_id:
                raise ValueError("dify_builder: message client_turn_id is required")
            turn_kinds = self._env.repo.get_conversation_turn_kinds(session_id, turn_id)
            message_user_exists = "user" in turn_kinds
            if "assistant_turn" in turn_kinds:
                return s
            if message_user_exists:
                turn.action.base_version = s.version

        # Optimistic-concurrency gate: reject up front if the client acted on
        # a stale view (someone hand-edited between turns). compare_and_advance
        # re-checks atomically at commit; this early check avoids running a
        # handler for nothing.
        if turn.action is not None and turn.action.base_version != s.version:
            raise ConflictError(
                f"dify_builder: stale base_version {turn.action.base_version} "
                f"for session {session_id} (current {s.version})"
            )

        if action_kind in ("stop", "resume"):
            fc.paused = action_kind == "stop"
            self._commit(s, s.current_state, fc, [], settled=True)
            return s
        if action_kind in ("check_recovery", "recovery_continue", "recovery_restart"):
            next_state, items = recovery.apply_recovery_action(self._env.dify, turn, s, fc)
            # check_recovery / recovery_continue stay at the current waiting
            # state. Restart into EDIT still rests at its input gate; BUILD,
            # FIX, and FIX_CHECKLIST restart into working entry states that the
            # runner must drive, so those fall through with the recovery action
            # consumed.
            settled = is_waiting(next_state) or is_terminal(next_state)
            self._commit(s, next_state, fc, items, settled=settled)
            if settled:
                return s
            turn = Turn(actor=turn.actor)  # action consumed
            self._env.begin_operation(s)
            # fall through to the advance loop below

        if action_kind == "message":
            assert turn.action is not None  # narrowed by action_kind
            text = turn.action.payload.get("text")
            turn_id = turn.action.payload.get("client_turn_id")
            if not isinstance(text, str) or not text or not isinstance(turn_id, str) or not turn_id:
                raise ValueError("dify_builder: invalid message action")

            # Chat is a two-commit turn. The first commit makes the user bubble
            # durable before model invocation; if cognition fails, a retry
            # with the same client_turn_id resumes at the assistant half.
            if not message_user_exists:
                user_item = UserItem(text=text, turn_id=turn_id).to_item(
                    seq=fc.next_seq,
                    at_version=s.version + 1,
                )
                fc.next_seq += 1
                self._commit(s, s.current_state, fc, [user_item], settled=False)
                # The assistant half targets the next CAS version. Give it a
                # fresh operation fence so a failure after the durable user
                # bubble can still be recorded without looking like a stale
                # worker from the prior commit.
                self._env.begin_operation(s)

            graph, _graph_hash = self._env.dify.read_graph(s.app_id, turn.actor)
            assistant_seq = fc.next_seq
            assistant_version = s.version + 1
            streamed_parts: list[str] = []
            execution = ExecutionProgress(status="completed")
            self._env.begin_assistant_stream(
                s,
                turn_id=turn_id,
                seq=assistant_seq,
                at_version=assistant_version,
                execution=execution,
            )

            def emit_delta(delta: str) -> None:
                if not delta:
                    return
                streamed_parts.append(delta)
                self._env.emit_assistant_delta(assistant_seq, delta)

            message_history = self._env.repo.list_recent_conversation(
                session_id,
                limit=_MESSAGE_HISTORY_LIMIT,
            )
            reply = self._env.agent.respond_to_message(
                s.current_state,
                fc,
                message_history,
                graph,
                text,
                emit_delta,
            )
            streamed_reply = "".join(streamed_parts)
            if not streamed_reply:
                # Protocol adapters are expected to use ``on_delta``. Preserve
                # the invariant for simpler implementations by turning their
                # returned reply into one stream delta before the final marker.
                emit_delta(reply)
                streamed_reply = reply
            elif streamed_reply != reply:
                logger.warning(
                    "dify_builder agent returned text that differed from its streamed deltas; "
                    "persisting the streamed text",
                    extra={
                        "session_id": s.id,
                        "command_id": self._env.command_id,
                        "operation_id": self._env.operation_id,
                    },
                )
            self._env.seal_assistant_stream(assistant_seq, streamed_reply)
            assistant_item = AssistantTurnItem(
                turn_id=turn_id,
                stage_id=str(s.current_state),
                execution=execution,
                reply_text=streamed_reply,
            ).to_item(seq=assistant_seq, at_version=assistant_version)
            # The live stream is the text authority. Do not let the generic
            # item-localization pass rewrite this reply before persistence.
            self._env.prelocalized_seqs.add(assistant_seq)
            fc.next_seq += 1
            # The program counter stays at the current gate. Only explicit
            # actions may approve, publish, revert, run, or mutate a workflow.
            self._commit(s, s.current_state, fc, [assistant_item], settled=True)
            return s

        first = True
        while True:
            if is_waiting(s.current_state) and first and turn.action is None:
                return s  # nothing to do
            if is_terminal(s.current_state):
                return s

            handler = self._registry.get(s.current_state)
            if handler is None:
                raise RuntimeError(f"dify_builder: no handler for state {s.current_state}")

            if not first:
                self._env.begin_operation(s)
            step_turn = turn if first else Turn(actor=turn.actor)  # action consumed; keep actor for working steps
            res = handler(self._env, step_turn, s, fc)
            if res.context is None:
                res.context = fc

            # Persist side effects (checkpoint, run) BEFORE the CAS commit. On a
            # lost CAS race these rows are orphaned (harmless, unreferenced) —
            # the deliberate tradeoff is orphan-on-failure over a committed
            # context that dangles at a row we never wrote. Making the external
            # Dify effects idempotent + adding a reconciler for interrupted
            # steps is future work.
            if res.checkpoint is not None:
                cp = Checkpoint(session_id=s.id, state=s.current_state)
                self._env.repo.create_checkpoint(cp, res.checkpoint)
                res.context.checkpoint_id = cp.id
            if res.run is not None:
                self._env.repo.save_run(s.id, res.run)
                if res.run_id_sink is not None:
                    res.run_id_sink[0] = res.run.id

            settled = is_waiting(res.next) or is_terminal(res.next)
            self._commit(s, res.next, res.context, res.items, settled=settled)
            fc = res.context
            first = False

            if settled:
                return s
