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

__all__ = ["Env", "Handler", "Runner", "StepResult"]


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

    def advance(self, session_id: str, turn: Turn) -> Session:
        """Run the current state's handler with the turn, then auto-advance
        through working states until it reaches a waiting or terminal state.
        Each transition is a separate CAS commit. The turn's action is only
        consulted by the first (waiting-state) handler; working-state
        handlers ignore it but may use turn.actor to reach Dify. A lost
        version race raises ConflictError with nothing applied.
        """
        s, fc = self._env.repo.get_session(session_id)

        # Optimistic-concurrency gate: reject up front if the client acted on
        # a stale view (someone hand-edited between turns). compare_and_advance
        # re-checks atomically at commit; this early check avoids running a
        # handler for nothing.
        if turn.action is not None and turn.action.base_version != s.version:
            raise ConflictError(
                f"dify_builder: stale base_version {turn.action.base_version} "
                f"for session {session_id} (current {s.version})"
            )

        action_kind = turn.action.kind if turn.action is not None else ""
        if action_kind in ("stop", "resume"):
            fc.paused = action_kind == "stop"
            s.version = self._env.repo.compare_and_advance(s.id, s.version, s.current_state, fc, [])
            return s
        if action_kind in ("check_recovery", "recovery_continue", "recovery_restart"):
            next_state, items = recovery.apply_recovery_action(self._env.dify, turn, s, fc)
            s.version = self._env.repo.compare_and_advance(s.id, s.version, next_state, fc, items)
            s.current_state = next_state
            # check_recovery / recovery_continue stay at the current waiting state,
            # and recovery_restart into BUILD/EDIT lands on the waiting
            # capability_check — all rest here. recovery_restart into FIX /
            # FIX_CHECKLIST lands on a *working* entry state (fix.diagnose /
            # checklist.diagnose) that the runner must drive, exactly like any
            # transition into a working state — fall through to the advance loop
            # with the recovery action consumed.
            if is_waiting(s.current_state) or is_terminal(s.current_state):
                return s
            turn = Turn(actor=turn.actor)  # action consumed
            # fall through to the advance loop below

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

            new_version = self._env.repo.compare_and_advance(s.id, s.version, res.next, res.context, res.items)
            s.version = new_version
            s.current_state = res.next
            fc = res.context
            first = False

            if is_waiting(res.next) or is_terminal(res.next):
                return s
