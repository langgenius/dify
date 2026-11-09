import pytest
from pydantic import ValidationError

from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, KnowledgeFSProductPermission
from services.knowledge_fs.tidy_dto import KnowledgeFSTidyActionPayload, KnowledgeFSTidySettingsPayload


def test_conflict_detection_requires_cost_acknowledgment_but_text_only_and_disabling_do_not() -> None:
    with pytest.raises(ValidationError, match="token usage"):
        KnowledgeFSTidySettingsPayload(enabled=True, expectedRevision=0)
    with pytest.raises(ValidationError, match="token usage"):
        KnowledgeFSTidySettingsPayload(enabled=True, conflicts=True, expectedRevision=0)
    assert KnowledgeFSTidySettingsPayload(enabled=True, conflicts=False, expectedRevision=0).conflicts is False
    assert not KnowledgeFSTidySettingsPayload(enabled=False, expectedRevision=1).enabled
    with pytest.raises(ValidationError, match="Extra inputs"):
        KnowledgeFSTidySettingsPayload.model_validate(
            {"enabled": True, "expectedRevision": 0, "acknowledgeTokenUsage": True, "tokenLimit": 1000}
        )


def test_document_action_requires_an_explicit_side_and_revision() -> None:
    with pytest.raises(ValidationError, match="document to disable"):
        KnowledgeFSTidyActionPayload(action="disable_document", expectedRevision=1)
    with pytest.raises(ValidationError):
        KnowledgeFSTidyActionPayload.model_validate({"action": "undo", "expectedRevision": 0})
    assert KnowledgeFSTidyActionPayload(action="undo", expectedRevision=2).documentId is None


@pytest.mark.parametrize("operation", ["updateTidySettings", "retryTidyScans", "actOnTidyFinding"])
def test_tidy_mutations_require_space_edit_permission(operation: str) -> None:
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation].permission == KnowledgeFSProductPermission.EDIT


@pytest.mark.parametrize("operation", ["getTidySettings", "getTidySummary", "listTidyScans", "listTidyFindings"])
def test_tidy_evidence_requires_space_read_permission(operation: str) -> None:
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation].permission == KnowledgeFSProductPermission.READ
