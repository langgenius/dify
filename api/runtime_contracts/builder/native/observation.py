"""Safe diagnostic failure shared by native observation consumers."""

import re
from dataclasses import dataclass
from typing import Literal, TypeIs

NativeModelFailureStage = Literal["invoke", "receipt_append", "result_store", "outcome_complete", "unknown_settlement"]
NativeModelFailureCategory = Literal[
    "quota_exceeded",
    "authentication",
    "bad_request",
    "rate_limit",
    "connection",
    "timeout",
    "service_unavailable",
    "invalid_response",
    "result_too_large",
    "internal_unknown",
]
_MODEL_STAGES = frozenset({"invoke", "receipt_append", "result_store", "outcome_complete", "unknown_settlement"})
_MODEL_CATEGORIES = frozenset(
    {
        "quota_exceeded",
        "authentication",
        "bad_request",
        "rate_limit",
        "connection",
        "timeout",
        "service_unavailable",
        "invalid_response",
        "result_too_large",
        "internal_unknown",
    }
)


def _is_model_failure_stage(value: str) -> TypeIs[NativeModelFailureStage]:
    """Narrow a diagnostic stage only when it belongs to the fixed allowlist."""
    return value in _MODEL_STAGES


def _is_model_failure_category(value: str) -> TypeIs[NativeModelFailureCategory]:
    """Narrow a diagnostic category only when it belongs to the fixed allowlist."""
    return value in _MODEL_CATEGORIES


@dataclass(frozen=True)
class NativeModelFailureDiagnostic:
    """Fixed post-claim facts only; never permission, model output or retry advice."""

    stage: NativeModelFailureStage
    category: NativeModelFailureCategory

    def __post_init__(self) -> None:
        if self.stage not in _MODEL_STAGES or self.category not in _MODEL_CATEGORIES:
            raise ValueError("invalid_native_model_failure_diagnostic")


def format_native_model_failure(diagnostic: NativeModelFailureDiagnostic) -> str:
    return f"Native Agent model invocation failed. [stage={diagnostic.stage}; reason={diagnostic.category}]"


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
    if not _is_model_failure_stage(stage) or not _is_model_failure_category(category):
        return None
    return NativeModelFailureDiagnostic(stage=stage, category=category)


class NativeObservationError(RuntimeError):
    """Only fixed safe diagnostics leave a failed observation adapter."""

    def __init__(self) -> None:
        super().__init__("native_observation_failed")
