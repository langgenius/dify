"""Presentation gates for the qualified JSON Parse safe-test variant."""

from runtime_contracts.builder.copy_ids import BuilderCopyId
from runtime_contracts.builder.execution import ExecutionEvidenceSummary
from runtime_contracts.builder.presentation import BuilderText, copy_text

JSON_FAILED_REASON = copy_text(BuilderCopyId.JSON_FAILED)


def json_execution_blocks_repair(summary: ExecutionEvidenceSummary, run_status: str) -> bool:
    """Only a completed, succeeded JSON run may enter ordinary output review."""
    return summary.policy_version == "builder-json-parse-v1" and (
        summary.safety_outcome != "restricted_execution_completed" or run_status != "succeeded"
    )


def json_failed_reason(summary: ExecutionEvidenceSummary | None, run_status: str) -> BuilderText | None:
    """Use fixed copy for a known native failure, never provider error text."""
    if (
        summary is not None
        and summary.policy_version == "builder-json-parse-v1"
        and summary.safety_outcome == "native_failed"
        and run_status == "failed"
    ):
        return JSON_FAILED_REASON
    return None
