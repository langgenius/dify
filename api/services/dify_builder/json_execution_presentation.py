"""Presentation gates for the qualified JSON Parse safe-test variant."""

from services.dify_builder.execution_contracts import ExecutionEvidenceSummary

JSON_FAILED_REASON = (
    "The JSON Parse test failed. Review the native run and edit the draft before testing again. "
    "Automatic repair and publication are blocked."
)


def json_execution_blocks_repair(summary: ExecutionEvidenceSummary, run_status: str) -> bool:
    """Only a completed, succeeded JSON run may enter ordinary output review."""
    return summary.policy_version == "builder-json-parse-v1" and (
        summary.safety_outcome != "restricted_execution_completed" or run_status != "succeeded"
    )


def json_failed_reason(summary: ExecutionEvidenceSummary | None, run_status: str) -> str | None:
    """Use fixed copy for a known native failure, never provider error text."""
    if (
        summary is not None
        and summary.policy_version == "builder-json-parse-v1"
        and summary.safety_outcome == "native_failed"
        and run_status == "failed"
    ):
        return JSON_FAILED_REASON
    return None
