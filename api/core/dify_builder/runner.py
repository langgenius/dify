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

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from core.dify_builder import recovery
from core.dify_builder.contract import (
    AgentMessageEventData,
    AssistantTurnItem,
    ErrorCard,
    ProgressEventData,
    Trace,
    UserItem,
)
from core.dify_builder.errors import ConflictError
from core.dify_builder.models import (
    Checkpoint,
    ConversationItem,
    DifyBuilderContext,
    NodeEvent,
    Run,
    Session,
    Snapshot,
    Turn,
)
from core.dify_builder.ports import DifyBuilderAgent, DifyPort, Repository
from core.dify_builder.state import PcState, is_terminal, is_waiting

__all__ = ["CommittedTransition", "Env", "Handler", "Runner", "StepResult"]

_MESSAGE_HISTORY_LIMIT = 24


@dataclass(frozen=True)
class CommittedTransition:
    """One durable session transition, observable only after its CAS wins.

    ``settled`` marks the transition after which this ``advance`` invocation
    returns. It is deliberately independent from the destination state's
    waiting/terminal classification: stop, resume, and conversational turns
    settle even when they leave the program counter on a working state.
    """

    session_id: str
    operation_id: str
    stage_id: str
    at_version: int
    version: int
    state: PcState
    settled: bool
    items: list[ConversationItem]


@dataclass
class Env:
    dify: DifyPort
    agent: DifyBuilderAgent
    repo: Repository
    now: Callable[[], datetime]
    # Emit forwards live progress (node events) during a working step. The
    # usecase sets it per-Advance to publish to the session broadcaster; None
    # is treated as a no-op.
    emit: Callable[[NodeEvent], None] | None = None
    # Emit forwards granular canvas mutations (add_*_node, apply_error_fix,
    # ...) as each MutationIntent is applied. None is treated as a no-op --
    # the caller (a handler) decides whether to wire it (opt-in, spec Sec 6):
    # Build wants one event per intent, Edit suppresses these and fires one
    # coarse apply_edit_plan itself instead.
    emit_canvas: Callable[[dict], None] | None = None
    # Called after (and only after) a successful compare-and-advance CAS.
    # The async task uses this to expose durable conversation increments to
    # the POST stream without turning an intermediate transition into a
    # terminal state frame.
    emit_commit: Callable[[CommittedTransition], None] | None = None
    # Called for each assistant text delta before the completed assistant item
    # is committed. The accumulated reply becomes authoritative in the
    # CAS-backed commit below.
    emit_message: Callable[[AgentMessageEventData], None] | None = None
    # Called for low-frequency, curated trace snapshots while a handler is
    # doing structured cognition or external work. These events are transient;
    # the next CAS-backed commit remains authoritative.
    emit_progress: Callable[[ProgressEventData], None] | None = None
    # Correlation metadata for the handler transition currently running.
    # The runner resets it before every independently committed step.
    operation_id: str = ""
    stage_id: str = ""
    at_version: int = 0
    event_revision: int = 0

    def begin_operation(self, session: Session) -> None:
        self.operation_id = str(uuid.uuid4())
        self.stage_id = str(session.current_state)
        self.at_version = session.version + 1
        self.event_revision = 0

    def next_event_revision(self) -> int:
        self.event_revision += 1
        return self.event_revision


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
        for item in items:
            # Handler helpers own conversation sequence numbers; the runner is
            # the only layer that knows which CAS version will make them
            # durable. Stamp every item here so cards can never remain at the
            # placeholder version used while a step is being assembled.
            item.at_version = at_version
        new_version = self._env.repo.compare_and_advance(
            session.id,
            session.version,
            next_state,
            context,
            items,
        )
        session.version = new_version
        session.current_state = next_state
        if self._env.emit_commit is not None:
            self._env.emit_commit(
                CommittedTransition(
                    session_id=session.id,
                    operation_id=self._env.operation_id,
                    stage_id=self._env.stage_id,
                    at_version=new_version,
                    version=new_version,
                    state=next_state,
                    settled=settled,
                    items=list(items),
                )
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
        item = ErrorCard(
            title="Builder step failed",
            body="The operation could not be completed. Restart from the current draft to continue.",
        ).to_item(seq=context.next_seq, at_version=session.version + 1)
        context.next_seq += 1
        self._commit(session, PcState.FAILED, context, [item], settled=True)
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
        self._env.begin_operation(s)

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
            # check_recovery / recovery_continue stay at the current waiting state,
            # and recovery_restart into BUILD/EDIT lands on the waiting
            # capability_check — all rest here. recovery_restart into FIX /
            # FIX_CHECKLIST lands on a *working* entry state (fix.diagnose /
            # checklist.diagnose) that the runner must drive, exactly like any
            # transition into a working state — fall through to the advance loop
            # with the recovery action consumed.
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

            def emit_delta(delta: str) -> None:
                if not delta or self._env.emit_message is None:
                    return
                self._env.emit_message(
                    AgentMessageEventData(
                        session_id=s.id,
                        operation_id=self._env.operation_id,
                        id=turn_id,
                        answer=delta,
                        seq=assistant_seq,
                        at_version=assistant_version,
                        revision=self._env.next_event_revision(),
                        stage_id=str(s.current_state),
                    )
                )

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
            assistant_item = AssistantTurnItem(
                turn_id=turn_id,
                stage_id=str(s.current_state),
                trace=Trace(status="completed"),
                reply_text=reply,
            ).to_item(seq=assistant_seq, at_version=assistant_version)
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
