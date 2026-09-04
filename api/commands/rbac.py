from __future__ import annotations

import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from enum import StrEnum

import click
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from core.rbac import RBACResourceWhitelistScope
from models import (
    Agent,
    AgentStatus,
    App,
    Dataset,
    DatasetPermission,
    DatasetPermissionEnum,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
)
from services.enterprise.rbac_service import (
    LegacyAgentRoleMigration,
    ListOption,
    RBACResourceType,
    RBACService,
    ReplaceMemberBindings,
    ReplaceUserAccessPolicies,
)

_RBAC_DEFAULT_ACCESS_POLICY_ID = "default"
_RBAC_RESOURCE_ACCESS_POLICY_BATCH_SIZE = 500

_AGENT_MIGRATION_STATE_LABEL = {
    False: "would change",
    True: "changed",
}

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


def _iter_tenant_ids(tenant_id: str | None, *, batch_size: int) -> Iterator[str]:
    if tenant_id:
        yield tenant_id
        return
    last_id: str | None = None
    while True:
        with session_factory.create_session() as session:
            stmt = select(Tenant.id).order_by(Tenant.id.asc()).limit(batch_size)
            if last_id is not None:
                stmt = stmt.where(Tenant.id > last_id)
            rows = session.execute(stmt).scalars().all()
        if not rows:
            return
        for row in rows:
            yield str(row)
        last_id = str(rows[-1])


def _emit_agent_migration_event(payload: dict[str, object]) -> None:
    click.echo(json.dumps(payload, sort_keys=True))


@dataclass(frozen=True)
class _AgentMigrationEventKind:
    """Names the event family for one migration pass and owns its event-name stem."""

    event_stem: str
    include_tenant_id: bool = True

    @property
    def skipped(self) -> str:
        return f"{self.event_stem}_skipped"

    @property
    def failed(self) -> str:
        return f"{self.event_stem}_failed"

    def outcome(self, *, apply: bool) -> str:
        return f"{self.event_stem}_applied" if apply else f"{self.event_stem}_proposed_change"


_AGENT_ROLE_MIGRATION_EVENT_KIND = _AgentMigrationEventKind(event_stem="agent_manage_role_migration")
_AGENT_ROLE_TEMPLATE_MIGRATION_EVENT_KIND = _AgentMigrationEventKind(
    event_stem="agent_manage_role_template_migration", include_tenant_id=False
)
_AGENT_ACCESS_BOOTSTRAP_EVENT_KIND = _AgentMigrationEventKind(event_stem="agent_access_bootstrap")

_AGENT_BACKING_APP_SPECIFIC_WHITELIST_EVENT = "agent_backing_app_has_specific_whitelist"
_AGENT_ACCESS_BOOTSTRAP_MEMBER_SOURCE = "workspace_members"


class _AgentAccessBootstrapReason(StrEnum):
    """Why one agent did not get a freshly bootstrapped access row, or got an incomplete one."""

    ALREADY_INITIALIZED = "already_initialized"
    MISSING_WHITELIST_SCOPE = "missing_whitelist_scope"
    NO_CREATOR = "no_creator"


def _agent_manage_role_event(
    tenant_id: str | None,
    entry: LegacyAgentRoleMigration,
    *,
    apply: bool,
    kind: _AgentMigrationEventKind,
) -> dict[str, object]:
    base: dict[str, object] = {
        "dry_run": not apply,
        "role_id": entry.role_id,
        "role_name": entry.role_name,
    }
    if kind.include_tenant_id:
        base["tenant_id"] = tenant_id
    if entry.skipped:
        return {**base, "event": kind.skipped, "reason": entry.skipped}
    return {
        **base,
        "event": kind.outcome(apply=apply),
        "after": {
            "added_keys": entry.added_keys,
            "removed_keys": entry.removed_keys,
            "bound_policies": entry.bound_policies,
        },
    }


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
    *,
    session: Session,
) -> str:
    RBACService.MemberRoles.replace(
        tenant_id=tenant_id,
        account_id=operator_account_id,
        member_account_id=member_account_id,
        role_ids=[role_id],
        session=session,
    )
    return member_account_id


