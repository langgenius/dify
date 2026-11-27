import json

import pytest
from pydantic import ValidationError

from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, KnowledgeFSProductPermission
from services.knowledge_fs.tidy_dto import (
    KnowledgeFSTidyActionPayload,
    KnowledgeFSTidyFindingListResponse,
    KnowledgeFSTidyFindingQuery,
    KnowledgeFSTidyFindingResponse,
    KnowledgeFSTidyFurtherAction,
    KnowledgeFSTidyScanQuery,
    KnowledgeFSTidySettingsPayload,
    KnowledgeFSTidySettingsResponse,
    TidyActionName,
    TidyFindingKind,
    TidyFindingStatus,
    TidyFurtherActionName,
    TidyScanState,
    TidySettingsError,
)


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
    stale: dict[str, object] = {"action": "undo", "expectedRevision": 0}
    with pytest.raises(ValidationError):
        KnowledgeFSTidyActionPayload.model_validate(stale)
    assert KnowledgeFSTidyActionPayload(action="undo", expectedRevision=2).documentId is None


def test_adopting_a_side_requires_the_kept_document_and_the_new_wording() -> None:
    with pytest.raises(ValidationError, match="new wording"):
        KnowledgeFSTidyActionPayload(action="adopt", expectedRevision=1, documentId="doc")
    with pytest.raises(ValidationError, match="new wording"):
        KnowledgeFSTidyActionPayload(action="adopt", expectedRevision=1, documentId="doc", replacement="  ")
    with pytest.raises(ValidationError, match="new wording"):
        KnowledgeFSTidyActionPayload(action="adopt", expectedRevision=1, replacement="30 days")
    with pytest.raises(ValidationError, match="rewrites a passage"):
        KnowledgeFSTidyActionPayload(action="review", expectedRevision=1, replacement="30 days")
    payload = KnowledgeFSTidyActionPayload(action="adopt", expectedRevision=1, documentId="doc", replacement="30 days")
    assert payload.model_dump(exclude_none=True) == {
        "expectedRevision": 1,
        "action": "adopt",
        "documentId": "doc",
        "replacement": "30 days",
    }


@pytest.mark.parametrize("operation", ["updateTidySettings", "retryTidyScans", "actOnTidyFinding"])
def test_tidy_mutations_require_space_edit_permission(operation: str) -> None:
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation].permission == KnowledgeFSProductPermission.EDIT


@pytest.mark.parametrize("operation", ["getTidySettings", "getTidySummary", "listTidyScans", "listTidyFindings"])
def test_tidy_evidence_requires_space_read_permission(operation: str) -> None:
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation].permission == KnowledgeFSProductPermission.READ


def test_finding_pages_carry_document_cards_and_tolerate_older_knowledge_fs() -> None:
    card = {
        "title": "Handbook",
        "mimeType": "text/html",
        "sizeBytes": 2048,
        "publishedAt": "2026-08-01T00:00:00.000Z",
        "enabled": False,
    }
    page = KnowledgeFSTidyFindingListResponse.model_validate(
        {"items": [], "nextCursor": None, "documents": {"doc-1": card}}
    )
    assert page.documents["doc-1"].model_dump() == card
    older = KnowledgeFSTidyFindingListResponse.model_validate({"items": [], "nextCursor": None})
    assert older.documents == {}


def test_further_actions_settle_other_findings_but_never_undo_or_adopt() -> None:
    further: dict[str, object] = {
        "findingId": "e" * 64,
        "expectedRevision": 1,
        "action": "disable_document",
        "documentId": "doc",
    }
    payload = KnowledgeFSTidyActionPayload.model_validate(
        {"action": "review", "expectedRevision": 1, "also": [further]}
    )
    assert payload.model_dump(exclude_none=True)["also"] == [further]
    for invalid in (
        {**further, "documentId": None},
        {**further, "action": "undo"},
        {**further, "findingId": "not-a-finding"},
    ):
        with pytest.raises(ValidationError):
            KnowledgeFSTidyActionPayload.model_validate({"action": "review", "expectedRevision": 1, "also": [invalid]})
    for single in (
        {"action": "undo"},
        {"action": "adopt", "documentId": "doc", "replacement": "x"},
    ):
        with pytest.raises(ValidationError, match="one finding at a time"):
            KnowledgeFSTidyActionPayload.model_validate({**single, "expectedRevision": 1, "also": [further]})
    with pytest.raises(ValidationError):
        KnowledgeFSTidyActionPayload.model_validate({"action": "review", "expectedRevision": 1, "also": []})


