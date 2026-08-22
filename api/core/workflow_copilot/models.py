"""Workflow Copilot domain models.

Port of dify-enterprise/server/pkg/enterprise/biz/copilot/models.go.

Deltas from the Go source (per the P1 port plan's Global Constraints / ADR):

- ``ForwardAuth`` is dropped entirely. ``Turn`` carries an ``Actor``
  (``account_id``, ``tenant_id``) instead of a forwarded console token, which
  is never persisted and only ever valid for a single ``Advance`` call.
- Every field except ``PcState``/``EntryMode``-typed fields
  (``Session.entry_mode``, ``Session.current_state``, ``Checkpoint.state``)
  and ``Turn.actor`` gets a default matching the Go zero value (``""``,
  ``0``, ``False``, empty list/dict, ``datetime.min``). This mirrors how the
  Go test suite constructs these structs: almost every struct literal in
  ``*_test.go`` sets only a handful of fields and relies on Go's implicit
  zero-initialization for the rest (e.g. ``&Session{AppID: "app", ...}``,
  ``&FixContext{}``, ``&FixContext{FailedRunID: "TR-1"}``). The excepted
  fields have no meaningful "empty" value (an empty string is not a valid
  ``PcState``/``EntryMode`` member) and are always set explicitly in the Go
  suite, so they stay required here.
- ``Diagnosis`` / ``Risk`` / ``MutationIntent`` / ``ChangeSet`` / ``NodeEvent``
  / ``ApplyResult`` (Go: ``ports.go``) live here rather than in ``ports.py``.
  ``FixContext`` embeds ``Diagnosis``/``Risk``/``ChangeSet``/
  ``MutationIntent`` directly, and defining them in ``ports.py`` (which
  imports the rest of these models) would create a models<->ports import
  cycle; ``ports.py`` imports them back out of this module instead.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from core.workflow_copilot.state import PcState


class EntryMode(StrEnum):
    FIX = "fix"
    FIX_CHECKLIST = "fix_checklist"
    BUILD = "build"
    EDIT = "edit"


@dataclass(kw_only=True)
class ChecklistError:
    """One pre-publish checklist finding for a node.

    Config errors (``messages``) are fixable via ``set_node_config``;
    ``unconnected`` and ``plugin_missing`` are structural — surfaced to the
    user, not auto-fixed in v1.
    """

    node_id: str = ""
    node_type: str = ""
    title: str = ""
    messages: list[str] = field(default_factory=list)
    unconnected: bool = False
    plugin_missing: bool = False


@dataclass(kw_only=True)
class Session:
    id: str = ""
    app_id: str = ""
    tenant_id: str = ""
    owner_account_id: str = ""
    entry_mode: EntryMode
    current_state: PcState
    version: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.min)
    updated_at: datetime = field(default_factory=lambda: datetime.min)


# Graph, Inputs and StartSchema are opaque JSON blobs the engine passes
# through; only the Dify adapter and the agent interpret them.
Graph = dict[str, Any]
Inputs = dict[str, Any]
StartSchema = dict[str, Any]


@dataclass(kw_only=True)
class NodeOutput:
    node_id: str = ""
    title: str = ""
    status: str = ""  # success | failed | skip
    error: str = ""
    inputs: Inputs = field(default_factory=dict)
    outputs: Inputs = field(default_factory=dict)


@dataclass(kw_only=True)
class Run:
    id: str = ""
    kind: str = ""  # original-failed | verify
    dify_run_id: str = ""
    status: str = ""  # running | succeeded | failed
    per_node: list[NodeOutput] = field(default_factory=list)
    culprit_node_id: str = ""
    inputs_ref: str = ""
    tokens: int = 0
    elapsed_ms: int = 0
    immutable: bool = False


@dataclass(kw_only=True)
class Snapshot:
    id: str = ""
    session_id: str = ""
    hash: str = ""
    graph: Graph = field(default_factory=dict)


@dataclass(kw_only=True)
class Checkpoint:
    id: str = ""
    session_id: str = ""
    state: PcState
    snapshot_id: str = ""


@dataclass(kw_only=True)
class TestInput:
    # Not a pytest test class; ``__test__`` (unannotated, so not a dataclass
    # field) tells pytest's Test*-name collector to skip it.
    __test__ = False

    id: str = ""
    session_id: str = ""
    source: str = ""  # reuse | mock | upload
    inputs: Inputs = field(default_factory=dict)
    start_schema_hash: str = ""


@dataclass(kw_only=True)
class ConversationItem:
    seq: int = 0
    kind: str = ""  # user | decision | notice | run_context | preflight_context | assistant_turn | plan
    # | form | challenge | resource_select | checkpoint | change_set | test_result | error | summary
    # | publish | build_learning
    payload: dict[str, Any] = field(default_factory=dict)
    at_version: int = 0


@dataclass(kw_only=True)
class Diagnosis:
    culprit_node_id: str = ""
    root_cause: str = ""
    severity: str = ""


@dataclass(kw_only=True)
class Risk:
    level: str = ""  # low | high
    reason: str = ""
    has_external_side_effect: bool = False


@dataclass(kw_only=True)
class MutationIntent:
    """A single graph mutation the copilot applies to the draft.

    ``op`` selects one of five verbs (Slice 1: mutation verbs); ``args`` is
    the verb's untyped wire-shaped payload -- ``services.workflow_copilot
    .graph_ops`` unpacks it as keyword arguments (``apply_fn(graph,
    **intent.args)``), so each verb's arg-dict keys below are exactly that
    verb's ``apply_*`` function's parameter names. Required keys are
    enforced by ``graph_ops.validate_intent_args``; ``?`` marks an optional
    key.

    - ``set_node_config``: ``{node_id, path, value}``
    - ``create_node``: ``{node_type, config, position?, node_id?}``
    - ``delete_node``: ``{node_id}``
    - ``connect``: ``{from_node, to_node, source_handle?, target_handle?}``
    - ``insert_between``: ``{edge, node_type, config, position?, node_id?}``
    """

    op: str = ""
    args: dict[str, Any] = field(default_factory=dict)


@dataclass(kw_only=True)
class ChangeSet:
    changed_nodes: list[str] = field(default_factory=list)
    diff: str = ""


@dataclass(kw_only=True)
class NodeEvent:
    """A per-node progress event emitted while a draft run streams."""

    node_id: str = ""
    title: str = ""
    status: str = ""
    error: str = ""


@dataclass(kw_only=True)
class ApplyResult:
    """Reports what a repair changed and the draft's new hash."""

    changed_nodes: list[str] = field(default_factory=list)
    new_hash: str = ""


