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

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from core.dify_builder import recovery
from core.dify_builder.contract import AgentMessageEventData, AssistantTurnItem, Trace, UserItem
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


@dataclass(frozen=True)
class CommittedTransition:
    """One durable session transition, observable only after its CAS wins.

    ``settled`` marks the transition after which this ``advance`` invocation
    returns. It is deliberately independent from the destination state's
    waiting/terminal classification: stop, resume, and conversational turns
    settle even when they leave the program counter on a working state.
    """

    session_id: str
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
                    version=new_version,
                    state=next_state,
                    settled=settled,
                    items=list(items),
                )
            )

    def advance(self, session_id: str, turn: Turn) -> Session:
        """Run the current state's handler with the turn, then auto-advance
        through working states until it reaches a waiting or terminal state.
        Each transition is a separate CAS commit. The turn's action is only
        consulted by the first (waiting-state) handler; working-state
        handlers ignore it but may use turn.actor to reach Dify. A lost
        version race raises ConflictError with nothing applied.
        """
        s, fc = self._env.repo.get_session(session_id)

        action_kind = turn.action.kind if turn.action is not None else ""

        # A retried message may arrive after its user bubble committed but the
        # worker failed before the assistant bubble. Correlate by the
        # client-generated turn id before applying the normal stale-version
        # gate: a complete turn is an idempotent success; a partial turn
        # resumes from the durable head without duplicating the user message.
        message_history: list[ConversationItem] | None = None
        message_user_exists = False
        if action_kind == "message" and turn.action is not None:
            turn_id = turn.action.payload.get("client_turn_id")
            if not isinstance(turn_id, str) or not turn_id:
                raise ValueError("dify_builder: message client_turn_id is required")
            message_history = self._env.repo.list_conversation(session_id)
            message_user_exists = any(
                item.kind == "user" and item.payload.get("turn_id") == turn_id for item in message_history
            )
            assistant_exists = any(
                item.kind == "assistant_turn" and item.payload.get("turn_id") == turn_id for item in message_history
            )
            if assistant_exists:
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
                message_history = self._env.repo.list_conversation(session_id)

            graph, _graph_hash = self._env.dify.read_graph(s.app_id, turn.actor)
            assistant_seq = fc.next_seq
            assistant_version = s.version + 1

            def emit_delta(delta: str) -> None:
                if not delta or self._env.emit_message is None:
                    return
                self._env.emit_message(
                    AgentMessageEventData(
                        session_id=s.id,
                        id=turn_id,
                        answer=delta,
                        seq=assistant_seq,
                        at_version=assistant_version,
                        stage_id=str(s.current_state),
                    )
                )

            reply = self._env.agent.respond_to_message(
                s.current_state,
                fc,
                message_history or self._env.repo.list_conversation(session_id),
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
