"""Explicit, allowlisted migration operations. The default is a read-only plan."""

import json
from uuid import NAMESPACE_URL, UUID, uuid5

import click
from flask.cli import with_appcontext

from configs import dify_config
from core.model_invocation_routing import migration_inventory
from services.billing_service import BillingService, _BillingHTTPStatusError
from services.model_billing_migration_service import ModelBillingMigrationService


@click.group("tokener-migration")
def tokener_migration():
    """Inspect, prepare or resume an explicitly selected workspace (never Stripe)."""


@tokener_migration.command("prepare")
@click.option("--tenant-id", type=click.UUID, required=True)
@click.option("--batch-id", required=True)
@click.option("--mapping-version", required=True)
@click.option("--apply", is_flag=True, help="Persist the intent and prepare resources; never grant signup money.")
@with_appcontext
def prepare(tenant_id: UUID, batch_id: str, mapping_version: str, apply: bool):
    tenant = str(tenant_id)
    if apply and not ModelBillingMigrationService.admitted(tenant):
        raise click.ClickException("Migration admission is disabled or tenant is not allowlisted.")
    inventory = migration_inventory(tenant, mapping_version)
    migration_id = str(uuid5(NAMESPACE_URL, f"dify.migration.v1:{tenant}:{batch_id}"))
    payload = {
        "api_version": 1,
        "operation_id": str(uuid5(NAMESPACE_URL, f"dify.migration.prepare.v1:{migration_id}")),
        "expected_revision": 0,
        "migration_id": migration_id,
        "batch_id": batch_id,
        "eligibility_policy_version": "paid-legacy-v1",
        "model_mapping_version": mapping_version,
        "inventory_hash": inventory["inventory_hash"],
    }
    if not apply:
        click.echo(json.dumps({"dry_run": True, "request": payload, "inventory": inventory}, sort_keys=True))
        return
    _post(tenant, "prepare-migration", payload)
    click.echo(json.dumps({"status": "accepted", "tenant_id": tenant, "migration_id": migration_id}))


@tokener_migration.command("status")
@click.option("--tenant-id", type=click.UUID, required=True)
@with_appcontext
def status(tenant_id: UUID):
    click.echo(json.dumps(ModelBillingMigrationService.status(str(tenant_id)), sort_keys=True))


@tokener_migration.command("resume")
@click.option("--tenant-id", type=click.UUID, required=True)
@click.option("--manual", is_flag=True, help="Explicit operator recovery after the initial 30-minute automatic limit.")
@click.option(
    "--replan-unsent-operation-id",
    type=click.UUID,
    help="With --manual, replan only journal-proven never-dispatched expired-start windows. Reuse this UUID.",
)
@with_appcontext
def resume(tenant_id: UUID, manual: bool, replan_unsent_operation_id: UUID | None):
    if replan_unsent_operation_id is not None and not manual:
        raise click.UsageError("--replan-unsent-operation-id requires --manual")
    state = ModelBillingMigrationService.status(str(tenant_id))
    payload: dict[str, object] = {"api_version": 1, "migration_id": state["migration_id"], "manual": manual}
    if replan_unsent_operation_id is not None:
        payload.update(manual_replan=True, operation_id=str(replan_unsent_operation_id))
    _post(
        str(tenant_id),
        "resume-migration",
        payload,
    )
    click.echo(json.dumps({"status": "accepted", "migration_id": state["migration_id"]}))


def _post(tenant: str, operation: str, payload: dict[str, object]) -> None:
    base_url = dify_config.TOKENER_BILLING_API_URL.strip().rstrip("/")
    if not base_url:
        raise click.ClickException("TOKENER_BILLING_API_URL is not configured.")
    try:
        BillingService._send_request(
            "POST", f"/internal/v1/tokener/tenants/{tenant}/{operation}", json=payload, base_url=base_url
        )
    except _BillingHTTPStatusError as error:
        if error.status_code != 202:
            raise click.ClickException(
                f"Migration request failed (HTTP {error.status_code}); reuse the same intent."
            ) from None
