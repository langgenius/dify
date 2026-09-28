"""Versioned, strict input contracts shared by inner API and migration workers."""

import hashlib
import json
from datetime import datetime
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

UUIDString = Annotated[str, Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
Digest = Annotated[str, Field(pattern=r"^sha256:[0-9a-f]{64}$")]
Reference = Annotated[str, Field(min_length=1, max_length=512)]
Revision = Annotated[int, Field(strict=True, ge=0, le=9007199254740991)]
Timestamp = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")]
Boundary = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}T00:00:00Z$")]


def canonical_hash(value: Any) -> str:
    """Hash the protocol's constrained canonical JSON (money is never a float)."""

    def check(item: Any) -> None:
        if isinstance(item, float) or item is None:
            raise ValueError("canonical payload cannot contain float or null")
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str) or not key.isascii():
                    raise ValueError("canonical object keys must be ASCII strings")
                check(child)
        elif isinstance(item, list):
            for child in item:
                check(child)

    check(value)
    return (
        "sha256:"
        + hashlib.sha256(
            json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
        ).hexdigest()
    )


class StrictPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    @model_validator(mode="before")
    @classmethod
    def reject_explicit_null(cls, value: Any) -> Any:
        if isinstance(value, dict) and any(item is None for item in value.values()):
            raise ValueError("optional fields must be omitted, not null")
        return value


class OperationPayload(StrictPayload):
    api_version: Literal[1]
    operation_id: UUIDString
    expected_revision: Revision


class MigrationSourceQuota(StrictPayload):
    unmetered: bool


class MigrationSourceProviderOwnership(StrictPayload):
    current_quota_type: Literal["paid", "trial", "free"]
    quotas: dict[Literal["paid", "trial", "free"], MigrationSourceQuota]


class PrepareMigrationPayload(OperationPayload):
    migration_id: UUIDString
    batch_id: Reference
    eligibility_policy_version: Reference
    model_mapping_version: Reference
    inventory_hash: Digest
    billing_preparation_ref: Reference


class WindowAlias(StrictPayload):
    kind: Literal["legacy_annual_target_date", "invoice_initial", "normal_slot", "reanchor_slot"]
    id: Reference


class MigrationWindow(StrictPayload):
    ordinal: Revision
    cycle_key: Reference
    window_id: Reference
    source_ref: Reference
    starts_at: Boundary
    ends_at: Boundary
    amount_usd_micro: Annotated[str, Field(pattern=r"^[1-9][0-9]*$")]
    aliases: Annotated[list[WindowAlias], Field(min_length=1, max_length=100)]

    @model_validator(mode="after")
    def valid_interval(self) -> Self:
        if datetime.fromisoformat(self.starts_at) >= datetime.fromisoformat(self.ends_at):
            raise ValueError("invalid_window")
        if self.aliases != sorted(self.aliases, key=lambda alias: (alias.kind, alias.id)):
            raise ValueError("aliases must be canonical ordered")
        return self


class WindowManifest(StrictPayload):
    schema_version: Literal[1]
    tenant_id: UUIDString
    migration_id: UUIDString
    plan_revision: Revision
    calendar_policy: Literal["STRIPE_UTC_V1", "LEGACY_TRANSITION_V1", "REANCHOR_V1"]
    contract_ref: Reference
    subscription_id: Reference
    paid_period_start: Timestamp
    paid_period_end: Timestamp
    funding_invoice_id: Reference
    amount_policy_version: Reference
    model_mapping_version: Reference
    windows: Annotated[list[MigrationWindow], Field(min_length=1, max_length=120)]

    @model_validator(mode="after")
    def valid_windows(self) -> Self:
        paid_start = datetime.fromisoformat(self.paid_period_start)
        paid_end = datetime.fromisoformat(self.paid_period_end)
        if paid_start >= paid_end:
            raise ValueError("invalid paid period")
        if self.windows != sorted(self.windows, key=lambda window: (window.starts_at, window.window_id)):
            raise ValueError("windows must be canonical ordered")
        for identity in ("window_id", "ordinal", "cycle_key"):
            if len({getattr(window, identity) for window in self.windows}) != len(self.windows):
                raise ValueError("duplicate window identity")
        for index, window in enumerate(self.windows):
            if datetime.fromisoformat(window.starts_at) < paid_start.replace(hour=0, minute=0, second=0):
                raise ValueError("window precedes paid start")
            if datetime.fromisoformat(window.ends_at) > paid_end.replace(hour=0, minute=0, second=0):
                raise ValueError("window exceeds paid end")
            if index and self.windows[index - 1].ends_at > window.starts_at:
                raise ValueError("overlapping windows")
        return self


