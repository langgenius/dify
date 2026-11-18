"""Evaluation failures and the public representation of their diagnostics."""

import re
import uuid
from dataclasses import dataclass
from enum import StrEnum
from typing import overload


class EvaluationWorkflowVersionNotFoundError(Exception):
    """Raised when a workflow version pinned by an evaluation run no longer exists."""


class EvaluationErrorCode(StrEnum):
    """Stable categories permitted in evaluation results and API responses."""

    MODEL_REQUEST_FAILED = "EVAL_MODEL_REQUEST_FAILED"
    METRIC_FAILED = "EVAL_METRIC_FAILED"
    UNSUPPORTED_METRIC = "EVAL_UNSUPPORTED_METRIC"
    CUSTOM_EVALUATOR_FAILED = "EVAL_CUSTOM_EVALUATOR_FAILED"
    TARGET_FAILED = "EVAL_TARGET_FAILED"
    TARGET_DATA_MISSING = "EVAL_TARGET_DATA_MISSING"
    RETRIEVAL_FAILED = "EVAL_RETRIEVAL_FAILED"
    RUN_FAILED = "EVAL_RUN_FAILED"
    RUN_DISPATCH_FAILED = "EVAL_RUN_DISPATCH_FAILED"
    RUN_RETRYING = "EVAL_RUN_RETRYING"
    INVALID_CONFIG = "EVAL_INVALID_CONFIG"
    JUDGMENT_FAILED = "EVAL_JUDGMENT_FAILED"


_PUBLIC_MESSAGES = {
    EvaluationErrorCode.MODEL_REQUEST_FAILED: (
        "Evaluation model request failed. Check the model configuration and retry."
    ),
    EvaluationErrorCode.METRIC_FAILED: "Metric evaluation failed. Check the evaluation configuration and retry.",
    EvaluationErrorCode.UNSUPPORTED_METRIC: "The selected metric is not supported by this evaluator.",
    EvaluationErrorCode.CUSTOM_EVALUATOR_FAILED: "Custom evaluator failed. Check its workflow and retry.",
    EvaluationErrorCode.TARGET_FAILED: "Target execution failed. Check the target configuration and retry.",
    EvaluationErrorCode.TARGET_DATA_MISSING: "The target run did not provide data required for this metric.",
    EvaluationErrorCode.RETRIEVAL_FAILED: "Knowledge retrieval failed. Check the knowledge base and retry.",
    EvaluationErrorCode.RUN_FAILED: "Evaluation run failed. Please retry or contact support.",
    EvaluationErrorCode.RUN_DISPATCH_FAILED: "Could not start evaluation. Please retry or contact support.",
    EvaluationErrorCode.RUN_RETRYING: "Evaluation is retrying after a temporary failure.",
    EvaluationErrorCode.INVALID_CONFIG: "Evaluation configuration is invalid. Check it and retry.",
    EvaluationErrorCode.JUDGMENT_FAILED: "Evaluation judgment failed. Check its conditions and retry.",
}
_PUBLIC_ERROR_PATTERN = re.compile(r"(?P<code>EVAL_[A-Z_]+): .* \[error_id=(?P<error_id>[0-9a-f]{32})\]")
_LEGACY_ERROR_MESSAGE = "Evaluation failed. Please retry or contact support."
_SAFE_STATIC_ERRORS = frozenset(
    {
        "Agent evaluation row was already completed.",
        "Checkpointed Agent target result is missing.",
        "Checkpointed target workflow results are no longer available.",
        "Checkpointed target workflow run ID is missing.",
        "Evaluation run heartbeat lease expired.",
        "Metric 'tool_call_accuracy' requires non-empty expected_tool_calls.",
        "Missing evaluation result.",
        "No evaluation metrics were generated for this row.",
        "No evaluation result was generated for this row.",
        "Target execution produced no successful node results.",
        "Target execution produced no successful node results for this row.",
        "Target execution returned no workflow run ID.",
        "The customized evaluator app was deleted.",
    }
)


@dataclass(frozen=True, slots=True)
class PublicEvaluationError:
    """A fixed public message and its server-side diagnostic reference."""

    code: EvaluationErrorCode
    error_id: str

    @property
    def text(self) -> str:
        """Render an approved message and reference without exception data.

        Precondition: the code is a supported category and the reference is a UUID hex value.
        Postcondition: the result is canonical and safe for API and XLSX output.
        """
        return f"{self.code.value}: {_PUBLIC_MESSAGES[self.code]} [error_id={self.error_id}]"


def new_public_evaluation_error(code: EvaluationErrorCode) -> PublicEvaluationError:
    """Create a fresh diagnostic reference for an approved error category.

    Precondition: ``code`` is a member of ``EvaluationErrorCode``.
    Postcondition: the returned public text contains no exception data and the
    reference can be attached to the corresponding server-side log event.
    """
    return PublicEvaluationError(code=code, error_id=uuid.uuid4().hex)


@overload
def safe_evaluation_error_text(error: None) -> None: ...


@overload
def safe_evaluation_error_text(error: str) -> str: ...


def safe_evaluation_error_text(error: str | None) -> str | None:
    """Allow only canonical public errors through a result serialization boundary.

    Precondition: ``error`` is absent or an untrusted persisted/result string.
    Postcondition: unknown, legacy, or mixed raw errors become a fixed generic
    message; known public errors retain their original diagnostic references.
    """
    if error is None:
        return None

    parts = error.split("; ")
    for part in parts:
        if part not in _SAFE_STATIC_ERRORS:
            match = _PUBLIC_ERROR_PATTERN.fullmatch(part)
            if match is None:
                return _LEGACY_ERROR_MESSAGE
            try:
                code = EvaluationErrorCode(match.group("code"))
            except ValueError:
                return _LEGACY_ERROR_MESSAGE
            if part != PublicEvaluationError(code=code, error_id=match.group("error_id")).text:
                return _LEGACY_ERROR_MESSAGE
    return error
