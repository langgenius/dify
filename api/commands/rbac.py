from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed

import click
from sqlalchemy import select

from configs import dify_config
from core.db.session_factory import session_factory
from models import TenantAccountJoin, TenantAccountRole
from services.enterprise.rbac_service import ListOption, RBACService

_LEGACY_ROLE_TO_BUILTIN_TAG = {
    TenantAccountRole.OWNER.value: "owner",
    TenantAccountRole.ADMIN.value: "admin",
    TenantAccountRole.EDITOR.value: "editor",
    TenantAccountRole.NORMAL.value: "normal",
    TenantAccountRole.DATASET_OPERATOR.value: "dataset_operator",
}


def _resolve_builtin_role_ids(tenant_id: str, operator_account_id: str) -> dict[str, str]:
    """Resolve every legacy workspace role to the current tenant's builtin RBAC role id.

    The migration replays the old `TenantAccountJoin.role` values onto the
    RBAC member-role binding API. Builtin RBAC roles are tenant-scoped and
    identified by runtime ids, so the command must look them up per tenant.
    """
    roles = RBACService.Roles.list(
        tenant_id=tenant_id,
        account_id=operator_account_id,
        options=ListOption(page_number=1, results_per_page=100),
    ).data
    role_id_by_tag = {
        role.role_tag: role.id
        for role in roles
        if role.is_builtin and role.category == "global_system_default" and role.role_tag
    }
    resolved: dict[str, str] = {}
    for legacy_role, expected_builtin_tag in _LEGACY_ROLE_TO_BUILTIN_TAG.items():
        role_id = role_id_by_tag.get(expected_builtin_tag)
        if expected_builtin_tag == "dataset_operator" and not dify_config.DATASET_OPERATOR_ENABLED:
            continue
        if not role_id:
            raise ValueError(f"Builtin RBAC role not found for tenant={tenant_id}, legacy_role={legacy_role}")
        resolved[legacy_role] = role_id
    return resolved


def _resolve_builtin_role_id(tenant_id: str, operator_account_id: str, legacy_role: str) -> str:
    """Resolve a legacy workspace role to the current tenant's builtin RBAC role id.

    The migration replays the old `TenantAccountJoin.role` values onto the
    RBAC member-role binding API. Builtin RBAC roles are tenant-scoped and
    identified by runtime ids, so the command must look them up per tenant.
    """
    if legacy_role not in _LEGACY_ROLE_TO_BUILTIN_TAG:
        raise ValueError(f"Unsupported legacy workspace role: {legacy_role}")

    return _resolve_builtin_role_ids(tenant_id, operator_account_id)[legacy_role]


def _iter_tenant_member_batches(
    tenant_id: str | None,
    *,
    db_batch_size: int,
    api_batch_size: int,
) -> Iterator[tuple[str, str, list[tuple[str, str]]]]:
    """Yield legacy member roles in tenant-scoped API-sized batches.

    Rows are projected to primitive values and streamed from the database, so
    the command never materializes every TenantAccountJoin ORM object. The
    iterator only keeps one tenant's API-sized batches in memory while it
    finds that tenant's owner account.
    """
    with session_factory.create_session() as session:
        stmt = (
            select(TenantAccountJoin.tenant_id, TenantAccountJoin.account_id, TenantAccountJoin.role)
            .order_by(TenantAccountJoin.tenant_id.asc(), TenantAccountJoin.id.asc())
            .execution_options(yield_per=db_batch_size)
        )
        if tenant_id:
            stmt = stmt.where(TenantAccountJoin.tenant_id == tenant_id)

        current_tenant_id: str | None = None
        owner_account_id: str | None = None
        batches: list[list[tuple[str, str]]] = []
        batch: list[tuple[str, str]] = []

        def flush_current_tenant() -> Iterator[tuple[str, str, list[tuple[str, str]]]]:
            if current_tenant_id is None:
                return
            if batch:
                batches.append(batch.copy())
            if not owner_account_id:
                raise ValueError(f"Workspace owner not found for tenant={current_tenant_id}")
            for item in batches:
                yield current_tenant_id, owner_account_id, item

        for row in session.execute(stmt):
            workspace_id = str(row.tenant_id)
            if current_tenant_id is not None and workspace_id != current_tenant_id:
                yield from flush_current_tenant()
                owner_account_id = None
                batches = []
                batch = []
            current_tenant_id = workspace_id
            account_id = str(row.account_id)
            role = str(row.role)
            if role == TenantAccountRole.OWNER.value:
                owner_account_id = account_id
            batch.append((account_id, role))
            if len(batch) >= api_batch_size:
                batches.append(batch)
                batch = []

        yield from flush_current_tenant()


def _member_already_has_role(current_roles_by_account_id: dict[str, set[str]], account_id: str, role_id: str) -> bool:
    return current_roles_by_account_id.get(account_id) == {role_id}


