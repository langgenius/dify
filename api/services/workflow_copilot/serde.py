"""Pure JSON (de)serialization for the domain ``FixContext``.

``FixContext`` (see ``core.workflow_copilot.models``) is the per-session
working state persisted, one row per version, as the ``context`` JSONB
column on ``workflow_copilot_session_commits`` (P3a Task 4). This module
has no I/O and no SQLAlchemy dependency -- it only converts between the
dataclass and a JSON-safe ``dict``, so the SQL repository can hand the dict
straight to an ``AdjustedJSON`` column and get it back unchanged.
"""

from dataclasses import asdict
from typing import Any

from core.workflow_copilot.models import (
    ChangeSet,
    ChecklistError,
    Diagnosis,
    FixContext,
    MutationIntent,
    Risk,
)


def fix_context_to_dict(fc: FixContext) -> dict[str, Any]:
    """Serialize a ``FixContext`` to a JSON-safe dict.

    ``dataclasses.asdict`` recurses into the nested dataclasses
    (``Diagnosis``, ``MutationIntent``, ``Risk``, ``ChangeSet``,
    ``ChecklistError``), turning each into a plain dict, and every field on
    ``FixContext`` and its nested dataclasses is already a
    str/int/bool/list/dict/None -- so the result is JSON-safe as-is.
    """
    return asdict(fc)


def fix_context_from_dict(d: dict[str, Any]) -> FixContext:
    """Rebuild a ``FixContext`` from a dict produced by ``fix_context_to_dict``.

    Reconstructs the nested dataclasses explicitly rather than splatting
    ``d`` into ``FixContext(**d)`` -- the nested values are plain dicts (and
    lists of dicts) after a JSON round-trip and must become the right
    dataclass instances. Every lookup is defensive (``.get`` with a default
    matching the ``FixContext``/nested-dataclass field default) so an
    older or partial dict still yields a valid ``FixContext``.
    """
    diagnosis = Diagnosis(**d["diagnosis"]) if d.get("diagnosis") else None
    staged_repair = [MutationIntent(**m) for m in d.get("staged_repair", [])]
    risk = Risk(**d["risk"]) if d.get("risk") else None
    change_set = ChangeSet(**d["change_set"]) if d.get("change_set") else None
    checklist_errors = [ChecklistError(**e) for e in d.get("checklist_errors", [])]

    return FixContext(
        failed_run_id=d.get("failed_run_id", ""),
        diagnosis=diagnosis,
        staged_repair=staged_repair,
        risk=risk,
        change_set=change_set,
        checkpoint_id=d.get("checkpoint_id", ""),
        verify_run_id=d.get("verify_run_id", ""),
        test_input_ref=d.get("test_input_ref", ""),
        last_snapshot_hash=d.get("last_snapshot_hash", ""),
        next_seq=d.get("next_seq", 0),
        source=d.get("source", ""),
        checklist_errors=checklist_errors,
    )
