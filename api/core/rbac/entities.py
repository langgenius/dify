from enum import StrEnum


class RBACResourceScope(StrEnum):
    """Resource scopes accepted by the ``rbac_permission_required`` decorator.

    ``WORKSPACE`` denotes a workspace-level check that carries no concrete
    resource id; ``APP`` and ``DATASET`` are resource-scoped checks.
    """

    APP = "app"
    DATASET = "dataset"
    WORKSPACE = "workspace"


class RBACPermission(StrEnum):
    """Permission points (RBAC scenes) checked by ``rbac_permission_required``.

    Each member's value is the scene name forwarded to the RBAC
    ``check-access`` endpoint.
    """

    APP_VIEW_LAYOUT = "app_view_layout"
    APP_TEST_AND_RUN = "app_test_and_run"
    APP_CREATE_AND_MANAGEMENT = "app_create_and_management"
    APP_RELEASE_AND_VERSION = "app_release_and_version"
    APP_IMPORT_EXPORT_DSL = "app_import_export_dsl"
    APP_EDIT = "app_edit"
    APP_MONITOR = "app_monitor"
    APP_DELETE = "app_delete"

    DATASET_READONLY = "dataset_readonly"
    DATASET_EDIT = "dataset_edit"
    DATASET_CREATE_AND_MANAGEMENT = "dataset_create_and_management"
    DATASET_PIPELINE_TEST = "dataset_pipeline_test"
    DATASET_DOCUMENT_DOWNLOAD = "dataset_document_download"
    DATASET_API_KEY_MANAGE = "dataset_api_key_manage"
    DATASET_EXTERNAL_CONNECT = "dataset_external_connect"
    DATASET_IMPORT_EXPORT_DSL = "dataset_import_export_dsl"

    WORKSPACE_ROLE_MANAGE = "workspace_role_manage"

    SNIPPETS_CREATE_AND_MODIFY = "snippets_create_and_modify"
    SNIPPETS_MANAGE = "snippets_management"

    PLUGIN_INSTALL = "plugin_install"
    PLUGIN_PREFERENCES = "plugin_preferences"
    PLUGIN_MANAGE = "plugin_manage"
    PLUGIN_DEBUG = "plugin_debug"

    CREDENTIAL_USE = "credential_use"
    CREDENTIAL_MANAGE = "credential_manage"

    TOOL_MANAGE = "tool_manage"
    MCP_MANAGE = "mcp_manage"
