"""Malformed or legacy evidence cannot turn permissions into a content claim."""

import pytest

from services.external_agents.trace_capture import (
    CAPTURE_REASONS_ATTRIBUTE,
    CAPTURE_STATUS_ATTRIBUTE,
    CAPTURE_VERSION_ATTRIBUTE,
    read_capture_policy,
    stored_capture_decision,
)


@pytest.mark.parametrize(
    "attributes",
    [
        None,
        {},
        [],
        {CAPTURE_VERSION_ATTRIBUTE: 1, CAPTURE_STATUS_ATTRIBUTE: []},
        {CAPTURE_VERSION_ATTRIBUTE: 2, CAPTURE_STATUS_ATTRIBUTE: "content_included", CAPTURE_REASONS_ATTRIBUTE: []},
        {
            CAPTURE_VERSION_ATTRIBUTE: 1,
            CAPTURE_STATUS_ATTRIBUTE: "content_included",
            CAPTURE_REASONS_ATTRIBUTE: ["unknown"],
        },
        {CAPTURE_VERSION_ATTRIBUTE: 1, CAPTURE_STATUS_ATTRIBUTE: "metadata_only", CAPTURE_REASONS_ATTRIBUTE: []},
    ],
)
@pytest.mark.parametrize("allowed", [False, True])
def test_missing_invalid_evidence_preserves_legacy_unknown(attributes: object, allowed: bool) -> None:
    result = stored_capture_decision(capture_content=allowed, has_delivery=True, attributes=attributes)
    assert result.status == ("unknown" if allowed else "metadata_only")
    assert result.reasons == ("legacy_snapshot_unavailable",)


def test_marker_cannot_broaden_frozen_denied_permission() -> None:
    result = stored_capture_decision(
        capture_content=False,
        has_delivery=True,
        attributes={
            CAPTURE_VERSION_ATTRIBUTE: 1,
            CAPTURE_STATUS_ATTRIBUTE: "content_included",
            CAPTURE_REASONS_ATTRIBUTE: [],
        },
    )
    assert result.status == "metadata_only"
    assert result.reasons == ("legacy_snapshot_unavailable",)


@pytest.mark.parametrize(
    "value",
    [
        None,
        {},
        {"source_app_capture_content": True, "target_capture_content": True},
        {"version": 1, "source_app_capture_content": "false", "target_capture_content": True},
        {"version": 1, "source_app_capture_content": False, "target_capture_content": True, "unknown": True},
    ],
)
def test_policy_missing_version_or_ambiguous_gate_is_not_trusted(value: object) -> None:
    assert read_capture_policy(value) is None
