from __future__ import annotations

import click
from sqlalchemy import select

from core.db.session_factory import session_factory
from models import TenantAccountJoin, TenantAccountRole
from services.enterprise.rbac_service import ListOption, RBACService


def _resolve_builtin_role_id(tenant_id: str, operator_account_id: str, legacy_role: str) -> str:
    """Resolve a legacy workspace role to the current tenant's builtin RBAC role id.

    The migration replays the old `TenantAccountJoin.role` values onto the
    RBAC member-role binding API. Builtin RBAC roles are tenant-scoped and
    identified by runtime ids, so the command must look them up per tenant.
    """
    expected_builtin_tag = {
        TenantAccountRole.OWNER.value: "owner",
        TenantAccountRole.ADMIN.value: "admin",
        TenantAccountRole.EDITOR.value: "editor",
        TenantAccountRole.NORMAL.value: "normal",
        TenantAccountRole.DATASET_OPERATOR.value: "dataset_operator",
    }.get(legacy_role)
    if not expected_builtin_tag:
        raise ValueError(f"Unsupported legacy workspace role: {legacy_role}")

    roles = RBACService.Roles.list(
        tenant_id=tenant_id,
        account_id=operator_account_id,
        options=ListOption(page_number=1, results_per_page=100),
    ).data
    for role in roles:
        if role.is_builtin and role.category == "global_system_default" and role.role_tag == expected_builtin_tag:
            return str(role.id)

    raise ValueError(f"Builtin RBAC role not found for tenant={tenant_id}, legacy_role={legacy_role}")


@click.command(
    "rbac-migrate-member-roles", help="Migrate legacy workspace member roles into RBAC member-role bindings."
)
@click.option("--tenant-id", help="Only migrate a single workspace.")
@click.option("--dry-run", is_flag=True, default=False, help="Preview the migration without writing RBAC bindings.")
def migrate_member_roles_to_rbac(tenant_id: str | None, dry_run: bool) -> None:
    """Backfill RBAC member-role bindings from legacy `TenantAccountJoin.role` data.

    This is an offline migration command for workspaces that already have
    members in the legacy role model but need matching records in the RBAC
    member-role binding store.
    """
    click.echo(click.style("Starting RBAC member-role migration.", fg="green"))

    with session_factory.create_session() as session:
        stmt = select(TenantAccountJoin).order_by(TenantAccountJoin.tenant_id.asc(), TenantAccountJoin.id.asc())
        if tenant_id:
            stmt = stmt.where(TenantAccountJoin.tenant_id == tenant_id)

        joins = list(session.scalars(stmt).all())

    if not joins:
        click.echo(click.style("No workspace members found for migration.", fg="yellow"))
        return

    owner_account_by_tenant: dict[str, str] = {}
    resolved_role_ids: dict[tuple[str, str], str] = {}
    migrated_count = 0

    for join in joins:
        workspace_id = str(join.tenant_id)
        member_account_id = str(join.account_id)
        legacy_role = str(join.role)

        if workspace_id not in owner_account_by_tenant:
            owner_join = next(
                (
                    item
                    for item in joins
                    if str(item.tenant_id) == workspace_id and str(item.role) == TenantAccountRole.OWNER.value
                ),
                None,
            )
            if not owner_join:
                raise ValueError(f"Workspace owner not found for tenant={workspace_id}")
            owner_account_by_tenant[workspace_id] = str(owner_join.account_id)

        operator_account_id = owner_account_by_tenant[workspace_id]
        cache_key = (workspace_id, legacy_role)
        if cache_key not in resolved_role_ids:
            resolved_role_ids[cache_key] = _resolve_builtin_role_id(workspace_id, operator_account_id, legacy_role)

        resolved_role_id = resolved_role_ids[cache_key]
        click.echo(
            f"tenant={workspace_id} member={member_account_id} "
            f"legacy_role={legacy_role} -> rbac_role_id={resolved_role_id}"
        )

        if dry_run:
            continue

        RBACService.MemberRoles.replace(
            tenant_id=workspace_id,
            account_id=operator_account_id,
            member_account_id=member_account_id,
            role_ids=[resolved_role_id],
        )
        migrated_count += 1

    if dry_run:
        click.echo(click.style("Dry run completed. No RBAC bindings were written.", fg="yellow"))
    else:
        click.echo(click.style(f"RBAC member-role migration completed. Migrated {migrated_count} members.", fg="green"))
