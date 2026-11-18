"""Dify's finite remote-reported call-total profile, not an A2A standard or billing authority.

Only explicit gateway carrier provenance is admitted. A terminal Task (including
its correlated terminal status event) or a direct Agent Message can report one
final cumulative total. Working snapshots, arbitrary nested metadata and Trace
steps never establish call usage. Observations cannot submit business work.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from services.external_agents.protocol import GatewayReceipt
from services.external_agents.traceability import ReportedCallUsage

METADATA_USAGE_PROFILE = "dify.metadata-usage-total-tokens.v1"
_TERMINAL_TASK_STATES = frozenset(
    {"TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"}
)


class _MetadataUsage(BaseModel):
    """Validate the exact total and optional explicit call-scope declaration.

    Other JSON components are deliberately uninterpreted: they cannot establish
    a total or modify this profile's scope. No component totals are summed.
    """

    model_config = ConfigDict(strict=True, extra="ignore", populate_by_name=False)

    total_tokens: int = Field(alias="totalTokens", ge=0, le=2**63 - 1)
    scope: Literal["call", "invocation", "task", "message"] = "call"


class MetadataCallUsageProof:
    def prove(self, receipt: GatewayReceipt) -> tuple[ReportedCallUsage, int] | None:
        """Prove this profile's final remote-reported total, or leave usage unknown.

        Preconditions: the runtime admitted the gateway receipt's Task/context
        identity. Postconditions: only the current carrier's strict integer total
        becomes usage, including zero. A constant revision makes repeated final
        snapshots idempotent; changed final totals retain the repository's
        conflict protection. Missing, partial, non-call or ambiguous data returns
        no proof and cannot change the business outcome.
        """
        carrier = receipt.usage_carrier
        if carrier is None:
            return None
        if receipt.kind == "task":
            if receipt.state not in _TERMINAL_TASK_STATES or carrier.source not in {"task", "statusUpdate"}:
                return None
        elif carrier.source != "message" or receipt.payload.get("role") != "ROLE_AGENT":
            return None
        if not isinstance(carrier.value, dict) or "total_tokens" in carrier.value:
            return None
        try:
            usage = _MetadataUsage.model_validate(carrier.value)
        except ValidationError:
            return None
        if usage.scope not in {"call", "invocation", receipt.kind}:
            return None
        return (
            ReportedCallUsage(
                total_tokens=usage.total_tokens,
                # This path is relative to the validated wire carrier. Keep it
                # stable when a final SSE report is replayed by a full GetTask.
                source_path="metadata.usage.totalTokens",
                adapter=METADATA_USAGE_PROFILE,
            ),
            1,
        )
