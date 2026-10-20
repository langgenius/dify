"""Complete protected intents preserve exact occurrence identity."""

import pytest
from pydantic import ValidationError

from runtime_contracts.builder.native.contracts import EffectIntent, OperationKey
from runtime_contracts.builder.native.runtime_contracts import NativeCheckpointPayload, NodeJournalState


def effect():
    return EffectIntent(
        key=OperationKey(invocation_id="inv", occurrence_path=("node", "0"), cursor=0),
        kind="tool",
        resource_ref="mail.read",
        implementation_revision="v1",
        account_ref="account",
        target={"mailbox": "inbox"},
        parameters={"limit": True},
        input_digest="a" * 64,
        capability_digest="b" * 64,
    )


def journal():
    intent = effect()
    return {
        "invocation_id": "inv",
        "occurrence_path": ("node", "0"),
        "input_result_ref": "input-result",
        "input_digest": "a" * 64,
        "cursor": 0,
        "operation_keys": (intent.key,),
        "result_refs": (),
    }


def test_old_checkpoint_journal_reads_with_empty_intents():
    value = NodeJournalState(**journal())
    assert hasattr(value, "intents"), "journal lacks protected complete intent payload"
    assert value.intents == ()


def test_checkpoint_preserves_typed_frozen_intent_without_using_result_slot():
    value = NodeJournalState(**journal(), intents=(effect(),))
    restored = NodeJournalState.model_validate_json(value.model_dump_json())
    assert restored.intents == (effect(),)
    assert restored.intents[0].parameters["limit"] is True
    assert restored.result_refs == ()


@pytest.mark.parametrize("change", [{"invocation_id": "other"}, {"occurrence_path": ("other",)}, {"cursor": 1}])
def test_journal_refuses_foreign_or_unclaimed_intent_key(change):
    intent = effect().model_copy(update={"key": effect().key.model_copy(update=change)})
    with pytest.raises(ValidationError):
        NodeJournalState(**journal(), intents=(intent,))


def test_journal_refuses_duplicate_intents():
    with pytest.raises(ValidationError):
        NodeJournalState(**journal(), intents=(effect(), effect()))


def test_checkpoint_refuses_repeated_operation_identity_across_journals():
    value = NodeJournalState(**journal())
    with pytest.raises(ValidationError):
        NativeCheckpointPayload(
            schema_version="1",
            native_run_id="run",
            generation=0,
            generate_entity_json="{}",
            graph_runtime_state_json="{}",
            response_stream_filter_json="{}",
            node_journals=(value, value),
            child_refs=(),
            input_result_refs=(),
        )


def test_checkpoint_proposals_require_complete_matching_intent_and_unique_key():
    import importlib.util
    from datetime import UTC, datetime, timedelta

    name = "runtime_contracts.builder.native.approval_contracts"
    assert importlib.util.find_spec(name) is not None, "frozen approval proposal owner missing"
    m = __import__(name, fromlist=["NativeApprovalProposal"])
    intent = effect()
    proposal = m.NativeApprovalProposal(
        key=intent.key,
        terms=m.NativeApprovalTerms(
            max_calls=2,
            max_dispatches=2,
            max_cost_units=4,
            expires_at=(datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
        ),
    )
    values = {
        "schema_version": "1",
        "native_run_id": "run",
        "generation": 0,
        "generate_entity_json": "{}",
        "graph_runtime_state_json": "{}",
        "response_stream_filter_json": "{}",
        "child_refs": (),
        "input_result_refs": (),
    }
    with pytest.raises(ValidationError):
        NativeCheckpointPayload(
            **values, node_journals=(NodeJournalState(**journal()),), approval_proposals=(proposal,)
        )
    with pytest.raises(ValidationError):
        NativeCheckpointPayload(
            **values,
            node_journals=(NodeJournalState(**journal(), intents=(intent,)),),
            approval_proposals=(proposal, proposal),
        )
    payload = NativeCheckpointPayload(
        **values, node_journals=(NodeJournalState(**journal(), intents=(intent,)),), approval_proposals=(proposal,)
    )
    assert NativeCheckpointPayload.model_validate_json(payload.model_dump_json()).approval_proposals == (proposal,)
