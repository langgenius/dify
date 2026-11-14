"""Bounded, explicit recovery for uncertain upload outcomes; no object deletion."""

from uuid import UUID

import click

from extensions.ext_application_services import application_services


@click.command("recover-upload-quota")
@click.option("--tenant-id", required=True, type=click.UUID, help="Workspace whose reservations will be inspected.")
@click.option("--reservation-id", type=click.UUID, help="Inspect a specific reservation, scoped to the workspace.")
@click.option("--limit", default=100, type=click.IntRange(1, 1000), show_default=True)
@click.option("--apply", is_flag=True, help="Finalize matching objects; default is dry-run.")
@click.option("--release-missing", is_flag=True, help="Release reservations only when their object is absent.")
@click.option("--writers-stopped", is_flag=True, help="Attest ALL upload writers are stopped and drained.")
def recover_upload_quota(
    tenant_id: UUID, reservation_id: UUID | None, limit: int, apply: bool, release_missing: bool, writers_stopped: bool
) -> None:
    """Inspect one workspace; apply only verified finalization or quiesced missing releases.

    Missing objects remain reserved without an explicit stopped-writer claim.
    Errors propagate and leave uncertain capacity reserved; no path deletes
    storage objects or committed uploads. Output contains bounded resource IDs.
    """
    if release_missing and not writers_stopped:
        raise click.UsageError("--release-missing requires --writers-stopped after all upload writers are drained")
    service = application_services().end_user_uploads
    for upload in service.pending(
        tenant_id=str(tenant_id),
        limit=limit,
        reservation_id=str(reservation_id) if reservation_id is not None else None,
    ):
        result = service.recover(upload, apply=apply, release_missing=release_missing, writers_stopped=writers_stopped)
        click.echo(f"{upload.id}: {result}")