class DecideCyclePayload(OperationPayload):
    cycle_key: Reference
    decision: Literal["legacy_deferred", "tokener"]
    contract_ref: Reference
    preparation_binding_hash: Digest
    billing_receipt_refs: list[Reference]
    manifest: WindowManifest | None = None
    manifest_hash: Digest | None = None

    @model_validator(mode="after")
    def decision_fields(self) -> Self:
        if self.decision == "tokener" and (self.manifest is None or self.manifest_hash is None):
            raise ValueError("tokener decision requires manifest and hash")
        if self.decision == "legacy_deferred" and (self.manifest is not None or self.manifest_hash is not None):
            raise ValueError("legacy decision cannot include a funding manifest")
        return self


class LeasePayload(OperationPayload):
    action: Literal["acquire", "renew", "release"]
    lease_token: UUIDString | None = None

    @model_validator(mode="after")
    def token_required(self) -> Self:
        if self.action != "acquire" and not self.lease_token:
            raise ValueError("lease token is required")
        return self


class CommandReceipt(StrictPayload):
    command_id: Reference
    payload_hash: Digest
    remote_id: Reference
    state: Literal[
        "registered", "dispatched", "accepted", "verified", "failed_definitive", "outcome_unknown", "superseded"
    ]


class FundingReceiptsPayload(OperationPayload):
    lease_token: UUIDString
    intent_revision: Revision
    manifest_hash: Digest
    commands: Annotated[list[CommandReceipt], Field(min_length=1, max_length=500)]


class MigrationCorrectionPayload(StrictPayload):
    """Frozen control command, not a balance or a local consumption projection."""

    command_id: Reference
    payload_hash: Digest
    window: MigrationWindow
    delta_usd_micro: Annotated[str, Field(pattern=r"^(0|-?[1-9][0-9]*)$")]
    target_amount_usd_micro: Annotated[str, Field(pattern=r"^(0|[1-9][0-9]*)$")]

    @model_validator(mode="after")
    def valid_hash(self) -> Self:
        data = self.model_dump(mode="json", exclude={"payload_hash"})
        if canonical_hash(data) != self.payload_hash:
            raise ValueError("correction payload hash mismatch")
        return self


class ContractEventPayload(OperationPayload):
    business_event_ref: Reference
    contract_ref: Reference
    billing_receipt_ref: Reference
    affected_window_ids: list[Reference]
    event_type: Literal["refund", "cancel", "reanchor", "plan_change", "paid_to_free"]
    terminal: bool = False
    manual_replan: bool = False
    replacement_manifest: WindowManifest | None = None
    replacement_manifest_hash: Digest | None = None
    command_payloads: Annotated[list[MigrationCorrectionPayload], Field(max_length=500)] = Field(default_factory=list)

    @model_validator(mode="after")
    def replacement_fields(self) -> Self:
        if (self.replacement_manifest is None) != (self.replacement_manifest_hash is None):
            raise ValueError("replacement manifest and hash must be supplied together")
        if self.terminal and self.replacement_manifest is not None:
            raise ValueError("terminal events cannot replace the funding plan")
        if self.manual_replan and (
            self.terminal or self.event_type != "plan_change" or self.replacement_manifest is None
        ):
            raise ValueError("manual replan requires a nonterminal plan_change replacement")
        if self.terminal and any(
            command.target_amount_usd_micro != "0" or int(command.delta_usd_micro) > 0
            for command in self.command_payloads
        ):
            raise ValueError("terminal events cannot grant or increase allowance")
        if self.affected_window_ids or self.command_payloads:
            if len({command.command_id for command in self.command_payloads}) != len(self.command_payloads):
                raise ValueError("duplicate correction command")
            if {command.window.window_id for command in self.command_payloads} != set(self.affected_window_ids):
                raise ValueError("correction commands must cover exactly the affected windows")
            if len({command.window.window_id for command in self.command_payloads}) != len(self.command_payloads):
                raise ValueError("only one frozen correction per affected window is allowed")
        return self


class ActivateMigrationPayload(OperationPayload):
    lease_token: UUIDString
    intent_revision: Revision
    manifest_hash: Digest
    funding_receipt_hash: Digest
    preparation_binding_hash: Digest
