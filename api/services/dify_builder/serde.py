"""Pure JSON (de)serialization for the domain ``DifyBuilderContext``.

``DifyBuilderContext`` (see ``core.dify_builder.models``) is the per-session
working state persisted, one row per version, as the ``context`` JSONB
column on ``dify_builder_session_commits``. This module has no I/O and
no SQLAlchemy dependency -- it only converts between the dataclass and a
JSON-safe ``dict``, so the SQL repository can hand the dict straight to an
``AdjustedJSON`` column and get it back unchanged. The on-disk key names are
unchanged from the pre-rename dataclass form so existing rows deserialize
as-is.
"""

from dataclasses import asdict
from typing import Any

from core.dify_builder.models import (
    ChangeSet,
    ChecklistError,
    Diagnosis,
    DifyBuilderContext,
    MutationIntent,
    Risk,
)


def context_to_dict(fc: DifyBuilderContext) -> dict[str, Any]:
    """Serialize a ``DifyBuilderContext`` to a JSON-safe dict.

    ``dataclasses.asdict`` recurses into the nested dataclasses
    (``Diagnosis``, ``MutationIntent``, ``Risk``, ``ChangeSet``,
    ``ChecklistError``), turning each into a plain dict; every field is a
    str/int/bool/list/dict/None -- so the result is JSON-safe as-is.
    """
    return asdict(fc)


def context_from_dict(d: dict[str, Any]) -> DifyBuilderContext:
    """Rebuild a ``DifyBuilderContext`` from a dict produced by ``context_to_dict``.

    Reconstructs the nested dataclasses explicitly (they are plain dicts
    after a JSON round-trip). Every lookup is defensive (``.get`` with a
    default matching the field default) so an older or partial dict still
    yields a valid ``DifyBuilderContext``.
    """
    diagnosis = Diagnosis(**d["diagnosis"]) if d.get("diagnosis") else None
    staged_repair = [MutationIntent(**m) for m in d.get("staged_repair", [])]
    risk = Risk(**d["risk"]) if d.get("risk") else None
    change_set = ChangeSet(**d["change_set"]) if d.get("change_set") else None
    checklist_errors = [ChecklistError(**e) for e in d.get("checklist_errors", [])]

    return DifyBuilderContext(
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
        goal_text=d.get("goal_text", ""),
        requirements=dict(d.get("requirements") or {}),
        plan_items=list(d.get("plan_items") or []),
        plan_version_tag=d.get("plan_version_tag", ""),
        resource_selection=dict(d.get("resource_selection") or {}),
        built_node_ids=list(d.get("built_node_ids") or []),
        edit_rules=dict(d.get("edit_rules") or {}),
        edit_target_node_ids=list(d.get("edit_target_node_ids") or []),
        paused=bool(d.get("paused", False)),
        checkpoint_seq=int(d.get("checkpoint_seq", 0)),
        last_structure_fingerprint=d.get("last_structure_fingerprint", ""),
        recovery_class=d.get("recovery_class", ""),
    )
