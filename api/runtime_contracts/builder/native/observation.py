"""Safe diagnostic failure shared by native observation consumers."""

import re
from dataclasses import dataclass
from enum import StrEnum


class NativeModelFailureStage(StrEnum):
    INVOKE = "invoke"
    RECEIPT_APPEND = "receipt_append"
    RESULT_STORE = "result_store"
    OUTCOME_COMPLETE = "outcome_complete"
    UNKNOWN_SETTLEMENT = "unknown_settlement"


class NativeModelFailureCategory(StrEnum):
    QUOTA_EXCEEDED = "quota_exceeded"
    AUTHENTICATION = "authentication"
    BAD_REQUEST = "bad_request"
    RATE_LIMIT = "rate_limit"
    CONNECTION = "connection"
    TIMEOUT = "timeout"
    SERVICE_UNAVAILABLE = "service_unavailable"
    INVALID_RESPONSE = "invalid_response"
    RESULT_TOO_LARGE = "result_too_large"
    INTERNAL_UNKNOWN = "internal_unknown"


@dataclass(frozen=True)
class NativeModelFailureDiagnostic:
    """Fixed post-claim facts only; never permission, model output or retry advice."""

    stage: NativeModelFailureStage
    category: NativeModelFailureCategory

    def __post_init__(self) -> None:
        if self.stage not in NativeModelFailureStage or self.category not in NativeModelFailureCategory:
            raise ValueError("invalid_native_model_failure_diagnostic")


def parse_native_model_failure(error: str) -> NativeModelFailureDiagnostic | None:
    """Accept only the full fixed gateway error preserved by the existing SDK."""
    if len(error) > 256:
        return None
    match = re.fullmatch(
        r"NativeAgentModelDispatchFailed: Native Agent model invocation failed\. "
        r"\[stage=([a-z_]+); reason=([a-z_]+)\]",
        error,
    )
    if match is None:
        return None
    stage, category = match.groups()
    if stage not in NativeModelFailureStage or category not in NativeModelFailureCategory:
        return None
    return NativeModelFailureDiagnostic(
        stage=NativeModelFailureStage(stage), category=NativeModelFailureCategory(category)
    )
