"""Frozen capture evidence; current settings never explain a historical payload.

Permissions authorize projection, while payload markers describe its actual
result. Missing legacy evidence remains unknown, and status reads need only
these bounded, non-sensitive markers rather than retained request/response data.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from services.external_agents.observability import InvocationObservationOwner

CAPTURE_VERSION_ATTRIBUTE = "dify.external.capture.version"
CAPTURE_STATUS_ATTRIBUTE = "dify.external.capture.status"
CAPTURE_REASONS_ATTRIBUTE = "dify.external.capture.reasons"


class ExternalTraceCaptureStatus(StrEnum):
    UNKNOWN = "unknown"
    PENDING = "pending"
    CONTENT_INCLUDED = "content_included"
    METADATA_ONLY = "metadata_only"


class ExternalTraceCaptureReason(StrEnum):
    SOURCE_APP_DISABLED = "source_app_disabled"
    TARGET_CONTENT_DISABLED = "target_content_disabled"
    REDACTION_UNAVAILABLE = "redaction_unavailable"
    PAYLOAD_BUDGET_EXCEEDED = "payload_budget_exceeded"
    CONTENT_NOT_AVAILABLE = "content_not_available"
    LEGACY_SNAPSHOT_UNAVAILABLE = "legacy_snapshot_unavailable"


class ExternalTraceCapturePolicy(BaseModel):
    """Dispatch-frozen gates. A null source gate means there was no source App."""

    version: Literal[1]
    source_app_capture_content: bool | None
    target_capture_content: bool

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


@dataclass(frozen=True, slots=True)
class ExternalTraceCaptureDecision:
    status: ExternalTraceCaptureStatus
    reasons: tuple[ExternalTraceCaptureReason, ...]


@dataclass(frozen=True, slots=True)
class ExternalTraceTargetCapture:
    target_kind: str
    target_id: str
    provider: str
    config_revision: str
    capture_content: bool
    capture_policy: ExternalTraceCapturePolicy | None
    status: ExternalTraceCaptureStatus
    reasons: tuple[ExternalTraceCaptureReason, ...]
    delivery_state: str | None
    payload_revision: int | None


@dataclass(frozen=True, slots=True)
class ExternalTraceCaptureSnapshot:
    owner: InvocationObservationOwner
    targets_frozen: bool
    targets: tuple[ExternalTraceTargetCapture, ...]


@dataclass(frozen=True, slots=True)
class ExternalTraceCaptureResult:
    invocation_id: str
    targets_frozen: bool
    targets: tuple[ExternalTraceTargetCapture, ...]


def read_capture_policy(value: object) -> ExternalTraceCapturePolicy | None:
    """Validate persisted dispatch evidence without recovering it from current config.

    Preconditions: value is an untrusted persisted snapshot. Postconditions:
    only the explicit v1 boolean gates succeed; missing/invalid data returns None.
    """
    try:
        return ExternalTraceCapturePolicy.model_validate(value)
    except ValidationError:
        return None


def capture_policy_reasons(
    policy: ExternalTraceCapturePolicy | None,
) -> tuple[ExternalTraceCaptureReason, ...]:
    """Return only frozen gate restrictions; never consult current configuration.

    Preconditions: policy is validated or absent. Postconditions: only closed
    reason codes leave this function; absent evidence stays explicitly legacy.
    """
    if policy is None:
        return (ExternalTraceCaptureReason.LEGACY_SNAPSHOT_UNAVAILABLE,)
    return tuple(
        reason
        for denied, reason in (
            (policy.source_app_capture_content is False, ExternalTraceCaptureReason.SOURCE_APP_DISABLED),
            (not policy.target_capture_content, ExternalTraceCaptureReason.TARGET_CONTENT_DISABLED),
        )
        if denied
    )


def projected_capture_decision(
    *,
    capture_content: bool,
    policy: ExternalTraceCapturePolicy | None,
    redaction_available: bool,
    body_included: bool,
    budget_exceeded: bool,
) -> ExternalTraceCaptureDecision:
    """Describe the completed projector result, preserving false/zero/empty bodies.

    Preconditions: body_included tests projected values with ``is not None``.
    Postconditions: policy/credential suppression cannot claim included content;
    absent content does not claim that the remote service failed to report it.
    """
    if not capture_content:
        return ExternalTraceCaptureDecision(ExternalTraceCaptureStatus.METADATA_ONLY, capture_policy_reasons(policy))
    if not redaction_available:
        return ExternalTraceCaptureDecision(
            ExternalTraceCaptureStatus.METADATA_ONLY, (ExternalTraceCaptureReason.REDACTION_UNAVAILABLE,)
        )
    if body_included:
        return ExternalTraceCaptureDecision(ExternalTraceCaptureStatus.CONTENT_INCLUDED, ())
    if budget_exceeded:
        return ExternalTraceCaptureDecision(
            ExternalTraceCaptureStatus.METADATA_ONLY, (ExternalTraceCaptureReason.PAYLOAD_BUDGET_EXCEEDED,)
        )
    return ExternalTraceCaptureDecision(
        ExternalTraceCaptureStatus.METADATA_ONLY, (ExternalTraceCaptureReason.CONTENT_NOT_AVAILABLE,)
    )


def capture_decision_attributes(decision: ExternalTraceCaptureDecision) -> Mapping[str, Any]:
    """Encode bounded non-secret evidence for one immutable canonical payload.

    Preconditions: the projector completed its decision. Postconditions: the
    returned marker contains only its version, closed status and closed reasons.
    """
    return {
        CAPTURE_VERSION_ATTRIBUTE: 1,
        CAPTURE_STATUS_ATTRIBUTE: decision.status.value,
        CAPTURE_REASONS_ATTRIBUTE: [reason.value for reason in decision.reasons],
    }


def stored_capture_decision(
    *, capture_content: bool, has_delivery: bool, attributes: object
) -> ExternalTraceCaptureDecision:
    """Read only frozen markers, failing closed for absent/malformed legacy evidence.

    No payload marker means unknown when permission allowed content. A frozen
    false permission proves metadata-only but cannot identify either old gate.
    Preconditions: attributes were selected from the frozen canonical root.
    Postconditions: absent/malformed markers cannot claim content inclusion or
    invent historical gate reasons, and a missing delivery remains pending.
    """
    if not has_delivery:
        return ExternalTraceCaptureDecision(ExternalTraceCaptureStatus.PENDING, ())
    if (
        isinstance(attributes, dict)
        and type(attributes.get(CAPTURE_VERSION_ATTRIBUTE)) is int
        and attributes.get(CAPTURE_VERSION_ATTRIBUTE) == 1
    ):
        status, reasons = attributes.get(CAPTURE_STATUS_ATTRIBUTE), attributes.get(CAPTURE_REASONS_ATTRIBUTE)
        if isinstance(status, str) and status in {
            ExternalTraceCaptureStatus.CONTENT_INCLUDED,
            ExternalTraceCaptureStatus.METADATA_ONLY,
        }:
            if (
                isinstance(reasons, list)
                and all(isinstance(reason, str) and reason in ExternalTraceCaptureReason for reason in reasons)
                and (
                    status == ExternalTraceCaptureStatus.CONTENT_INCLUDED
                    and capture_content
                    and not reasons
                    or status == ExternalTraceCaptureStatus.METADATA_ONLY
                    and bool(reasons)
                )
            ):
                return ExternalTraceCaptureDecision(
                    ExternalTraceCaptureStatus(status), tuple(ExternalTraceCaptureReason(reason) for reason in reasons)
                )
    return ExternalTraceCaptureDecision(
        ExternalTraceCaptureStatus.UNKNOWN if capture_content else ExternalTraceCaptureStatus.METADATA_ONLY,
        (ExternalTraceCaptureReason.LEGACY_SNAPSHOT_UNAVAILABLE,),
    )
