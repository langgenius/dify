"""Core's sole authority for hosted-credit migration decisions and admission.

All writes lock one tenant-owned row and commit before external work. Operation
replay precedes CAS, a cycle decision never flips, and funds are represented only
by remote receipts. Network operations belong to Billing/the preparation task.
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from operator import itemgetter
from typing import Any
from uuid import uuid4

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from configs import dify_config
from core.db.session_factory import session_factory
from core.model_billing_migration_protocol import canonical_hash
from core.model_billing_profile import ModelBillingProfileService
from core.repositories.model_billing_migration_repository import get_routing_state
from libs.datetime_utils import naive_utc_now
from models.account import Tenant
from models.model_billing import TenantModelBillingProfile
from models.model_billing_migration import TenantModelBillingMigration
from models.provider import Provider, ProviderCredential, ProviderType
from models.tokener import TenantTokenerIntegration, TenantTokenerIntegrationStatus
from services.entities.model_billing_migration import (
    ActivateMigrationPayload,
    ContractEventPayload,
    DecideCyclePayload,
    FundingReceiptsPayload,
    LeasePayload,
    MigrationSourceProviderOwnership,
    OperationPayload,
    PrepareMigrationPayload,
)

logger = logging.getLogger(__name__)
PROCESSING_PHASES = frozenset({"claimed", "granting", "activating"})
UNSETTLED_COMMANDS = frozenset({"registered", "dispatched", "accepted", "outcome_unknown"})


class MigrationError(RuntimeError):
    """Stable secret-free error translated only at the HTTP boundary."""

    def __init__(self, code: str, status: int = 409, *, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.status = status
        self.retryable = retryable


def _timestamp(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat() + "Z"


def _attention(row: TenantModelBillingMigration, now: datetime) -> str:
    if row.claimed_at is None or row.phase == "active" or row.state.get("ever_activated"):
        return "normal"
    elapsed = (now - row.claimed_at).total_seconds()
    if elapsed > 1800:
        return "manual_required"
    return "alerted" if elapsed > 300 else "normal"


class ModelBillingMigrationService:
    @staticmethod
    def admitted(tenant_id: str) -> bool:
        return dify_config.TOKENER_LEGACY_MIGRATION_ENABLED and tenant_id in {
            tenant.strip() for tenant in dify_config.TOKENER_LEGACY_MIGRATION_ALLOWLIST.split(",") if tenant.strip()
        }

    @staticmethod
    def _row(session: Session, tenant_id: str, migration_id: str | None = None) -> TenantModelBillingMigration:
        row = session.scalar(
            select(TenantModelBillingMigration)
            .where(TenantModelBillingMigration.tenant_id == tenant_id)
            .with_for_update()
        )
        if row is None:
            raise MigrationError("migration_not_found", 404)
        if migration_id is not None and row.migration_id != migration_id:
            raise MigrationError("migration_not_found", 404)
        return row

    @staticmethod
    def _status(row: TenantModelBillingMigration, *, replayed: bool = False) -> dict[str, Any]:
        state = row.state
        result: dict[str, Any] = {
            "api_version": 1,
            "tenant_id": row.tenant_id,
            "migration_id": row.migration_id,
            "phase": row.phase,
            "attention": _attention(row, naive_utc_now()),
            "revision": row.revision,
            "route_epoch": row.route_epoch,
            "replayed": replayed,
            "ever_activated": bool(state.get("ever_activated", False)),
            "model_mapping_version": state["model_mapping_version"],
            "inventory_hash": state["inventory_hash"],
            "billing_receipt_refs": state.get("billing_receipt_refs", []),
            "commands": list(state.get("commands", {}).values()),
            "cycle_decisions": list(state.get("cycle_decisions", {}).values()),
            "contract_events": state.get("contract_events", {}),
            "prior_manifests": state.get("prior_manifests", []),
            "terminated_contract_refs": state.get("terminated_contract_refs", []),
            "operation_results": [
                {key: value for key, value in operation.items() if key != "response"}
                for operation in state.get("operations", {}).values()
            ],
        }
        for key in (
            "intent_revision",
            "manifest",
            "manifest_hash",
            "preparation_binding_hash",
            "blocked_from",
            "last_error_code",
            "funding_receipt_hash",
            "pending_contract_event",
        ):
            if key in state:
                result[key] = state[key]
        if row.claimed_at is not None:
            result["claimed_at"] = _timestamp(row.claimed_at)
        if row.lease_token is not None and row.lease_expires_at is not None:
            result.update(lease_token=row.lease_token, lease_expires_at=_timestamp(row.lease_expires_at))
        return result

    @classmethod
    def status(cls, tenant_id: str, operation_id: str | None = None) -> dict[str, Any]:
        with session_factory.create_session() as session:
            row = session.get(TenantModelBillingMigration, tenant_id)
            if row is None:
                raise MigrationError("migration_not_found", 404)
            result = cls._status(row)
            if operation_id is not None:
                operation = row.state.get("operations", {}).get(operation_id)
                if operation is None:
                    raise MigrationError("operation_not_found", 404)
                result["operation_results"] = [{key: value for key, value in operation.items() if key != "response"}]
            return result

    @classmethod
    def get_routing_state(cls, tenant_id: str) -> dict[str, Any] | None:
        """Delegate the shared runtime projection without loading control state."""
        return get_routing_state(tenant_id)

    @classmethod
    def _replay(cls, row: TenantModelBillingMigration, payload: OperationPayload) -> dict[str, Any] | None:
        request_hash = canonical_hash(payload.model_dump(mode="json", exclude_none=True))
        prior = row.state.get("operations", {}).get(payload.operation_id)
        if prior is None:
            return None
        if prior["request_hash"] != request_hash:
            raise MigrationError("idempotency_conflict")
        # The status is explicitly current; the immutable receipt preserves the
        # original operation outcome. Never misrepresent a successor's lease as
        # the replayed acquire/renew result: clients must inspect the original
        # token in replayed_operation before using the current lease.
        result = cls._status(row, replayed=True)
        original = {key: copy.deepcopy(value) for key, value in prior.items() if key != "response"}
        legacy_response = prior.get("response", {})
        for key in ("lease_token", "lease_expires_at"):
            if key not in original and key in legacy_response:
                original[key] = legacy_response[key]
        result["replayed_operation"] = original
        return result

    @classmethod
    def _record(cls, row: TenantModelBillingMigration, payload: OperationPayload) -> dict[str, Any]:
        summary: dict[str, Any] = {"phase": row.phase, "route_epoch": row.route_epoch}
        for key in ("manifest_hash", "intent_revision"):
            if key in row.state:
                summary[key] = row.state[key]
        if isinstance(payload, DecideCyclePayload):
            summary.update(decision=payload.decision, cycle_key=payload.cycle_key)
        operation = {
            "operation_id": payload.operation_id,
            "request_hash": canonical_hash(payload.model_dump(mode="json", exclude_none=True)),
            "result_code": 202 if row.phase == "preparing" else 200,
            "result_revision": row.revision,
            "result_summary": summary,
        }
        if isinstance(payload, LeasePayload):
            operation["lease_action"] = payload.action
            if row.lease_token is not None and row.lease_expires_at is not None:
                operation["lease_token"] = row.lease_token
                operation["lease_expires_at"] = _timestamp(row.lease_expires_at)
        row.state.setdefault("operations", {})[payload.operation_id] = operation
        flag_modified(row, "state")
        return cls._status(row)

    @classmethod
    def prepare(cls, tenant_id: str, payload: PrepareMigrationPayload) -> dict[str, Any]:
        with session_factory.create_session() as session, session.begin():
            # Lock the existing tenant first, serializing the absent-row case.
            tenant = session.scalar(select(Tenant).where(Tenant.id == tenant_id).with_for_update())
            if tenant is None:
                raise MigrationError("tenant_not_found", 404)
            row = session.get(TenantModelBillingMigration, tenant_id)
            if row is not None:
                if row.migration_id != payload.migration_id:
                    raise MigrationError("migration_conflict")
                replay = cls._replay(row, payload)
                if replay is not None:
                    return replay
                raise MigrationError("migration_conflict")
            if not cls.admitted(tenant_id):
                raise MigrationError("migration_not_admitted", 403)
            if payload.expected_revision != 0:
                raise MigrationError("revision_conflict")
            profile = session.get(TenantModelBillingProfile, tenant_id)
            if profile is not None and profile.model_billing_source is not None:
                raise MigrationError("ineligible_contract", 422)
            row = TenantModelBillingMigration(
                tenant_id=tenant_id,
                migration_id=payload.migration_id,
                batch_id=payload.batch_id,
                revision=1,
                state=payload.model_dump(mode="json", exclude={"operation_id", "expected_revision"}),
            )
            session.add(row)
            if (
                session.scalar(select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == tenant_id))
                is None
            ):
                session.add(
                    TenantTokenerIntegration(
                        tenant_id=tenant_id,
                        plugin_unique_identifier=dify_config.TOKENER_PLUGIN_UNIQUE_IDENTIFIER.strip() or None,
                    )
                )
            result = cls._record(row, payload)
        cls.enqueue_prepare(tenant_id, payload.migration_id)
        return result

    @staticmethod
    def enqueue_prepare(tenant_id: str, migration_id: str) -> None:
        from tasks.prepare_tokener_migration_task import prepare_tokener_migration_task

        try:
            prepare_tokener_migration_task.delay(tenant_id, migration_id)
        except Exception:
            # Metadata is committed; recovery sweep, not a changed operation ID,
            # repairs broker failures.
            logger.error(  # noqa: TRY400 - secret-adjacent broker details must not enter traces
                "Migration prepare enqueue failed tenant=%s migration=%s", tenant_id, migration_id
            )

    @classmethod
    def _mutate(
        cls,
        tenant_id: str,
        migration_id: str,
        payload: OperationPayload,
        action: Callable[[Session, TenantModelBillingMigration, datetime], None],
    ) -> dict[str, Any]:
        with session_factory.create_session() as session, session.begin():
            row = cls._row(session, tenant_id, migration_id)
            replay = cls._replay(row, payload)
            if replay is not None:
                return replay
            if row.revision != payload.expected_revision:
                raise MigrationError("revision_conflict", retryable=True)
            row.state = copy.deepcopy(row.state)
            action(session, row, naive_utc_now())
            row.revision += 1
            return cls._record(row, payload)

    @staticmethod
    def _binding(session: Session, row: TenantModelBillingMigration) -> dict[str, Any]:
        integration = session.scalar(
            select(TenantTokenerIntegration).where(TenantTokenerIntegration.tenant_id == row.tenant_id)
        )
        if integration is None or integration.status != TenantTokenerIntegrationStatus.READY:
            raise MigrationError("readiness_changed")
        credential = session.scalar(
            select(ProviderCredential).where(
                ProviderCredential.id == integration.provider_credential_id,
                ProviderCredential.tenant_id == row.tenant_id,
                ProviderCredential.provider_name == dify_config.TOKENER_PROVIDER_NAME,
            )
        )
        if credential is None or not credential.encrypted_config:
            raise MigrationError("readiness_changed")
        return {
            "tenant_id": row.tenant_id,
            "migration_id": row.migration_id,
            "plugin_unique_identifier": integration.plugin_unique_identifier or "",
            "provider_name": credential.provider_name,
            "provider_credential_id": credential.id,
            "credential_fingerprint": canonical_hash({"encrypted_config": credential.encrypted_config}),
            "model_mapping_version": row.state["model_mapping_version"],
            "inventory_hash": row.state["inventory_hash"],
            "billing_preparation_ref": row.state["billing_preparation_ref"],
            "source_ownership_hash": canonical_hash(row.state["source_ownership"]),
        }

    @classmethod
    def complete_preparation(
        cls,
        tenant_id: str,
        migration_id: str,
        *,
        source_ownership: dict[str, Any],
        expected_credential_fingerprint: str,
    ) -> None:
        ownership = TypeAdapter(dict[str, MigrationSourceProviderOwnership]).validate_python(source_ownership)
        snapshot = {key: value.model_dump(mode="json") for key, value in ownership.items()}
        with session_factory.create_session() as session, session.begin():
            row = cls._row(session, tenant_id, migration_id)
            if row.phase != "preparing":
                return
            row.state = copy.deepcopy(row.state)
            row.state["source_ownership"] = snapshot
            binding = cls._binding(session, row)
            if binding["credential_fingerprint"] != expected_credential_fingerprint:
                raise MigrationError("readiness_changed")
            pin = row.state.get("provisioned_binding")
            if pin and any(binding.get(key) != value for key, value in pin.items()):
                raise MigrationError("readiness_changed")
            row.state["preparation"] = binding
            row.state["preparation_binding_hash"] = canonical_hash(row.state["preparation"])
            row.state.pop("last_error_code", None)
            flag_modified(row, "state")
            row.phase = "prepared"
            row.revision += 1

    @classmethod
    def preparation_error(cls, tenant_id: str, migration_id: str, code: str) -> None:
        with session_factory.create_session() as session, session.begin():
            row = cls._row(session, tenant_id, migration_id)
            if row.phase == "preparing":
                row.state = {**row.state, "last_error_code": code}

    @classmethod
    def decide_cycle(cls, tenant_id: str, migration_id: str, payload: DecideCyclePayload) -> dict[str, Any]:
        def action(session: Session, row: TenantModelBillingMigration, now: datetime) -> None:
            decisions = row.state.setdefault("cycle_decisions", {})
            prior = decisions.get(payload.cycle_key)
            decision = {
                "cycle_key": payload.cycle_key,
                "decision": payload.decision,
                "contract_ref": payload.contract_ref,
                "manifest_hash": payload.manifest_hash or "",
                "operation_id": payload.operation_id,
            }
            if prior is not None:
                if any(prior[key] != decision[key] for key in ("decision", "contract_ref", "manifest_hash")):
                    raise MigrationError("cycle_decision_conflict")
                return
            if payload.decision == "legacy_deferred":
                if row.claimed_at is not None:
                    raise MigrationError("cycle_decision_conflict")
                decisions[payload.cycle_key] = decision
                return
            if row.phase != "prepared" or not cls.admitted(tenant_id):
                raise MigrationError("readiness_changed")
            paused = session.scalar(
                select(TenantModelBillingMigration.tenant_id)
                .where(
                    TenantModelBillingMigration.batch_id == row.batch_id,
                    TenantModelBillingMigration.claimed_at < now - timedelta(minutes=30),
                    TenantModelBillingMigration.phase != "active",
                    TenantModelBillingMigration.state["ever_activated"].as_boolean().is_not(True),
                )
                .limit(1)
            )
            if paused is not None:
                raise MigrationError("batch_paused", retryable=True)
            if canonical_hash(cls._binding(session, row)) != payload.preparation_binding_hash:
                raise MigrationError("readiness_changed")
            manifest = payload.manifest
            if manifest is None:
                raise MigrationError("invalid_window", 422)
            data = manifest.model_dump(mode="json")
            initial_cycle_alias = "dify.cycle.v1." + canonical_hash(
                [
                    tenant_id,
                    payload.contract_ref,
                    "invoice_initial",
                    manifest.paid_period_start,
                ]
            ).removeprefix("sha256:")
            if (
                manifest.tenant_id != tenant_id
                or manifest.migration_id != migration_id
                or manifest.contract_ref != payload.contract_ref
                or manifest.model_mapping_version != row.state["model_mapping_version"]
                or canonical_hash(data) != payload.manifest_hash
                or payload.cycle_key not in {initial_cycle_alias, *(window.cycle_key for window in manifest.windows)}
            ):
                raise MigrationError("manifest_conflict")
            if not any(window.starts_at <= _timestamp(now) < window.ends_at for window in manifest.windows):
                raise MigrationError("expired_plan", 422)
            for window in manifest.windows:
                old = decisions.get(window.cycle_key)
                if old is not None and old["decision"] != "tokener":
                    raise MigrationError("cycle_decision_conflict")
            # Freeze every covered annual slot now; later legacy reset retries may
            # not independently choose a second backend for a scheduled window.
            for window in manifest.windows:
                decisions[window.cycle_key] = {**decision, "cycle_key": window.cycle_key}
            # A late initial invoice may have skipped its expired first slot.
            # Preserve that original business identity as well as the live slots.
            decisions[payload.cycle_key] = decision
            row.state.update(
                manifest=data,
                manifest_hash=payload.manifest_hash,
                intent_revision=1,
                billing_receipt_refs=list(payload.billing_receipt_refs),
                commands={},
            )
            row.phase = "claimed"
            row.claimed_at = now
            row.route_epoch += 1

        return cls._mutate(tenant_id, migration_id, payload, action)

    @staticmethod
    def _require_lease(row: TenantModelBillingMigration, token: str, now: datetime) -> None:
        if row.lease_token != token or row.lease_expires_at is None or row.lease_expires_at <= now:
            raise MigrationError("lease_lost")

    @classmethod
    def lease(cls, tenant_id: str, migration_id: str, payload: LeasePayload) -> dict[str, Any]:
        def action(_session: Session, row: TenantModelBillingMigration, now: datetime) -> None:
            if row.claimed_at is None:
                raise MigrationError("readiness_changed")
            if payload.action == "acquire":
                if row.lease_token is not None and row.lease_expires_at is not None and row.lease_expires_at > now:
                    raise MigrationError("lease_lost")
                row.lease_token = str(uuid4())
                row.lease_expires_at = now + timedelta(seconds=60)
            else:
                cls._require_lease(row, payload.lease_token or "", now)
                if payload.action == "renew":
                    row.lease_expires_at = now + timedelta(seconds=60)
                else:
                    row.lease_token = None
                    row.lease_expires_at = None

        return cls._mutate(tenant_id, migration_id, payload, action)

    @classmethod
    def funding_receipts(
        cls,
        tenant_id: str,
        migration_id: str,
        payload: FundingReceiptsPayload,
    ) -> dict[str, Any]:
        def action(_session: Session, row: TenantModelBillingMigration, now: datetime) -> None:
            cls._require_lease(row, payload.lease_token, now)
            if row.phase in {"active", "cancelled"} and not row.state.get("pending_contract_event"):
                raise MigrationError("readiness_changed")
            if payload.intent_revision != row.state.get("intent_revision") or payload.manifest_hash != row.state.get(
                "manifest_hash"
            ):
                raise MigrationError("contract_event_pending")
            commands = row.state.setdefault("commands", {})
            event = row.state.get("pending_contract_event")
            terminated = row.state.get("terminated_contract_refs", [])
            if row.state["manifest"]["contract_ref"] in terminated and not (event and event["terminal"]):
                raise MigrationError("contract_terminated")
            planned = {item["command_id"]: item for item in (event or {}).get("command_payloads", [])}
            manifest = row.state["manifest"]
            if (
                manifest["tenant_id"] != tenant_id
                or manifest["migration_id"] != migration_id
                or canonical_hash(manifest) != payload.manifest_hash
            ):
                raise MigrationError("manifest_conflict")
            replacement = (event or {}).get("replacement_manifest")
            replacement_hash = (event or {}).get("replacement_manifest_hash")
            if replacement is not None and (replacement != manifest or canonical_hash(replacement) != replacement_hash):
                raise MigrationError("manifest_conflict")
            # The frozen current manifest authorizes grants independently of the
            # old-window correction journal. New reanchor windows intentionally
            # are not in affected_window_ids/command_payloads and must not be
            # rejected simply because that correction event is still pending.
            manifest_grants = {"grant:" + window["window_id"]: window for window in manifest["windows"]}
            recovery_grants = {
                "grant:" + item["window"]["window_id"]: item["window"]
                for item in planned.values()
                if item["target_amount_usd_micro"] != "0"
            }
            for receipt in payload.commands:
                data = receipt.model_dump(mode="json")
                if receipt.command_id in planned:
                    command = planned[receipt.command_id]
                    if (
                        receipt.payload_hash != command["payload_hash"]
                        or receipt.remote_id != command["window"]["window_id"]
                    ):
                        raise MigrationError("idempotency_conflict")
                elif receipt.command_id not in row.state.get("fenced_command_ids", []):
                    recovery_window = manifest_grants.get(receipt.command_id) or recovery_grants.get(receipt.command_id)
                    if (
                        recovery_window is None
                        or receipt.payload_hash != canonical_hash(recovery_window)
                        or receipt.remote_id != recovery_window["window_id"]
                    ):
                        raise MigrationError("unplanned_command")
                    if manifest["contract_ref"] in terminated:
                        raise MigrationError("contract_terminated")
                old = commands.get(receipt.command_id)
                if old is not None:
                    if old["payload_hash"] != receipt.payload_hash or old["remote_id"] != receipt.remote_id:
                        raise MigrationError("idempotency_conflict")
                    if (
                        old["state"] in {"verified", "failed_definitive", "superseded"}
                        and old["state"] != receipt.state
                    ):
                        raise MigrationError("command_state_conflict")
                    if receipt.state == "registered" and old["state"] != "registered":
                        raise MigrationError("command_state_conflict")
                    if receipt.state == "dispatched" and old["state"] in {"accepted", "outcome_unknown"}:
                        raise MigrationError("command_state_conflict")
                commands[receipt.command_id] = data
            unresolved = any(command["state"] in UNSETTLED_COMMANDS for command in commands.values())
            # Correction receipts refer to a window too, but cannot stand in for
            # the verified immutable creation of that window.
            verified = {
                command["remote_id"]
                for command_id, command in commands.items()
                if command["state"] == "verified"
                and command_id in manifest_grants
                and command["payload_hash"] == canonical_hash(manifest_grants[command_id])
                and command["remote_id"] == manifest_grants[command_id]["window_id"]
            }
            all_windows = {window["window_id"] for window in row.state["manifest"]["windows"]}
            row.state["funding_receipt_hash"] = canonical_hash(sorted(commands.values(), key=itemgetter("command_id")))
            event = row.state.get("pending_contract_event")
            if event is not None:
                # Event receipts must be explicitly bound to each affected remote
                # window, rather than accepting unchanged original grant receipts.
                event_commands = row.state.setdefault("event_command_ids", [])
                for receipt in payload.commands:
                    if (
                        receipt.command_id not in row.state.get("fenced_command_ids", [])
                        and receipt.command_id not in event_commands
                        and (not planned or receipt.command_id in planned)
                    ):
                        event_commands.append(receipt.command_id)
                corrected = {
                    commands[key]["remote_id"] for key in event_commands if commands[key]["state"] == "verified"
                }
                if unresolved or not set(event["affected_window_ids"]).issubset(corrected):
                    row.phase = "blocked"
                    return
                row.state.pop("pending_contract_event")
                row.state.pop("blocked_from", None)
                if event["terminal"]:
                    # Cancel the original entitlement contract permanently, not
                    # the tenant's Tokener routing/org/other legitimate money.
                    historical_contract = event["contract_ref"] != row.state["manifest"]["contract_ref"]
                    row.phase = "active" if historical_contract and row.state.get("ever_activated") else "cancelled"
                    row.route_epoch += 1
                    return
                if row.state.get("ever_activated") and "replacement_manifest" not in event:
                    # Routing cutover is permanent. An old invoice refund must
                    # not require its expired original window to activate again.
                    row.phase = "active"
                    row.route_epoch += 1
                    return
            row.phase = "activating" if not unresolved and all_windows.issubset(verified) else "granting"

        return cls._mutate(tenant_id, migration_id, payload, action)

    @classmethod
    def contract_event(cls, tenant_id: str, migration_id: str, payload: ContractEventPayload) -> dict[str, Any]:
        def action(_session: Session, row: TenantModelBillingMigration, now: datetime) -> None:
            manifest = row.state.get("manifest")
            owned_manifest = next(
                (
                    candidate
                    for candidate in [manifest, *row.state.get("prior_manifests", [])]
                    if candidate is not None and candidate["contract_ref"] == payload.contract_ref
                ),
                None,
            )
            if manifest is None or owned_manifest is None:
                raise MigrationError("ineligible_contract", 422)
            terminated = row.state.setdefault("terminated_contract_refs", [])
            if payload.contract_ref in terminated and not payload.terminal:
                raise MigrationError("contract_terminated")
            if not set(payload.affected_window_ids).issubset(
                {window["window_id"] for window in owned_manifest["windows"]}
            ):
                raise MigrationError("manifest_conflict")
            if row.state.get("pending_contract_event") is not None:
                raise MigrationError("contract_event_pending")
            if payload.business_event_ref in row.state.get("contract_events", {}):
                raise MigrationError("idempotency_conflict")
            event = payload.model_dump(mode="json", exclude_none=True)
            owned_windows = {window["window_id"]: window for window in owned_manifest["windows"]}
            for command in payload.command_payloads:
                if command.window.model_dump(mode="json") != owned_windows[command.window.window_id]:
                    raise MigrationError("manifest_conflict")
            row.state.setdefault("contract_events", {})[payload.business_event_ref] = event
            row.state["pending_contract_event"] = event
            row.state["blocked_from"] = row.phase
            row.state["fenced_command_ids"] = list(row.state.get("commands", {}))
            row.state["event_command_ids"] = []
            row.state["intent_revision"] += 1
            row.state.setdefault("billing_receipt_refs", []).append(payload.billing_receipt_ref)
            if payload.terminal and payload.contract_ref not in terminated:
                terminated.append(payload.contract_ref)
            if payload.replacement_manifest is not None:
                replacement = payload.replacement_manifest.model_dump(mode="json")
                if replacement["contract_ref"] in terminated:
                    raise MigrationError("contract_terminated")
                if (
                    replacement["tenant_id"] != tenant_id
                    or replacement["migration_id"] != migration_id
                    or replacement["plan_revision"] <= manifest["plan_revision"]
                    or replacement["model_mapping_version"] != row.state["model_mapping_version"]
                    or canonical_hash(replacement) != payload.replacement_manifest_hash
                ):
                    raise MigrationError("manifest_conflict")
                replacement_windows = {window["window_id"]: window for window in replacement["windows"]}
                manual_old_id: str | None = None
                if payload.manual_replan:
                    manual_old_id = cls._validate_manual_unsent_replan(row, manifest, replacement, now)
                for window in manifest["windows"]:
                    next_window = replacement_windows.get(window["window_id"])
                    if window != next_window and window["window_id"] not in payload.affected_window_ids:
                        raise MigrationError("manifest_conflict")
                    if window["starts_at"] <= _timestamp(now) < window["ends_at"] and (
                        next_window is None
                        or next_window["starts_at"] != window["starts_at"]
                        or next_window["ends_at"] != window["ends_at"]
                    ):
                        if manual_old_id != window["window_id"]:
                            raise MigrationError("active_window_boundary_changed")
                decisions = row.state.setdefault("cycle_decisions", {})
                for window in replacement["windows"]:
                    previous = decisions.get(window["cycle_key"])
                    if previous is not None and previous["decision"] != "tokener":
                        raise MigrationError("cycle_decision_conflict")
                    decisions.setdefault(
                        window["cycle_key"],
                        {
                            "cycle_key": window["cycle_key"],
                            "decision": "tokener",
                            "contract_ref": replacement["contract_ref"],
                            "manifest_hash": payload.replacement_manifest_hash,
                            "operation_id": payload.operation_id,
                        },
                    )
                row.state.setdefault("prior_manifests", []).append(manifest)
                row.state["manifest"] = replacement
                row.state["manifest_hash"] = payload.replacement_manifest_hash
            row.phase = "blocked"
            row.route_epoch += 1

        return cls._mutate(tenant_id, migration_id, payload, action)

    @staticmethod
    def _validate_manual_unsent_replan(
        row: TenantModelBillingMigration,
        manifest: dict[str, Any],
        replacement: dict[str, Any],
        now: datetime,
    ) -> str:
        """Prove a current-window repair has never crossed the dispatch boundary.

        Runs under the same row lock/CAS as the intent fence. A racing worker's
        dispatched receipt either wins first and rejects this repair, or loses
        the old revision and cannot authorize its external create afterward.
        """
        fixed = (
            "tenant_id",
            "migration_id",
            "calendar_policy",
            "contract_ref",
            "subscription_id",
            "paid_period_start",
            "paid_period_end",
            "funding_invoice_id",
            "amount_policy_version",
            "model_mapping_version",
        )
        if any(manifest[key] != replacement[key] for key in fixed):
            raise MigrationError("invalid_manual_replan")
        if replacement["plan_revision"] != manifest["plan_revision"] + 1:
            raise MigrationError("invalid_manual_replan")
        if len(manifest["windows"]) != len(replacement["windows"]):
            raise MigrationError("invalid_manual_replan")
        candidates = {window["cycle_key"]: window for window in replacement["windows"]}
        repaired: str | None = None
        today = _timestamp(now.replace(hour=0, minute=0, second=0, microsecond=0))
        for old in manifest["windows"]:
            new = candidates.get(old["cycle_key"])
            if new == old:
                continue
            if (
                new is None
                or repaired is not None
                or not old["starts_at"] <= _timestamp(now) < old["ends_at"]
                or new["starts_at"] != today
                or new["starts_at"] <= old["starts_at"]
                or new["window_id"] == old["window_id"]
                or new["source_ref"] != new["window_id"]
                or any(
                    new[key] != old[key] for key in ("ends_at", "amount_usd_micro", "cycle_key", "ordinal", "aliases")
                )
            ):
                raise MigrationError("invalid_manual_replan")
            prior = row.state.get("commands", {}).get("grant:" + old["window_id"])
            if prior is not None and prior["state"] != "registered":
                raise MigrationError("manual_replan_already_dispatched")
            repaired = old["window_id"]
        if repaired is None:
            raise MigrationError("invalid_manual_replan")
        return repaired

    @classmethod
    def activate(cls, tenant_id: str, migration_id: str, payload: ActivateMigrationPayload) -> dict[str, Any]:
        # Revalidate protocol/mapping outside the transaction, but never make a
        # committed transport replay dependent on today's runtime availability.
        with session_factory.create_session() as session:
            row = session.get(TenantModelBillingMigration, tenant_id)
            if row is None or row.migration_id != migration_id:
                raise MigrationError("migration_not_found", 404)
            replay = cls._replay(row, payload)
            if replay is not None:
                return replay
            mapping_version = row.state["model_mapping_version"]
            inventory_hash = row.state["inventory_hash"]
            ownership_hash = canonical_hash(row.state["source_ownership"])
        cls.validate_runtime_readiness(tenant_id, mapping_version, inventory_hash, ownership_hash)

        def action(session: Session, row: TenantModelBillingMigration, now: datetime) -> None:
            cls._require_lease(row, payload.lease_token, now)
            terminal_publication = row.phase == "cancelled"
            if row.state.get("pending_contract_event"):
                raise MigrationError("contract_event_pending")
            if terminal_publication:
                contract_ref = row.state["manifest"]["contract_ref"]
                terminal_events = [
                    event
                    for event in row.state.get("contract_events", {}).values()
                    if event["terminal"] and event["contract_ref"] == contract_ref
                ]
                if contract_ref not in row.state.get("terminated_contract_refs", []) or not terminal_events:
                    raise MigrationError("contract_event_pending")
                if any(command["state"] in UNSETTLED_COMMANDS for command in row.state.get("commands", {}).values()):
                    raise MigrationError("contract_event_pending")
                commands = row.state.get("commands", {})
                if any(
                    commands.get(command["command_id"], {}).get("state") != "verified"
                    for event in terminal_events
                    for command in event["command_payloads"]
                ):
                    raise MigrationError("contract_event_pending")
            elif row.phase != "activating":
                raise MigrationError("contract_event_pending")
            activation_bindings = {
                "intent_revision": payload.intent_revision,
                "manifest_hash": payload.manifest_hash,
                "funding_receipt_hash": payload.funding_receipt_hash,
                "preparation_binding_hash": payload.preparation_binding_hash,
            }
            for key, value in activation_bindings.items():
                if value != row.state.get(key):
                    raise MigrationError("manifest_conflict")
            if canonical_hash(cls._binding(session, row)) != payload.preparation_binding_hash:
                raise MigrationError("readiness_changed")
            if (
                not terminal_publication
                and not row.state.get("ever_activated")
                and not any(
                    window["starts_at"] <= _timestamp(now) < window["ends_at"]
                    for window in row.state["manifest"]["windows"]
                )
            ):
                raise MigrationError("expired_plan", 422)
            profile = session.get(TenantModelBillingProfile, tenant_id)
            if profile is None:
                session.add(TenantModelBillingProfile(tenant_id=tenant_id, model_billing_source="tokener"))
            else:
                profile.model_billing_source = "tokener"
            provider = session.scalar(
                select(Provider)
                .where(
                    Provider.tenant_id == tenant_id,
                    Provider.provider_name == dify_config.TOKENER_PROVIDER_NAME,
                    Provider.provider_type == ProviderType.CUSTOM,
                )
                .with_for_update()
            )
            if provider is None:
                session.add(
                    Provider(
                        tenant_id=tenant_id,
                        provider_name=dify_config.TOKENER_PROVIDER_NAME,
                        provider_type=ProviderType.CUSTOM,
                        is_valid=True,
                        credential_id=row.state["preparation"]["provider_credential_id"],
                    )
                )
            elif provider.credential_id is None:
                provider.credential_id = row.state["preparation"]["provider_credential_id"]
                provider.is_valid = True
            # Existing BYOK credentials, preferred provider and all default model
            # selections are deliberately untouched by publishing the managed key.
            # A fully converged refund/cancellation can publish routing with no
            # allowance at all. Keep the original contract terminal so a stale
            # plan update cannot resurrect it; a later paid contract uses the
            # existing native Tokener path and the same org.
            row.phase = "cancelled" if terminal_publication else "active"
            row.state["ever_activated"] = True
            row.route_epoch += 1

        result = cls._mutate(tenant_id, migration_id, payload, action)
        try:
            ModelBillingProfileService.invalidate(tenant_id)
            from core.provider_manager import ProviderManager

            ProviderManager.invalidate_configurations_cache(tenant_id)
        except Exception:
            # Admission uses the authoritative migration row before this cache.
            logger.warning("Migration profile cache invalidation failed tenant=%s", tenant_id)
        return result

    @staticmethod
    def validate_runtime_readiness(
        tenant_id: str,
        mapping_version: str,
        inventory_hash: str,
        ownership_hash: str,
    ) -> None:
        from core.model_invocation_routing import validate_migration_readiness

        try:
            readiness = validate_migration_readiness(tenant_id, mapping_version)
            if readiness["inventory_hash"] != inventory_hash:
                raise MigrationError("readiness_changed")
            if canonical_hash(readiness["source_ownership"]) != ownership_hash:
                raise MigrationError("readiness_changed")
        except MigrationError:
            raise
        except Exception:
            raise MigrationError("readiness_changed", retryable=True) from None
