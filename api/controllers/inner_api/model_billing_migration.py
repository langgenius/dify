"""Trusted Billing → Core migration control; no browser-authorized writes."""

from collections.abc import Callable
from typing import Annotated, Any, Literal

from flask import request
from flask_restx import Resource
from pydantic import ConfigDict, Field, ValidationError

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import inner_api_only
from fields.base import ResponseModel
from services.entities.model_billing_migration import (
    ActivateMigrationPayload,
    CommandReceipt,
    ContractEventPayload,
    DecideCyclePayload,
    Digest,
    FundingReceiptsPayload,
    LeasePayload,
    PrepareMigrationPayload,
    Reference,
    Revision,
    StrictPayload,
    Timestamp,
    UUIDString,
    WindowManifest,
)
from services.model_billing_migration_service import MigrationError, ModelBillingMigrationService


class MigrationStatusQuery(StrictPayload):
    operation_id: UUIDString | None = None


MigrationPhase = Literal["preparing", "prepared", "claimed", "granting", "activating", "active", "blocked", "cancelled"]


class MigrationOperationSummary(StrictPayload):
    phase: MigrationPhase
    decision: Literal["legacy_deferred", "tokener"] | None = None
    cycle_key: Reference | None = None
    manifest_hash: Digest | None = None
    error_code: Reference | None = None
    route_epoch: Revision | None = None
    intent_revision: Revision | None = None


class MigrationOperationResult(StrictPayload):
    operation_id: UUIDString
    request_hash: Digest
    result_code: Annotated[int, Field(ge=100, le=599)]
    result_revision: Revision
    result_summary: MigrationOperationSummary
    lease_action: Literal["acquire", "renew", "release"] | None = None
    lease_token: UUIDString | None = None
    lease_expires_at: Timestamp | None = None


class MigrationCycleDecision(StrictPayload):
    cycle_key: Reference
    decision: Literal["legacy_deferred", "tokener"]
    contract_ref: Reference
    operation_id: UUIDString
    manifest_hash: Digest | Literal[""]


class MigrationErrorResponse(ResponseModel):
    model_config = ConfigDict(extra="forbid")
    code: Reference
    message: str
    retryable: bool
    operation_id: UUIDString | None = None


class MigrationStatusResponse(ResponseModel):
    model_config = ConfigDict(extra="forbid")
    api_version: Literal[1]
    tenant_id: UUIDString
    migration_id: UUIDString
    phase: MigrationPhase
    attention: Literal["normal", "alerted", "manual_required"]
    revision: Revision
    route_epoch: Revision
    replayed: bool
    ever_activated: bool = Field(
        default=False,
        description="Tokener routing/profile has been published, including zero-money terminal finalization",
    )
    model_mapping_version: Reference
    inventory_hash: Digest
    billing_receipt_refs: list[Reference]
    operation_results: list[MigrationOperationResult]
    replayed_operation: MigrationOperationResult | None = Field(
        default=None,
        description="Immutable original outcome when replayed; all other top-level status fields are current authority",
    )
    commands: list[CommandReceipt]
    cycle_decisions: list[MigrationCycleDecision]
    contract_events: dict[str, ContractEventPayload] = Field(default_factory=dict)
    prior_manifests: list[WindowManifest] = Field(default_factory=list)
    terminated_contract_refs: list[Reference] = Field(default_factory=list)
    pending_contract_event: ContractEventPayload | None = None
    intent_revision: Revision | None = None
    claimed_at: Timestamp | None = None
    manifest: WindowManifest | None = None
    manifest_hash: Digest | None = None
    preparation_binding_hash: Digest | None = None
    funding_receipt_hash: Digest | None = None
    blocked_from: MigrationPhase | None = None
    last_error_code: Reference | None = None
    lease_token: UUIDString | None = None
    lease_expires_at: Timestamp | None = None


register_schema_models(
    inner_api_ns,
    PrepareMigrationPayload,
    DecideCyclePayload,
    LeasePayload,
    FundingReceiptsPayload,
    ContractEventPayload,
    ActivateMigrationPayload,
)
register_response_schema_models(inner_api_ns, MigrationStatusResponse, MigrationErrorResponse)


def _respond(action: Callable[[], dict[str, Any]]):
    try:
        result = action()
        return (
            MigrationStatusResponse.model_validate(result).model_dump(mode="json", exclude_none=True),
            202 if result["phase"] == "preparing" and not result["replayed"] else 200,
            {"Cache-Control": "no-store"},
        )
    except ValidationError:
        # Do not echo secret-adjacent unexpected input or validation locals.
        return {"code": "invalid_request", "message": "Invalid migration request", "retryable": False}, 400
    except MigrationError as error:
        return {"code": error.code, "message": error.code, "retryable": error.retryable}, error.status


