"""Round-trip tests for the ``FixContext`` JSON (de)serializer.

``FixContext`` is the per-session working state persisted as the
``context`` JSONB column on ``workflow_copilot_session_commits`` (P3a Task 4).
This module verifies the pure (de)serializer is lossless and produces a
JSON-safe dict, independent of any database concern.
"""

import json

from core.workflow_copilot.models import (
    ChangeSet,
    ChecklistError,
    Diagnosis,
    FixContext,
    MutationIntent,
    Risk,
)
from services.workflow_copilot.serde import fix_context_from_dict, fix_context_to_dict


def _full_fix_context() -> FixContext:
    return FixContext(
        failed_run_id="TR-1",
        diagnosis=Diagnosis(
            culprit_node_id="n1",
            root_cause="TypeError in code node",
            severity="high",
        ),
        staged_repair=[
            MutationIntent(
                op="set_node_config",
                args={"node_id": "n1", "path": "code", "value": "return {}"},
            )
        ],
        risk=Risk(level="low", reason="config-only change", has_external_side_effect=False),
        change_set=ChangeSet(changed_nodes=["n1"], diff="- old\n+ new"),
        checkpoint_id="cp-1",
        verify_run_id="TR-2",
        test_input_ref="ti-1",
        last_snapshot_hash="abc123",
        next_seq=3,
        source="checklist",
        checklist_errors=[
            ChecklistError(
                node_id="n2",
                node_type="code",
                title="Code",
                messages=["missing required field"],
                unconnected=False,
                plugin_missing=False,
            )
        ],
    )


def test_fully_populated_fix_context_round_trips():
    fc = _full_fix_context()

    result = fix_context_from_dict(fix_context_to_dict(fc))

    assert result == fc


def test_empty_fix_context_round_trips():
    fc = FixContext()

    result = fix_context_from_dict(fix_context_to_dict(fc))

    assert result == fc


def test_to_dict_output_is_json_serializable():
    fc = _full_fix_context()

    d = fix_context_to_dict(fc)

    # Must not raise -- this is what actually lands in the JSONB column.
    json.dumps(d)


def test_from_dict_tolerates_missing_optional_keys():
    # An older/partial persisted dict -- only a subset of keys present.
    d = {"failed_run_id": "TR-9"}

    fc = fix_context_from_dict(d)

    assert fc == FixContext(failed_run_id="TR-9")