def test_list_queries_refuse_unknown_keys_and_cursors_knowledge_fs_would_refuse() -> None:
    """The scan cursor is the UUID KnowledgeFS accepts (`format: uuid`); the finding cursor a 64-hex id."""
    scan_cursor = "0193a5b0-7c1e-7d3a-8f4e-2b6c9d1e0f3a"
    assert KnowledgeFSTidyScanQuery.model_validate({"cursor": scan_cursor, "state": "failed"}).cursor == scan_cursor
    assert KnowledgeFSTidyScanQuery.model_validate({"cursor": scan_cursor.upper()}).cursor == scan_cursor.upper()
    assert KnowledgeFSTidyScanQuery.model_validate({}).model_dump(exclude_none=True) == {}
    for cursor in ("", "abc", "e" * 64, scan_cursor + "0", scan_cursor.replace("-", ""), f" {scan_cursor}", "x" * 5000):
        with pytest.raises(ValidationError):
            KnowledgeFSTidyScanQuery.model_validate({"cursor": cursor})
    assert KnowledgeFSTidyFindingQuery.model_validate({"cursor": "e" * 64, "status": "open"}).cursor == "e" * 64
    for model, extra in (
        (KnowledgeFSTidyScanQuery, {"limit": "50"}),
        (KnowledgeFSTidyScanQuery, {"status": "open"}),
        (KnowledgeFSTidyFindingQuery, {"limit": "50"}),
        (KnowledgeFSTidyFindingQuery, {"state": "failed"}),
    ):
        with pytest.raises(ValidationError, match="Extra inputs"):
            model.model_validate(extra)
    scan_schema = KnowledgeFSTidyScanQuery.model_json_schema()
    assert scan_schema["additionalProperties"] is False
    assert KnowledgeFSTidyFindingQuery.model_json_schema()["additionalProperties"] is False
    assert scan_schema["properties"]["cursor"]["anyOf"][0]["maxLength"] == 36


def test_the_enumerated_values_stay_plain_strings_on_the_wire_and_in_the_schema() -> None:
    query = KnowledgeFSTidyFindingQuery.model_validate({"status": "open", "kind": "conflict"})
    assert (query.status, query.kind) == (TidyFindingStatus.OPEN, TidyFindingKind.CONFLICT)
    # What the facade sends KnowledgeFS as query parameters and as a JSON body.
    assert [(key, str(value)) for key, value in query.model_dump(exclude_none=True).items()] == [
        ("status", "open"),
        ("kind", "conflict"),
    ]
    payload = KnowledgeFSTidyActionPayload.model_validate(
        {
            "expectedRevision": 1,
            "action": "disable_document",
            "documentId": "doc-a",
            "also": [{"findingId": "f" * 64, "expectedRevision": 2, "action": "review"}],
        }
    )
    assert json.dumps(payload.model_dump(mode="json", exclude_none=True), sort_keys=True) == json.dumps(
        {
            "action": "disable_document",
            "also": [{"action": "review", "expectedRevision": 2, "findingId": "f" * 64}],
            "documentId": "doc-a",
            "expectedRevision": 1,
        },
        sort_keys=True,
    )
    settings = KnowledgeFSTidySettingsResponse.model_validate(
        {"enabled": True, "conflicts": False, "revision": 1, "lastError": "model_unavailable", "updatedAt": "now"}
    )
    assert settings.model_dump(mode="json")["lastError"] == "model_unavailable"

    # The generated contract lists exactly these strings, each set under its own name.
    assert KnowledgeFSTidyFindingResponse.model_json_schema()["$defs"]["TidyFindingStatus"]["enum"] == [
        "open",
        "dismissed",
        "reviewed",
        "disabled",
        "outdated",
    ]
    assert [kind.value for kind in TidyFindingKind] == ["duplicate", "similar", "conflict"]
    assert [state.value for state in TidyScanState] == ["pending", "scanning", "complete", "failed"]
    assert [error.value for error in TidySettingsError] == ["scan_failed", "authorization_failed", "model_unavailable"]
    assert [name.value for name in TidyActionName] == ["dismiss", "review", "disable_document", "undo", "adopt"]
    # A further action is one of the first three: it can never undo or adopt.
    assert [name.value for name in TidyFurtherActionName] == ["dismiss", "review", "disable_document"]
    for unknown in ("undo", "adopt", "DISMISS"):
        with pytest.raises(ValidationError):
            KnowledgeFSTidyFurtherAction.model_validate(
                {"findingId": "f" * 64, "expectedRevision": 2, "action": unknown}
            )