@inner_api_ns.route("/tenants/<uuid:tenant_id>/model-billing-migrations")
class ModelBillingMigrationStatusApi(Resource):
    @inner_api_only
    @inner_api_ns.doc(params=query_params_from_model(MigrationStatusQuery))
    @inner_api_ns.response(200, "Migration control state", inner_api_ns.models[MigrationStatusResponse.__name__])
    def get(self, tenant_id):
        def action():
            query = MigrationStatusQuery.model_validate(request.args.to_dict(flat=True))
            return ModelBillingMigrationService.status(str(tenant_id), query.operation_id)

        return _respond(action)


@inner_api_ns.route("/tenants/<uuid:tenant_id>/model-billing-migrations/prepare")
class PrepareModelBillingMigrationApi(Resource):
    @inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[PrepareMigrationPayload.__name__])
    @inner_api_ns.response(202, "Preparation accepted", inner_api_ns.models[MigrationStatusResponse.__name__])
    def post(self, tenant_id):
        return _respond(
            lambda: ModelBillingMigrationService.prepare(
                str(tenant_id), PrepareMigrationPayload.model_validate(inner_api_ns.payload or {})
            )
        )


@inner_api_ns.route("/tenants/<uuid:tenant_id>/model-billing-migrations/<uuid:migration_id>/decide-cycle")
class DecideModelBillingMigrationCycleApi(Resource):
    @inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[DecideCyclePayload.__name__])
    @inner_api_ns.response(200, "Immutable cycle decision", inner_api_ns.models[MigrationStatusResponse.__name__])
    def post(self, tenant_id, migration_id):
        return _respond(
            lambda: ModelBillingMigrationService.decide_cycle(
                str(tenant_id), str(migration_id), DecideCyclePayload.model_validate(inner_api_ns.payload or {})
            )
        )


@inner_api_ns.route("/tenants/<uuid:tenant_id>/model-billing-migrations/<uuid:migration_id>/lease")
class ModelBillingMigrationLeaseApi(Resource):
    @inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[LeasePayload.__name__])
    @inner_api_ns.response(200, "Execution lease", inner_api_ns.models[MigrationStatusResponse.__name__])
    def post(self, tenant_id, migration_id):
        return _respond(
            lambda: ModelBillingMigrationService.lease(
                str(tenant_id), str(migration_id), LeasePayload.model_validate(inner_api_ns.payload or {})
            )
        )


@inner_api_ns.route("/tenants/<uuid:tenant_id>/model-billing-migrations/<uuid:migration_id>/funding-receipts")
class ModelBillingMigrationFundingReceiptsApi(Resource):
    @inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[FundingReceiptsPayload.__name__])
    @inner_api_ns.response(200, "Funding receipts persisted", inner_api_ns.models[MigrationStatusResponse.__name__])
    def post(self, tenant_id, migration_id):
        return _respond(
            lambda: ModelBillingMigrationService.funding_receipts(
                str(tenant_id), str(migration_id), FundingReceiptsPayload.model_validate(inner_api_ns.payload or {})
            )
        )


@inner_api_ns.route("/tenants/<uuid:tenant_id>/model-billing-migrations/<uuid:migration_id>/contract-events")
class ModelBillingMigrationContractEventsApi(Resource):
    @inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[ContractEventPayload.__name__])
    @inner_api_ns.response(200, "Contract intent fenced", inner_api_ns.models[MigrationStatusResponse.__name__])
    def post(self, tenant_id, migration_id):
        return _respond(
            lambda: ModelBillingMigrationService.contract_event(
                str(tenant_id), str(migration_id), ContractEventPayload.model_validate(inner_api_ns.payload or {})
            )
        )


@inner_api_ns.route("/tenants/<uuid:tenant_id>/model-billing-migrations/<uuid:migration_id>/activate")
class ActivateModelBillingMigrationApi(Resource):
    @inner_api_only
    @inner_api_ns.expect(inner_api_ns.models[ActivateMigrationPayload.__name__])
    @inner_api_ns.response(200, "Migration activated", inner_api_ns.models[MigrationStatusResponse.__name__])
    def post(self, tenant_id, migration_id):
        return _respond(
            lambda: ModelBillingMigrationService.activate(
                str(tenant_id), str(migration_id), ActivateMigrationPayload.model_validate(inner_api_ns.payload or {})
            )
        )
