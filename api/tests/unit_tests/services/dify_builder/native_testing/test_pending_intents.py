"""Complete protected intents preserve exact occurrence identity."""

import pytest
from pydantic import ValidationError

from services.dify_builder.native_testing.contracts import EffectIntent, OperationKey
from services.dify_builder.native_testing.runtime_contracts import NativeCheckpointPayload, NodeJournalState


def effect():
    return EffectIntent(key=OperationKey(invocation_id="inv", occurrence_path=("node", "0"), cursor=0),
                        kind="tool", resource_ref="mail.read", implementation_revision="v1", account_ref="account",
                        target={"mailbox": "inbox"}, parameters={"limit": True}, input_digest="a" * 64,
                        capability_digest="b" * 64)


def journal():
    intent = effect()
    return dict(invocation_id="inv", occurrence_path=("node", "0"), input_result_ref="input-result",
                input_digest="a" * 64, cursor=0, operation_keys=(intent.key,), result_refs=())


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
        NativeCheckpointPayload(schema_version="1", native_run_id="run", generation=0,
                                generate_entity_json="{}", graph_runtime_state_json="{}",
                                response_stream_filter_json="{}", node_journals=(value, value),
                                child_refs=(), input_result_refs=())
