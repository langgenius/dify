from __future__ import annotations

import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed

import click
from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from core.db.session_factory import session_factory
from core.rbac import RBACResourceWhitelistScope
from models import App, Dataset, DatasetPermission, DatasetPermissionEnum, TenantAccountJoin, TenantAccountRole
from services.enterprise.rbac_service import ListOption, RBACService, ReplaceMemberBindings, ReplaceUserAccessPolicies

_RBAC_DEFAULT_ACCESS_POLICY_ID = "default"
_RBAC_RESOURCE_ACCESS_POLICY_BATCH_SIZE = 500

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