def _replace_member_role(
    tenant_id: str,
    operator_account_id: str,
    member_account_id: str,
    role_id: str,
) -> str:
    RBACService.MemberRoles.replace(
        tenant_id=tenant_id,
        account_id=operator_account_id,
        member_account_id=member_account_id,
        role_ids=[role_id],
    )
    return member_account_id


@click.command(
    "rbac-migrate-member-roles", help="Migrate legacy workspace member roles into RBAC member-role bindings."
)
@click.option("--tenant-id", help="Only migrate a single workspace.")
@click.option("--dry-run", is_flag=True, default=False, help="Preview the migration without writing RBAC bindings.")
@click.option("--db-batch-size", default=5000, show_default=True, help="Rows fetched per database batch.")
@click.option("--api-batch-size", default=200, show_default=True, help="Members checked per RBAC batch_get call.")
@click.option("--workers", default=1, show_default=True, help="Concurrent member role replace calls per tenant batch.")
def migrate_member_roles_to_rbac(
    tenant_id: str | None,
    dry_run: bool,
    db_batch_size: int,
    api_batch_size: int,
    workers: int,
) -> None:
    """Backfill RBAC member-role bindings from legacy `TenantAccountJoin.role` data.

    This is an offline migration command for workspaces that already have
    members in the legacy role model but need matching records in the RBAC
    member-role binding store.
    """
    click.echo(click.style("Starting RBAC member-role migration.", fg="green"))
    if workers < 1:
        raise click.BadParameter("workers must be >= 1", param_hint="--workers")

    tenant_count = 0
    scanned_count = 0
    skipped_count = 0
    migrated_count = 0
    current_tenant_id: str | None = None
    role_ids_by_legacy_role: dict[str, str] = {}

    for workspace_id, owner_account_id, batch in _iter_tenant_member_batches(
        tenant_id,
        db_batch_size=db_batch_size,
        api_batch_size=api_batch_size,
    ):
        scanned_count += len(batch)
        if workspace_id != current_tenant_id:
            tenant_count += 1
            current_tenant_id = workspace_id
            role_ids_by_legacy_role = _resolve_builtin_role_ids(workspace_id, owner_account_id)
            click.echo(f"tenant={workspace_id}")

        current_roles_by_account_id: dict[str, set[str]] = {}
        if not dry_run:
            current_roles = RBACService.MemberRoles.batch_get(
                tenant_id=workspace_id,
                account_id=owner_account_id,
                member_account_ids=[account_id for account_id, _ in batch],
            )
            current_roles_by_account_id = {
                item.account_id: {str(role.id) for role in item.roles} for item in current_roles
            }

        replace_jobs: list[tuple[str, str]] = []
        for member_account_id, legacy_role in batch:
            resolved_role_id = role_ids_by_legacy_role.get(legacy_role)
            if not resolved_role_id:
                raise ValueError(f"Unsupported legacy workspace role: {legacy_role}")

            if dry_run:
                click.echo(
                    f"tenant={workspace_id} member={member_account_id} "
                    f"legacy_role={legacy_role} -> rbac_role_id={resolved_role_id}"
                )
                continue

            if _member_already_has_role(current_roles_by_account_id, member_account_id, resolved_role_id):
                skipped_count += 1
                continue

            replace_jobs.append((member_account_id, resolved_role_id))

        if replace_jobs:
            if workers == 1:
                for member_account_id, resolved_role_id in replace_jobs:
                    _replace_member_role(workspace_id, owner_account_id, member_account_id, resolved_role_id)
                    migrated_count += 1
            else:
                with ThreadPoolExecutor(max_workers=workers) as executor:
                    futures = [
                        executor.submit(
                            _replace_member_role,
                            workspace_id,
                            owner_account_id,
                            member_account_id,
                            resolved_role_id,
                        )
                        for member_account_id, resolved_role_id in replace_jobs
                    ]
                    for future in as_completed(futures):
                        future.result()
                        migrated_count += 1

        if scanned_count % 10000 == 0:
            click.echo(
                f"progress scanned={scanned_count} migrated={migrated_count} skipped={skipped_count}",
                err=True,
            )

    if scanned_count == 0:
        click.echo(click.style("No workspace members found for migration.", fg="yellow"))
        return

    if dry_run:
        click.echo(
            click.style(
                f"Dry run completed. Scanned {scanned_count} members across {tenant_count} tenants. "
                "No RBAC bindings were written.",
                fg="yellow",
            )
        )
    else:
        click.echo(
            click.style(
                f"RBAC member-role migration completed. Scanned {scanned_count} members across {tenant_count} tenants, "
                f"migrated {migrated_count}, skipped {skipped_count} already up-to-date.",
                fg="green",
            )
        )