def _replace_member_role_with_new_session(
    tenant_id: str,
    operator_account_id: str,
    member_account_id: str,
    role_id: str,
) -> str:
    with session_factory.create_session() as session:
        return _replace_member_role(
            tenant_id=tenant_id,
            operator_account_id=operator_account_id,
            member_account_id=member_account_id,
            role_id=role_id,
            session=session,
        )


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
            current_roles_by_account_id = {item.account_id: {role.id for role in item.roles} for item in current_roles}

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
                with session_factory.create_session() as session:
                    for member_account_id, resolved_role_id in replace_jobs:
                        _replace_member_role(
                            workspace_id,
                            owner_account_id,
                            member_account_id,
                            resolved_role_id,
                            session=session,
                        )
                        migrated_count += 1
            else:
                with ThreadPoolExecutor(max_workers=workers) as executor:
                    futures = [
                        executor.submit(
                            _replace_member_role_with_new_session,
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


def _dataset_permission_enum(permission: DatasetPermissionEnum | str | None) -> DatasetPermissionEnum:
    if permission is None:
        return DatasetPermissionEnum.ONLY_ME
    try:
        return DatasetPermissionEnum(permission)
    except ValueError as exc:
        raise ValueError(f"Unsupported legacy dataset permission: {permission}") from exc


def _rbac_dataset_scope_for_legacy_permission(permission: DatasetPermissionEnum) -> RBACResourceWhitelistScope:
    if permission is DatasetPermissionEnum.ALL_TEAM:
        return RBACResourceWhitelistScope.ALL
    if permission in {DatasetPermissionEnum.ONLY_ME, DatasetPermissionEnum.PARTIAL_TEAM}:
        return RBACResourceWhitelistScope.SPECIFIC
    raise ValueError(f"Unsupported legacy dataset permission: {permission}")


def _emit_dataset_permission_migration_event(payload: dict[str, object]) -> None:
    click.echo(json.dumps(payload, sort_keys=True))


def _emit_resource_whitelist_scope_migration_event(payload: dict[str, object]) -> None:
    click.echo(json.dumps(payload, sort_keys=True))


def _normalize_rbac_whitelist_scope(scope: object) -> RBACResourceWhitelistScope | None:
    if scope is None:
        return None
    try:
        return RBACResourceWhitelistScope(str(scope))
    except ValueError as exc:
        raise ValueError(f"Unsupported RBAC whitelist scope: {scope}") from exc


def _owner_account_id(tenant_id: str, *, session: Session) -> str:
    account_id = session.scalar(
        select(TenantAccountJoin.account_id)
        .where(TenantAccountJoin.tenant_id == tenant_id, TenantAccountJoin.role == TenantAccountRole.OWNER)
        .order_by(TenantAccountJoin.id.asc())
        .limit(1)
    )
    if not account_id:
        raise ValueError(f"Workspace owner not found for tenant={tenant_id}")
    return str(account_id)


def _workspace_member_account_id_batches(tenant_id: str, batch_size: int) -> Iterator[list[str]]:
    last_join_id: str | None = None
    while True:
        with session_factory.create_session() as session:
            stmt = (
                select(TenantAccountJoin.id, TenantAccountJoin.account_id)
                .where(TenantAccountJoin.tenant_id == tenant_id)
                .order_by(TenantAccountJoin.id.asc())
                .limit(batch_size)
            )
            if last_join_id:
                stmt = stmt.where(TenantAccountJoin.id > last_join_id)

            rows = list(session.execute(stmt).all())
            if not rows:
                return

        yield [str(row.account_id) for row in rows]
        last_join_id = str(rows[-1].id)


def _replace_resource_whitelist(
    resource_type: str,
    *,
    tenant_id: str,
    operator_account_id: str,
    resource_id: str,
    automatic_include_workspace_members: bool,
) -> None:
    payload = ReplaceMemberBindings(automatic_include_workspace_members=automatic_include_workspace_members)
    if resource_type == "app":
        RBACService.AppAccess.replace_whitelist(
            tenant_id=tenant_id,
            account_id=operator_account_id,
            app_id=resource_id,
            payload=payload,
        )
        return
    RBACService.DatasetAccess.replace_whitelist(
        tenant_id=tenant_id,
        account_id=operator_account_id,
        dataset_id=resource_id,
        payload=payload,
    )


def _replace_resource_default_access_policies(
    resource_type: str,
    *,
    tenant_id: str,
    operator_account_id: str,
    resource_id: str,
    account_ids: list[str],
) -> None:
    if not account_ids:
        return
    payload = ReplaceUserAccessPolicies(
        access_policy_ids=[_RBAC_DEFAULT_ACCESS_POLICY_ID],
        account_ids=account_ids,
    )
    if resource_type == "app":
        RBACService.AppAccess.replace_user_access_policies(
            tenant_id=tenant_id,
            account_id=operator_account_id,
            app_id=resource_id,
            target_account_id=None,
            payload=payload,
        )
        return
    RBACService.DatasetAccess.replace_user_access_policies(
        tenant_id=tenant_id,
        account_id=operator_account_id,
        dataset_id=resource_id,
        target_account_id=None,
        payload=payload,
    )


def _resource_legacy_whitelist_config(
    resource_type: str,
    *,
    tenant_id: str,
    operator_account_id: str,
    resource_id: str,
):
    if resource_type == "app":
        return RBACService.AppAccess.legacy_whitelist_config(
            tenant_id=tenant_id,
            account_id=operator_account_id,
            app_id=resource_id,
        )
    return RBACService.DatasetAccess.legacy_whitelist_config(
        tenant_id=tenant_id,
        account_id=operator_account_id,
        dataset_id=resource_id,
    )


def _iter_rbac_resource_rows(
    resource_type: str,
    *,
    tenant_id: str | None,
    resource_id: str | None,
    batch_size: int,
) -> Iterator[tuple[str, str, str, str | None]]:
    model = App if resource_type == "app" else Dataset
    last_resource_id: str | None = None
    while True:
        with session_factory.create_session() as session:
            stmt = select(model.id, model.tenant_id, model.maintainer).order_by(model.id.asc()).limit(batch_size)
            if tenant_id:
                stmt = stmt.where(model.tenant_id == tenant_id)
            if resource_id:
                stmt = stmt.where(model.id == resource_id)
            if last_resource_id:
                stmt = stmt.where(model.id > last_resource_id)

            rows = list(session.execute(stmt).all())
            if not rows:
                return

        for row in rows:
            yield resource_type, str(row.tenant_id), str(row.id), str(row.maintainer) if row.maintainer else None

        last_resource_id = str(rows[-1].id)
        if resource_id:
            return


def _iter_selected_rbac_resource_rows(
    resource_type: str,
    *,
    tenant_id: str | None,
    resource_id: str | None,
    batch_size: int,
) -> Iterator[tuple[str, str, str, str | None]]:
    if resource_type in {"app", "all"}:
        yield from _iter_rbac_resource_rows(
            "app",
            tenant_id=tenant_id,
            resource_id=resource_id if resource_type == "app" else None,
            batch_size=batch_size,
        )
    if resource_type in {"dataset", "all"}:
        yield from _iter_rbac_resource_rows(
            "dataset",
            tenant_id=tenant_id,
            resource_id=resource_id if resource_type == "dataset" else None,
            batch_size=batch_size,
        )


@click.command(
    "rbac-migrate-resource-whitelist-scopes",
    help=(
        "Migrate RBAC app/dataset whitelist scope values to automatic_include_workspace_members. "
        "Old scope all becomes true; specific and only_me become false."
    ),
)
@click.option("--tenant-id", help="Only migrate resources in a single workspace.")
@click.option(
    "--resource-type",
    type=click.Choice(["app", "dataset", "all"]),
    default="all",
    show_default=True,
    help="Resource type to migrate.",
)
@click.option("--resource-id", help="Only migrate a single resource. Requires --resource-type app or dataset.")
@click.option("--batch-size", default=500, show_default=True, type=click.IntRange(min=1))
@click.option(
    "--member-batch-size",
    default=_RBAC_RESOURCE_ACCESS_POLICY_BATCH_SIZE,
    show_default=True,
    type=click.IntRange(min=1),
    help="Workspace members written per default-policy call when migrating old scope all.",
)
@click.option(
    "--dry-run/--apply",
    default=True,
    show_default=True,
    help="Preview the migration without writing RBAC bindings. Use --apply to write changes.",
)
def migrate_resource_whitelist_scopes_to_automatic_include(
    tenant_id: str | None,
    resource_type: str,
    resource_id: str | None,
    batch_size: int,
    member_batch_size: int,
    dry_run: bool,
) -> None:
    """Backfill RBAC app/dataset automatic workspace-member inclusion from old RBAC scope."""
    if resource_id and resource_type == "all":
        raise click.BadParameter("--resource-id requires --resource-type app or dataset", param_hint="--resource-id")

    click.echo(click.style("Starting RBAC resource whitelist scope migration.", fg="green"))

    scanned_count = 0
    migrated_count = 0
    member_policy_batch_count = 0
    owner_account_ids_by_tenant_id: dict[str, str] = {}

    for (
        current_resource_type,
        workspace_id,
        current_resource_id,
        maintainer_account_id,
    ) in _iter_selected_rbac_resource_rows(
        resource_type,
        tenant_id=tenant_id,
        resource_id=resource_id,
        batch_size=batch_size,
    ):
        scanned_count += 1
        with session_factory.create_session() as session:
            operator_account_id = maintainer_account_id or owner_account_ids_by_tenant_id.get(workspace_id)
            if not operator_account_id:
                operator_account_id = _owner_account_id(workspace_id, session=session)
                owner_account_ids_by_tenant_id[workspace_id] = operator_account_id

        legacy_config = _resource_legacy_whitelist_config(
            current_resource_type,
            tenant_id=workspace_id,
            operator_account_id=operator_account_id,
            resource_id=current_resource_id,
        )
        scope = _normalize_rbac_whitelist_scope(legacy_config.rbac_whitelist_scope)
        if scope is None:
            _emit_resource_whitelist_scope_migration_event(
                {
                    "event": "resource_whitelist_scope_migration_skipped",
                    "reason": "missing_legacy_scope",
                    "dry_run": dry_run,
                    "tenant_id": workspace_id,
                    "resource_type": current_resource_type,
                    "resource_id": current_resource_id,
                }
            )
            continue

        automatic_include_workspace_members = scope is RBACResourceWhitelistScope.ALL
        if scope is RBACResourceWhitelistScope.SPECIFIC:
            member_account_ids = sorted(set(legacy_config.account_ids))
            member_source = "legacy_specific_members"
        elif scope is RBACResourceWhitelistScope.ONLY_ME:
            member_account_ids = [maintainer_account_id] if maintainer_account_id else []
            member_source = "resource_maintainer"
        else:
            member_account_ids = []
            member_source = "workspace_members"

        _emit_resource_whitelist_scope_migration_event(
            {
                "event": "resource_whitelist_scope_migration_proposed_change",
                "dry_run": dry_run,
                "tenant_id": workspace_id,
                "operator_account_id": operator_account_id,
                "resource_type": current_resource_type,
                "resource_id": current_resource_id,
                "before": {
                    "rbac_whitelist_scope": scope.value,
                    "legacy_account_ids": sorted(set(legacy_config.account_ids)),
                },
                "after": {
                    "automatic_include_workspace_members": automatic_include_workspace_members,
                    "default_policy_member_source": member_source,
                    "default_policy_account_ids": member_account_ids,
                },
            }
        )

        if dry_run:
            continue

        _replace_resource_whitelist(
            current_resource_type,
            tenant_id=workspace_id,
            operator_account_id=operator_account_id,
            resource_id=current_resource_id,
            automatic_include_workspace_members=automatic_include_workspace_members,
        )
        migrated_count += 1

        if scope is RBACResourceWhitelistScope.ALL:
            for batch in _workspace_member_account_id_batches(workspace_id, member_batch_size):
                _replace_resource_default_access_policies(
                    current_resource_type,
                    tenant_id=workspace_id,
                    operator_account_id=operator_account_id,
                    resource_id=current_resource_id,
                    account_ids=batch,
                )
                member_policy_batch_count += 1
        else:
            _replace_resource_default_access_policies(
                current_resource_type,
                tenant_id=workspace_id,
                operator_account_id=operator_account_id,
                resource_id=current_resource_id,
                account_ids=member_account_ids,
            )
            if member_account_ids:
                member_policy_batch_count += 1

    if scanned_count == 0:
        click.echo(click.style("No RBAC resources found for migration.", fg="yellow"))
        return

    if dry_run:
        click.echo(
            click.style(
                f"Dry run completed. Scanned {scanned_count} RBAC resources. No RBAC bindings were written.",
                fg="yellow",
            )
        )
    else:
        click.echo(
            click.style(
                "RBAC resource whitelist scope migration completed. "
                f"Scanned {scanned_count} resources, migrated {migrated_count}, "
                f"wrote {member_policy_batch_count} default-policy batches.",
                fg="green",
            )
        )


@click.command(
    "rbac-migrate-resource-whitelist-scopes",
    help=(
        "Migrate RBAC app/dataset whitelist configs whose old scope is only_me to "
        "automatic_include_workspace_members=true and sync workspace members into the whitelist."
    ),
)
@click.option("--tenant-id", help="Only migrate resources in a single workspace.")
@click.option(
    "--resource-type",
    type=click.Choice(["app", "dataset", "all"]),
    default="all",
    show_default=True,
    help="Resource type to migrate.",
)
@click.option("--resource-id", help="Only migrate a single resource. Requires --resource-type app or dataset.")
@click.option("--batch-size", default=500, show_default=True, type=click.IntRange(min=1))
@click.option(
    "--member-batch-size",
    default=_RBAC_RESOURCE_ACCESS_POLICY_BATCH_SIZE,
    show_default=True,
    type=click.IntRange(min=1),
    help="Workspace members written per default-policy call.",
)
@click.option(
    "--dry-run/--apply",
    default=True,
    show_default=True,
    help="Preview the migration without writing RBAC bindings. Use --apply to write changes.",
)
def migrate_only_me_resource_whitelist_scopes_to_automatic_include(
    tenant_id: str | None,
    resource_type: str,
    resource_id: str | None,
    batch_size: int,
    member_batch_size: int,
    dry_run: bool,
) -> None:
    """Backfill automatic workspace-member inclusion for old RBAC only_me resource scopes."""
    if resource_id and resource_type == "all":
        raise click.BadParameter("--resource-id requires --resource-type app or dataset", param_hint="--resource-id")

    click.echo(click.style("Starting RBAC only_me resource whitelist scope migration.", fg="green"))

    scanned_count = 0
    only_me_count = 0
    migrated_count = 0
    member_policy_batch_count = 0
    owner_account_ids_by_tenant_id: dict[str, str] = {}

    for (
        current_resource_type,
        workspace_id,
        current_resource_id,
        maintainer_account_id,
    ) in _iter_selected_rbac_resource_rows(
        resource_type,
        tenant_id=tenant_id,
        resource_id=resource_id,
        batch_size=batch_size,
    ):
        scanned_count += 1
        with session_factory.create_session() as session:
            operator_account_id = maintainer_account_id or owner_account_ids_by_tenant_id.get(workspace_id)
            if not operator_account_id:
                operator_account_id = _owner_account_id(workspace_id, session=session)
                owner_account_ids_by_tenant_id[workspace_id] = operator_account_id

        legacy_config = _resource_legacy_whitelist_config(
            current_resource_type,
            tenant_id=workspace_id,
            operator_account_id=operator_account_id,
            resource_id=current_resource_id,
        )
        scope = _normalize_rbac_whitelist_scope(legacy_config.rbac_whitelist_scope)
        if scope is not RBACResourceWhitelistScope.ONLY_ME:
            continue

        only_me_count += 1
        _emit_resource_whitelist_scope_migration_event(
            {
                "event": "only_me_resource_whitelist_scope_migration_proposed_change",
                "dry_run": dry_run,
                "tenant_id": workspace_id,
                "operator_account_id": operator_account_id,
                "resource_type": current_resource_type,
                "resource_id": current_resource_id,
                "before": {
                    "rbac_whitelist_scope": scope.value,
                    "legacy_account_ids": sorted(set(legacy_config.account_ids)),
                },
                "after": {
                    "automatic_include_workspace_members": True,
                    "default_policy_member_source": "workspace_members",
                },
            }
        )

        if dry_run:
            continue

        _replace_resource_whitelist(
            current_resource_type,
            tenant_id=workspace_id,
            operator_account_id=operator_account_id,
            resource_id=current_resource_id,
            automatic_include_workspace_members=True,
        )
        migrated_count += 1

        for batch in _workspace_member_account_id_batches(workspace_id, member_batch_size):
            _replace_resource_default_access_policies(
                current_resource_type,
                tenant_id=workspace_id,
                operator_account_id=operator_account_id,
                resource_id=current_resource_id,
                account_ids=batch,
            )
            member_policy_batch_count += 1

    if scanned_count == 0:
        click.echo(click.style("No RBAC resources found for migration.", fg="yellow"))
        return

    if dry_run:
        click.echo(
            click.style(
                f"Dry run completed. Scanned {scanned_count} RBAC resources, found {only_me_count} only_me resources. "
                "No RBAC bindings were written.",
                fg="yellow",
            )
        )
    else:
        click.echo(
            click.style(
                "RBAC only_me resource whitelist scope migration completed. "
                f"Scanned {scanned_count} resources, migrated {migrated_count}, "
                f"wrote {member_policy_batch_count} default-policy batches.",
                fg="green",
            )
        )


@click.command(
    "rbac-migrate-dataset-permissions",
    help=(
        "Migrate legacy dataset permission scopes and partial members into RBAC dataset access bindings. "
        "Side effect: replacing each dataset whitelist clears existing per-user policy bindings; "
        "the command then recreates legacy partial-member default bindings."
    ),
)
@click.option("--tenant-id", help="Only migrate datasets in a single workspace.")
@click.option("--dataset-id", help="Only migrate a single dataset.")
@click.option("--batch-size", default=500, show_default=True, type=click.IntRange(min=1))
@click.option(
    "--dry-run/--apply",
    default=True,
    show_default=True,
    help="Preview the migration without writing RBAC bindings. Use --apply to write changes.",
)
def migrate_dataset_permissions_to_rbac(
    tenant_id: str | None,
    dataset_id: str | None,
    batch_size: int,
    dry_run: bool,
) -> None:
    """Backfill RBAC dataset access config from legacy `Dataset.permission`.

    Legacy mapping:
    - all_team_members -> RBAC dataset whitelist scope "all"
    - partial_members  -> RBAC dataset whitelist scope "specific" plus each partial member gets the
      virtual default policy
    - only_me          -> RBAC dataset whitelist scope "specific" with no member policy bindings

    The command replaces each dataset's RBAC whitelist scope first. RBAC clears
    existing per-user policy bindings during that replace, then this command
    recreates the legacy partial-member default bindings. Re-running it is
    therefore idempotent for a dataset's current legacy configuration.
    """
    click.echo(click.style("Starting RBAC dataset permission migration.", fg="green"))

    scanned_count = 0
    scope_migrated_count = 0
    user_policy_migrated_count = 0
    partial_dataset_count = 0

    last_dataset_id: str | None = None
    while True:
        with session_factory.create_session() as session:
            stmt = (
                select(Dataset.id, Dataset.tenant_id, Dataset.permission, Dataset.created_by)
                .order_by(Dataset.id.asc())
                .limit(batch_size)
            )
            if tenant_id:
                stmt = stmt.where(Dataset.tenant_id == tenant_id)
            if dataset_id:
                stmt = stmt.where(Dataset.id == dataset_id)
            if last_dataset_id:
                stmt = stmt.where(Dataset.id > last_dataset_id)

            dataset_rows = list(session.execute(stmt).all())
            if not dataset_rows:
                break

            dataset_ids = [str(row.id) for row in dataset_rows]
            partial_members_by_dataset_id: dict[str, list[str]] = {item: [] for item in dataset_ids}
            permission_rows = session.execute(
                select(DatasetPermission.dataset_id, DatasetPermission.account_id).where(
                    DatasetPermission.dataset_id.in_(dataset_ids)
                )
            ).all()
            for row in permission_rows:
                partial_members_by_dataset_id[str(row.dataset_id)].append(str(row.account_id))

        for dataset in dataset_rows:
            workspace_id = str(dataset.tenant_id)
            current_dataset_id = str(dataset.id)
            operator_account_id = str(dataset.created_by)
            permission_value = _dataset_permission_enum(dataset.permission)
            scope = _rbac_dataset_scope_for_legacy_permission(permission_value)
            partial_member_ids = sorted(set(partial_members_by_dataset_id[current_dataset_id]))
            should_bind_partial_members = permission_value is DatasetPermissionEnum.PARTIAL_TEAM

            click.echo(
                f"tenant={workspace_id} dataset={current_dataset_id} "
                f"operator={operator_account_id} "
                f"legacy_permission={permission_value} -> rbac_scope={scope} "
                f"partial_members={len(partial_member_ids) if should_bind_partial_members else 0}"
            )

            scanned_count += 1
            replace_whitelist_payload = ReplaceMemberBindings(
                automatic_include_workspace_members=scope is RBACResourceWhitelistScope.ALL
            )
            if dry_run:
                _emit_dataset_permission_migration_event(
                    {
                        "event": "dataset_permission_migration_proposed_change",
                        "action": "replace_whitelist",
                        "dry_run": True,
                        "tenant_id": workspace_id,
                        "dataset_id": current_dataset_id,
                        "operator_account_id": operator_account_id,
                        "before": {
                            "legacy_dataset_permission": permission_value.value,
                            "legacy_partial_member_ids": partial_member_ids if should_bind_partial_members else [],
                        },
                        "after": {
                            "rbac_whitelist_scope": scope.value,
                        },
                        "call": {
                            "method": "RBACService.DatasetAccess.replace_whitelist",
                            "kwargs": {
                                "tenant_id": workspace_id,
                                "account_id": operator_account_id,
                                "dataset_id": current_dataset_id,
                                "payload": replace_whitelist_payload.model_dump(mode="json"),
                            },
                        },
                    }
                )
            if not dry_run:
                RBACService.DatasetAccess.replace_whitelist(
                    tenant_id=workspace_id,
                    account_id=operator_account_id,
                    dataset_id=current_dataset_id,
                    payload=replace_whitelist_payload,
                )
                scope_migrated_count += 1

            if should_bind_partial_members:
                partial_dataset_count += 1
                for member_account_id in partial_member_ids:
                    replace_user_access_policies_payload = ReplaceUserAccessPolicies(
                        access_policy_ids=[_RBAC_DEFAULT_ACCESS_POLICY_ID],
                    )
                    if dry_run:
                        _emit_dataset_permission_migration_event(
                            {
                                "event": "dataset_permission_migration_proposed_change",
                                "action": "replace_user_access_policies",
                                "dry_run": True,
                                "tenant_id": workspace_id,
                                "dataset_id": current_dataset_id,
                                "operator_account_id": operator_account_id,
                                "target_account_id": member_account_id,
                                "before": {
                                    "legacy_dataset_permission": permission_value.value,
                                    "legacy_partial_member_id": member_account_id,
                                },
                                "after": {
                                    "rbac_user_access_policy_ids": [_RBAC_DEFAULT_ACCESS_POLICY_ID],
                                },
                                "call": {
                                    "method": "RBACService.DatasetAccess.replace_user_access_policies",
                                    "kwargs": {
                                        "tenant_id": workspace_id,
                                        "account_id": operator_account_id,
                                        "dataset_id": current_dataset_id,
                                        "target_account_id": member_account_id,
                                        "payload": replace_user_access_policies_payload.model_dump(
                                            mode="json", exclude_unset=True
                                        ),
                                    },
                                },
                            }
                        )
                        continue
                    RBACService.DatasetAccess.replace_user_access_policies(
                        tenant_id=workspace_id,
                        account_id=operator_account_id,
                        dataset_id=current_dataset_id,
                        target_account_id=member_account_id,
                        payload=replace_user_access_policies_payload,
                    )
                    user_policy_migrated_count += 1

        last_dataset_id = dataset_ids[-1]

        if dataset_id:
            break

    if scanned_count == 0:
        click.echo(click.style("No datasets found for migration.", fg="yellow"))
        return

    if dry_run:
        click.echo(
            click.style(
                f"Dry run completed. Scanned {scanned_count} datasets; "
                f"{partial_dataset_count} partial-member datasets would be migrated.",
                fg="yellow",
            )
        )
    else:
        click.echo(
            click.style(
                "RBAC dataset permission migration completed. "
                f"Scanned {scanned_count} datasets, migrated {scope_migrated_count} scopes, "
                f"wrote {user_policy_migrated_count} user default-policy bindings.",
                fg="green",
            )
        )


def _iter_agent_rows(tenant_id: str, batch_size: int) -> Iterator[tuple[str, str | None, str | None]]:
    """Yield `(agent_id, created_by, backing_app_id)` for one tenant's live agents.

    Archived agents are excluded: they are hidden from the roster, so bootstrapping
    access rows for them would only add noise.
    """
    last_agent_id: str | None = None
    while True:
        with session_factory.create_session() as session:
            stmt = (
                select(Agent.id, Agent.created_by, Agent.backing_app_id)
                .where(Agent.tenant_id == tenant_id, Agent.status != AgentStatus.ARCHIVED)
                .order_by(Agent.id.asc())
                .limit(batch_size)
            )
            if last_agent_id:
                stmt = stmt.where(Agent.id > last_agent_id)

            rows = list(session.execute(stmt).all())
            if not rows:
                return

        for row in rows:
            yield (
                str(row.id),
                str(row.created_by) if row.created_by else None,
                str(row.backing_app_id) if row.backing_app_id else None,
            )

        last_agent_id = str(rows[-1].id)


@dataclass
class _AgentAccessBootstrapCounts:
    changed: int = 0
    already_initialized: int = 0


@dataclass(frozen=True)
class _AgentAccessBootstrapOptions:
    tenant_id: str
    agent_id: str
    creator_account_id: str | None
    backing_app_id: str | None
    operator_account_id: str
    member_batch_size: int
    apply: bool


def _agent_access_is_initialized(
    configured: bool | None,
    scope: RBACResourceWhitelistScope,
    account_ids: list[str],
) -> bool:
    """Decide whether the RBAC service already holds a real access row for this agent.

    A current RBAC service answers with `configured`, which says outright whether a stored
    scope row backs the response; when it is there it is the only signal worth trusting.

    An older service omits it. It then answers the whitelist read for an unknown agent with
    the same default body a freshly bootstrapped agent has (`scope=all`, auto-include on)
    and no member ids, so the config alone cannot tell them apart. Anything else — a
    narrowed scope, or seeded default-policy members — can only come from a stored row.
    """
    fabricated_default_body = scope is RBACResourceWhitelistScope.ALL and not account_ids
    return not fabricated_default_body if configured is None else configured


def _report_backing_app_specific_whitelist(options: _AgentAccessBootstrapOptions) -> None:
    """Flag a backing App whose members were hand-picked; the operator decides what to copy."""
    if not options.backing_app_id:
        return
    app_config = _resource_legacy_whitelist_config(
        "app",
        tenant_id=options.tenant_id,
        operator_account_id=options.operator_account_id,
        resource_id=options.backing_app_id,
    )
    if _normalize_rbac_whitelist_scope(app_config.rbac_whitelist_scope) is not RBACResourceWhitelistScope.SPECIFIC:
        return
    _emit_agent_migration_event(
        {
            "event": _AGENT_BACKING_APP_SPECIFIC_WHITELIST_EVENT,
            "dry_run": not options.apply,
            "tenant_id": options.tenant_id,
            "agent_id": options.agent_id,
            "app_id": options.backing_app_id,
            "backing_app_account_ids": sorted(set(app_config.account_ids)),
        }
    )


# The scope row is written last on purpose: only `replace_whitelist` creates it, and every step
# before it is a replace, so a failure part-way leaves `configured=false` and the next run redoes
# this agent from the start instead of mistaking a half-seeded agent for a finished one.
def _write_agent_access_rows(options: _AgentAccessBootstrapOptions) -> None:
    for batch in _workspace_member_account_id_batches(options.tenant_id, options.member_batch_size):
        RBACService.AgentAccess.replace_user_access_policies(
            tenant_id=options.tenant_id,
            account_id=options.operator_account_id,
            agent_id=options.agent_id,
            target_account_id=None,
            payload=ReplaceUserAccessPolicies(
                access_policy_ids=[_RBAC_DEFAULT_ACCESS_POLICY_ID],
                account_ids=batch,
            ),
        )
    if options.creator_account_id:
        RBACService.AccessPolicies.sync_creator_access_policy_member_bindings(
            tenant_id=options.tenant_id,
            account_id=options.creator_account_id,
            resource_type=RBACResourceType.AGENT,
            resource_id=options.agent_id,
        )
    RBACService.AgentAccess.replace_whitelist(
        tenant_id=options.tenant_id,
        account_id=options.operator_account_id,
        agent_id=options.agent_id,
        payload=ReplaceMemberBindings(automatic_include_workspace_members=True),
    )


def _emit_agent_access_bootstrap_skipped(
    options: _AgentAccessBootstrapOptions,
    reason: _AgentAccessBootstrapReason,
) -> None:
    _emit_agent_migration_event(
        {
            "event": _AGENT_ACCESS_BOOTSTRAP_EVENT_KIND.skipped,
            "reason": reason.value,
            "dry_run": not options.apply,
            "tenant_id": options.tenant_id,
            "agent_id": options.agent_id,
            "operator_account_id": options.operator_account_id,
        }
    )


def _bootstrap_agent_access(options: _AgentAccessBootstrapOptions, counts: _AgentAccessBootstrapCounts) -> None:
    """Give one pre-existing agent the access rows a newly created agent gets."""
    config = RBACService.AgentAccess.legacy_whitelist_config(
        tenant_id=options.tenant_id,
        account_id=options.operator_account_id,
        agent_id=options.agent_id,
    )
    scope = _normalize_rbac_whitelist_scope(config.rbac_whitelist_scope)
    if scope is None:
        _emit_agent_access_bootstrap_skipped(options, _AgentAccessBootstrapReason.MISSING_WHITELIST_SCOPE)
        return

    account_ids = sorted(set(config.account_ids))
    if _agent_access_is_initialized(config.configured, scope, account_ids):
        counts.already_initialized += 1
        _emit_agent_access_bootstrap_skipped(options, _AgentAccessBootstrapReason.ALREADY_INITIALIZED)
        return

    _report_backing_app_specific_whitelist(options)

    if options.apply:
        try:
            _write_agent_access_rows(options)
        except Exception as exc:
            _emit_agent_migration_event(
                {
                    "event": _AGENT_ACCESS_BOOTSTRAP_EVENT_KIND.failed,
                    "tenant_id": options.tenant_id,
                    "agent_id": options.agent_id,
                    "error": str(exc),
                }
            )
            raise click.ClickException(f"tenant {options.tenant_id} agent {options.agent_id}: {exc}") from exc
    counts.changed += 1

    event: dict[str, object] = {
        "event": _AGENT_ACCESS_BOOTSTRAP_EVENT_KIND.outcome(apply=options.apply),
        "dry_run": not options.apply,
        "tenant_id": options.tenant_id,
        "agent_id": options.agent_id,
        "operator_account_id": options.operator_account_id,
        "before": {"rbac_whitelist_scope": scope.value, "whitelist_account_ids": account_ids},
        "after": {
            "automatic_include_workspace_members": True,
            "default_policy_member_source": _AGENT_ACCESS_BOOTSTRAP_MEMBER_SOURCE,
            "creator_access_policy_synced": bool(options.creator_account_id),
        },
    }
    if not options.creator_account_id:
        event["reason"] = _AgentAccessBootstrapReason.NO_CREATOR.value
    _emit_agent_migration_event(event)


def _bootstrap_tenant_agent_access(
    tenant_id: str,
    *,
    agent_batch_size: int,
    member_batch_size: int,
    apply: bool,
    counts: _AgentAccessBootstrapCounts,
) -> None:
    owner_account_id: str | None = None
    for agent_id, creator_account_id, backing_app_id in _iter_agent_rows(tenant_id, agent_batch_size):
        if creator_account_id is None and owner_account_id is None:
            with session_factory.create_session() as session:
                owner_account_id = _owner_account_id(tenant_id, session=session)
        operator_account_id = creator_account_id or owner_account_id
        if not operator_account_id:
            raise click.ClickException(f"tenant {tenant_id} agent {agent_id}: no operator account")
        _bootstrap_agent_access(
            _AgentAccessBootstrapOptions(
                tenant_id=tenant_id,
                agent_id=agent_id,
                creator_account_id=creator_account_id,
                backing_app_id=backing_app_id,
                operator_account_id=operator_account_id,
                member_batch_size=member_batch_size,
                apply=apply,
            ),
            counts,
        )


@click.command(
    "rbac-migrate-agent-permissions",
    help=(
        "Upgrade step for agent RBAC. Phase 1 asks the RBAC service to replace agent.manage on every "
        "custom role with agent.create plus the agent.full_access binding. Phase 2 bootstraps the access "
        "rows pre-existing agents never got, so they stay visible to workspace members. On an RBAC "
        "service too old to report whether a scope row exists, an agent whose scope was set to all "
        "with no members by hand is indistinguishable from an uninitialised one and will be re-seeded. "
        "Dry run by default."
    ),
)
@click.option("--tenant-id", help="Only migrate a single workspace.")
@click.option(
    "--batch-size",
    default=500,
    show_default=True,
    type=click.IntRange(min=1),
    help="Tenants fetched per database batch.",
)
@click.option(
    "--agent-batch-size",
    default=500,
    show_default=True,
    type=click.IntRange(min=1),
    help="Agents fetched per database batch.",
)
@click.option(
    "--member-batch-size",
    default=_RBAC_RESOURCE_ACCESS_POLICY_BATCH_SIZE,
    show_default=True,
    type=click.IntRange(min=1),
    help="Workspace members written per default-policy call when bootstrapping an agent.",
)
@click.option("--apply", is_flag=True, default=False, help="Write changes. Without it nothing is written.")
def migrate_agent_permissions_to_rbac(
    tenant_id: str | None,
    batch_size: int,
    agent_batch_size: int,
    member_batch_size: int,
    apply: bool,
) -> None:
    click.echo(click.style("Starting agent RBAC migration: custom roles holding agent.manage.", fg="green"))
    tenant_count = 0
    role_count = 0
    skipped_count = 0
    seen_template_ids: set[str] = set()
    template_count = 0
    agent_counts = _AgentAccessBootstrapCounts()
    for workspace_id in _iter_tenant_ids(tenant_id, batch_size=batch_size):
        tenant_count += 1
        try:
            report = RBACService.Migrations.migrate_agent_manage_roles(workspace_id, apply=apply)
        except Exception as exc:
            raise click.ClickException(f"tenant {workspace_id}: {exc}") from exc
        for entry in report.roles:
            role_count += 1
            if entry.skipped:
                skipped_count += 1
            _emit_agent_migration_event(
                _agent_manage_role_event(workspace_id, entry, apply=apply, kind=_AGENT_ROLE_MIGRATION_EVENT_KIND)
            )
        for template in report.role_templates:
            if template.role_id in seen_template_ids:
                continue
            seen_template_ids.add(template.role_id)
            template_count += 1
            _emit_agent_migration_event(
                _agent_manage_role_event(None, template, apply=apply, kind=_AGENT_ROLE_TEMPLATE_MIGRATION_EVENT_KIND)
            )
        _bootstrap_tenant_agent_access(
            workspace_id,
            agent_batch_size=agent_batch_size,
            member_batch_size=member_batch_size,
            apply=apply,
            counts=agent_counts,
        )
    role_state = _AGENT_MIGRATION_STATE_LABEL[apply]
    click.echo(
        f"{tenant_count} tenant(s), {role_count} role(s) {role_state}, {skipped_count} skipped, "
        f"{template_count} template(s) {role_state}, "
        f"{agent_counts.changed} agent(s) {role_state}, "
        f"{agent_counts.already_initialized} already initialised"
    )
    if not apply:
        click.echo(click.style("Dry run: no changes written. Re-run with --apply.", fg="yellow"))
