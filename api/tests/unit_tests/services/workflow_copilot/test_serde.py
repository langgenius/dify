"""Round-trip tests for the ``CopilotContext`` JSON (de)serializer.

``CopilotContext`` is the per-session working state persisted as the
``context`` JSONB column on ``workflow_copilot_session_commits`` (P3a Task 4).
This module verifies the pure (de)serializer is lossless and produces a
JSON-safe dict, independent of any database concern.
"""

import json

from core.workflow_copilot.models import (
    ChangeSet,
    ChecklistError,
    CopilotContext,
    Diagnosis,
    MutationIntent,
    Risk,
)
from services.workflow_copilot.serde import context_from_dict, context_to_dict


def _full_fix_context() -> CopilotContext:
    return CopilotContext(
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

    result = context_from_dict(context_to_dict(fc))

    assert result == fc


def test_empty_fix_context_round_trips():
    fc = CopilotContext()

    result = context_from_dict(context_to_dict(fc))

    assert result == fc


def test_to_dict_output_is_json_serializable():
    fc = _full_fix_context()

    d = context_to_dict(fc)

    # Must not raise -- this is what actually lands in the JSONB column.
    json.dumps(d)


def test_from_dict_tolerates_missing_optional_keys():
    # An older/partial persisted dict -- only a subset of keys present.
    d = {"failed_run_id": "TR-9"}

    fc = context_from_dict(d)

    assert fc == CopilotContext(failed_run_id="TR-9")


def test_context_round_trips_build_fields():
    from core.workflow_copilot.models import CopilotContext
    from services.workflow_copilot.serde import context_from_dict, context_to_dict

    fc = CopilotContext(
        goal_text="Build a quarterly report workflow",
        requirements={"currency": "USD", "prefer_audited": True},
        plan_items=["Retrieve", "Summarize", "Emit"],
        plan_version_tag="v2",
        resource_selection={"resource_ids": ["kb-company"], "conflict_policy": "audited"},
        built_node_ids=["start", "llm", "end"],
    )
    out = context_from_dict(context_to_dict(fc))
    assert out == fc


def test_context_from_dict_defaults_build_fields_when_absent():
    from core.workflow_copilot.models import CopilotContext
    from services.workflow_copilot.serde import context_from_dict

    fc = context_from_dict({"failed_run_id": "TR-9"})
    assert fc == CopilotContext(failed_run_id="TR-9")
    assert fc.goal_text == ""
    assert fc.requirements == {}
    assert fc.plan_items == []


def test_context_roundtrip_preserves_edit_fields():
    from core.workflow_copilot.models import CopilotContext
    from services.workflow_copilot.serde import context_from_dict, context_to_dict

    fc = CopilotContext(
        edit_rules={"risk_threshold": "high", "preserve_summary": True},
        edit_target_node_ids=["llm", "knowledge_retrieval"],
    )
    out = context_from_dict(context_to_dict(fc))
    assert out.edit_rules == {"risk_threshold": "high", "preserve_summary": True}
    assert out.edit_target_node_ids == ["llm", "knowledge_retrieval"]


def test_context_from_dict_defaults_edit_fields_when_absent():
    from services.workflow_copilot.serde import context_from_dict

    out = context_from_dict({})  # an older row with no edit_* keys
    assert out.edit_rules == {}
    assert out.edit_target_node_ids == []


def test_context_roundtrip_preserves_lifecycle_fields():
    from core.workflow_copilot.models import CopilotContext
    from services.workflow_copilot.serde import context_from_dict, context_to_dict

    fc = CopilotContext(paused=True, checkpoint_seq=7)
    out = context_from_dict(context_to_dict(fc))
    assert out.paused is True
    assert out.checkpoint_seq == 7


def test_context_from_dict_defaults_lifecycle_fields_when_absent():
    from services.workflow_copilot.serde import context_from_dict

    out = context_from_dict({})  # an older row with no paused/checkpoint_seq keys
    assert out.paused is False
    assert out.checkpoint_seq == 0