@dataclass(kw_only=True)
class FixContext:
    """Per-session working state persisted as the commit context."""

    failed_run_id: str = ""
    diagnosis: Diagnosis | None = None
    staged_repair: list[MutationIntent] = field(default_factory=list)
    risk: Risk | None = None
    change_set: ChangeSet | None = None
    checkpoint_id: str = ""
    verify_run_id: str = ""
    test_input_ref: str = ""
    last_snapshot_hash: str = ""
    next_seq: int = 0
    # source distinguishes diagnosis origin: "" (run, default) | "checklist".
    source: str = ""
    checklist_errors: list[ChecklistError] = field(default_factory=list)


@dataclass(kw_only=True)
class Action:
    """A user-driven event entering the machine."""

    # request_fix | approve_repair | reject_repair | run_verify | provide_testdata |
    # publish | keep_draft | undo | re_fix | message
    kind: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
    base_version: int = 0


@dataclass(kw_only=True)
class Actor:
    """The acting console identity for one Advance call. Never persisted."""

    account_id: str
    tenant_id: str


@dataclass(kw_only=True)
class Turn:
    """Per-request data carried through one Advance.

    Replaces Go's ``Turn.Auth ForwardAuth`` — there is no forwarded console
    token in this port; ``actor`` identifies who is driving this turn.
    """

    action: Action | None = None
    actor: Actor
