"""Permission projections for the built-in workspace roles."""

from enums.account import TenantAccountRole
from services.rbac.contracts import (
    ListOption,
    MemberRolesResponse,
    MyPermissionsResponse,
    Paginated,
    Pagination,
    RBACRole,
    RBACRoleType,
    ResourcePermissionSnapshot,
    WorkspacePermissionSnapshot,
)

# Fallback permission snapshots for legacy Dify tenant roles when external RBAC is disabled.
# Keep these keys aligned with langgenius/rbac's built-in workspace roles and access policies.
_BUILTIN_WORKSPACE_OWNER_KEYS: list[str] = [
    "skill.view",
    "skill.edit",
    "skill.publish",
    "skill.delete",
    "workspace.member.manage",
    "workspace.role.manage",
    "data_source.manage",
    "api_extension.manage",
    "customization.manage",
    "plugin.install",
    "plugin.plugin_preferences",
    "plugin.model_config",
    "plugin.delete",
    "plugin.debug",
    "credential.use",
    "credential.create",
    "credential.manage",
    "app.acl.preview",
    "app_library.access",
    "app.create_and_management",
    "app.tag.manage",
    "dataset.acl.preview",
    "dataset.create_and_management",
    "dataset.tag.manage",
    "dataset.external.connect",
    "dataset.api_key.manage",
    "snippets.create_and_modify",
    "snippets.management",
    "tool.manage",
    "mcp.manage",
    "agent.create",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_BUILTIN_WORKSPACE_ADMIN_KEYS: list[str] = [
    "skill.view",
    "skill.edit",
    "skill.publish",
    "skill.delete",
    "workspace.member.manage",
    "workspace.role.manage",
    "data_source.manage",
    "api_extension.manage",
    "customization.manage",
    "plugin.install",
    "plugin.plugin_preferences",
    "plugin.model_config",
    "plugin.delete",
    "plugin.debug",
    "credential.use",
    "credential.create",
    "credential.manage",
    "app_library.access",
    "app.create_and_management",
    "app.tag.manage",
    "dataset.create_and_management",
    "dataset.tag.manage",
    "dataset.external.connect",
    "dataset.api_key.manage",
    "snippets.create_and_modify",
    "snippets.management",
    "tool.manage",
    "mcp.manage",
    "agent.create",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_BUILTIN_WORKSPACE_EDITOR_KEYS: list[str] = [
    "skill.view",
    "skill.edit",
    "skill.publish",
    "skill.delete",
    "api_extension.manage",
    "plugin.install",
    "credential.use",
    "app_library.access",
    "app.create_and_management",
    "app.tag.manage",
    "dataset.create_and_management",
    "dataset.tag.manage",
    "dataset.external.connect",
    "snippets.create_and_modify",
    "tool.manage",
    "agent.create",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_BUILTIN_WORKSPACE_NORMAL_KEYS: list[str] = [
    "skill.view",
    "api_extension.manage",
    "plugin.install",
    "credential.use",
    "app_library.access",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_BUILTIN_WORKSPACE_DATASET_OPERATOR_KEYS: list[str] = [
    "skill.view",
    "plugin.install",
    "dataset.create_and_management",
    "dataset.external.connect",
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_BUILTIN_APP_OWNER_KEYS: list[str] = [
    "app.acl.preview",
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.import_export_dsl",
    "app.acl.delete",
    "app.acl.release_and_version",
    "app.acl.monitor",
    "app.acl.access_config",
    "app.acl.tracing_config",
    "app.acl.log_and_annotation",
    "app.acl.access_point_manage",
    "app.acl.access_point_view",
]

_BUILTIN_APP_ADMIN_KEYS: list[str] = [
    "app.acl.preview",
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.import_export_dsl",
    "app.acl.delete",
    "app.acl.release_and_version",
    "app.acl.monitor",
    "app.acl.access_config",
    "app.acl.access_config",
    "app.acl.tracing_config",
    "app.acl.log_and_annotation",
    "app.acl.access_point_manage",
    "app.acl.access_point_view",
]

_BUILTIN_APP_EDITOR_KEYS: list[str] = [
    "app.acl.preview",
    "app.acl.view_layout",
    "app.acl.test_and_run",
    "app.acl.edit",
    "app.acl.import_export_dsl",
    "app.acl.delete",
    "app.acl.release_and_version",
    "app.acl.monitor",
    "app.acl.log_and_annotation",
    "app.acl.access_config",
    "app.acl.access_point_manage",
    "app.acl.access_point_view",
]

_BUILTIN_APP_NORMAL_KEYS: list[str] = [
    "app.acl.monitor",
    "app.acl.access_point_view",
]

_BUILTIN_APP_DATASET_OPERATOR_KEYS: list[str] = [
    "app.acl.access_point_view",
]

_BUILTIN_DATASET_OWNER_KEYS: list[str] = [
    "dataset.acl.preview",
    "dataset.acl.readonly",
    "dataset.acl.edit",
    "dataset.acl.import_export_dsl",
    "dataset.acl.pipeline_test",
    "dataset.acl.document_download",
    "dataset.acl.retrieval_recall",
    "dataset.acl.use",
    "dataset.acl.delete_file",
    "dataset.acl.pipeline_release",
    "dataset.acl.delete",
    "dataset.acl.access_config",
    "dataset.api_key.manage",
]

_BUILTIN_DATASET_ADMIN_KEYS: list[str] = [
    "dataset.acl.preview",
    "dataset.acl.readonly",
    "dataset.acl.edit",
    "dataset.acl.import_export_dsl",
    "dataset.acl.pipeline_test",
    "dataset.acl.document_download",
    "dataset.acl.retrieval_recall",
    "dataset.acl.use",
    "dataset.acl.delete_file",
    "dataset.acl.pipeline_release",
    "dataset.acl.delete",
    "dataset.acl.access_config",
    "dataset.api_key.manage",
]

_BUILTIN_DATASET_EDITOR_KEYS: list[str] = [
    "dataset.acl.preview",
    "dataset.acl.readonly",
    "dataset.acl.edit",
    "dataset.acl.import_export_dsl",
    "dataset.acl.pipeline_test",
    "dataset.acl.document_download",
    "dataset.acl.retrieval_recall",
    "dataset.acl.use",
    "dataset.acl.delete_file",
    "dataset.acl.pipeline_release",
]

_BUILTIN_DATASET_DATASET_OPERATOR_KEYS: list[str] = [
    "dataset.acl.readonly",
    "dataset.acl.edit",
    "dataset.acl.import_export_dsl",
    "dataset.acl.pipeline_test",
    "dataset.acl.document_download",
    "dataset.acl.retrieval_recall",
    "dataset.acl.use",
    "dataset.acl.delete_file",
    "dataset.acl.pipeline_release",
]

_BUILTIN_AGENT_FULL_ACCESS_KEYS: list[str] = [
    "agent.acl.preview",
    "agent.acl.edit",
    "agent.acl.test_and_run",
    "agent.acl.release_and_version",
    "agent.acl.access_point_view",
    "agent.acl.access_point_manage",
    "agent.acl.log_manage",
    "agent.acl.monitor",
    "agent.acl.access_config",
    "agent.acl.import_export_dsl",
    "agent.acl.delete",
]

_BUILTIN_AGENT_PREVIEW_KEYS: list[str] = [
    "agent.acl.preview",
    "agent.acl.access_point_view",
]

_BUILTIN_MY_PERMISSIONS: dict[TenantAccountRole, dict[str, list[str]]] = {
    TenantAccountRole.OWNER: {
        "workspace": _BUILTIN_WORKSPACE_OWNER_KEYS,
        "app": _BUILTIN_APP_OWNER_KEYS,
        "dataset": _BUILTIN_DATASET_OWNER_KEYS,
        "agent": _BUILTIN_AGENT_FULL_ACCESS_KEYS,
    },
    TenantAccountRole.ADMIN: {
        "workspace": _BUILTIN_WORKSPACE_ADMIN_KEYS,
        "app": _BUILTIN_APP_ADMIN_KEYS,
        "dataset": _BUILTIN_DATASET_ADMIN_KEYS,
        "agent": _BUILTIN_AGENT_FULL_ACCESS_KEYS,
    },
    TenantAccountRole.EDITOR: {
        "workspace": _BUILTIN_WORKSPACE_EDITOR_KEYS,
        "app": _BUILTIN_APP_EDITOR_KEYS,
        "dataset": _BUILTIN_DATASET_EDITOR_KEYS,
        "agent": _BUILTIN_AGENT_FULL_ACCESS_KEYS,
    },
    TenantAccountRole.NORMAL: {
        "workspace": _BUILTIN_WORKSPACE_NORMAL_KEYS,
        "app": _BUILTIN_APP_NORMAL_KEYS,
        "agent": _BUILTIN_AGENT_PREVIEW_KEYS,
    },
    TenantAccountRole.DATASET_OPERATOR: {
        "workspace": _BUILTIN_WORKSPACE_DATASET_OPERATOR_KEYS,
        "app": _BUILTIN_APP_DATASET_OPERATOR_KEYS,
        "dataset": _BUILTIN_DATASET_DATASET_OPERATOR_KEYS,
        "agent": _BUILTIN_AGENT_PREVIEW_KEYS,
    },
}


def builtin_role_permission_keys(role: TenantAccountRole) -> list[str]:
    permissions = _BUILTIN_MY_PERMISSIONS.get(role, {})
    return list(
        dict.fromkeys(
            [
                *permissions.get("workspace", []),
                *permissions.get("app", []),
                *permissions.get("dataset", []),
                *permissions.get("agent", []),
            ]
        )
    )


def builtin_member_roles(
    tenant_id: str, member_account_id: str, role: TenantAccountRole | str | None
) -> MemberRolesResponse:
    if not role:
        return MemberRolesResponse(account_id=member_account_id, roles=[])

    tenant_role = TenantAccountRole(role)
    role_value = tenant_role.value
    return MemberRolesResponse(
        account_id=member_account_id,
        roles=[
            RBACRole(
                id=role_value,
                name=role_value,
                description="",
                is_builtin=True,
                type="",
                permission_keys=builtin_role_permission_keys(tenant_role),
                role_tag="owner" if tenant_role == TenantAccountRole.OWNER else role_value,
                tenant_id=tenant_id,
            )
        ],
    )


def builtin_permissions(role: TenantAccountRole | str | None) -> MyPermissionsResponse:
    try:
        permissions = _BUILTIN_MY_PERMISSIONS.get(TenantAccountRole(role), {}) if role else {}
    except ValueError:
        permissions = {}
    return MyPermissionsResponse(
        workspace=WorkspacePermissionSnapshot(permission_keys=list(permissions.get("workspace", []))),
        app=ResourcePermissionSnapshot(default_permission_keys=list(permissions.get("app", []))),
        dataset=ResourcePermissionSnapshot(default_permission_keys=list(permissions.get("dataset", []))),
        agent=ResourcePermissionSnapshot(default_permission_keys=list(permissions.get("agent", []))),
    )


_BUILTIN_ROLE_PERMISSION_KEYS: dict[str, list[str]] = {
    # This is a compatibility projection from the pre-RBAC workspace roles into
    # the 2.0 permission matrix documented in "权限整理2.0". It intentionally
    # models the product-facing role surface for the new RBAC UI instead of the
    # legacy backend's exact hard-authorization checks.
    "owner": [
        *_BUILTIN_WORKSPACE_OWNER_KEYS,
        *_BUILTIN_APP_OWNER_KEYS,
        *_BUILTIN_DATASET_OWNER_KEYS,
    ],
    "admin": [
        *_BUILTIN_WORKSPACE_ADMIN_KEYS,
        *_BUILTIN_APP_ADMIN_KEYS,
        *_BUILTIN_DATASET_ADMIN_KEYS,
    ],
    "editor": [
        *_BUILTIN_WORKSPACE_EDITOR_KEYS,
        *_BUILTIN_APP_EDITOR_KEYS,
        *_BUILTIN_DATASET_EDITOR_KEYS,
    ],
    "normal": [
        *_BUILTIN_WORKSPACE_NORMAL_KEYS,
        *_BUILTIN_APP_NORMAL_KEYS,
    ],
    "dataset_operator": [
        *_BUILTIN_WORKSPACE_DATASET_OPERATOR_KEYS,
        *_BUILTIN_DATASET_DATASET_OPERATOR_KEYS,
    ],
}


def builtin_workspace_roles(
    options: ListOption, *, include_owner: int, dataset_operator_enabled: bool
) -> Paginated[RBACRole]:
    """Return the built-in legacy workspace roles in the RBAC list shape.

    This keeps the new `/rbac/roles` endpoint compatible with the original
    Dify role model when enterprise RBAC is disabled.
    """
    legacy_roles = []
    for role_name in ("owner", "admin", "editor", "normal", "dataset_operator"):
        if not dataset_operator_enabled and role_name == "dataset_operator":
            continue

        legacy_roles.append(
            RBACRole(
                id=role_name,
                tenant_id="",
                type=RBACRoleType.WORKSPACE.value,
                category="global_system_default",
                name=role_name,
                description="",
                is_builtin=True,
                permission_keys=list(_BUILTIN_ROLE_PERMISSION_KEYS[role_name]),
                role_tag="owner" if role_name == "owner" else "",
            )
        )

    if not include_owner:
        legacy_roles = [r for r in legacy_roles if r.name != "owner"]

    page_number = options.page_number if options.page_number is not None else 1
    results_per_page = options.results_per_page if options.results_per_page is not None else len(legacy_roles)
    reverse = options.reverse if options.reverse is not None else False

    ordered_roles = list(reversed(legacy_roles)) if reverse else legacy_roles
    start = max(page_number - 1, 0) * results_per_page
    end = start + results_per_page
    paged_roles = ordered_roles[start:end]
    total_count = len(legacy_roles)
    total_pages = (total_count + results_per_page - 1) // results_per_page if results_per_page > 0 else 0

    return Paginated[RBACRole](
        data=paged_roles,
        pagination=Pagination(
            total_count=total_count,
            per_page=results_per_page,
            current_page=page_number,
            total_pages=total_pages,
        ),
    )
