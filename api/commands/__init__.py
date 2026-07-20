"""
CLI command modules extracted from `commands.py`.
"""

from .account import create_tenant, reset_email, reset_password
from .data_migrate import data_migrate, legacy_model_types
from .data_migration import (
    export_migration_data,
    export_migration_data_template,
    import_migration_data,
    migration_data_wizard,
)
from .plugin import (
    backfill_plugin_auto_upgrade,
    extract_plugins,
    extract_unique_plugins,
    install_plugins,
    install_rag_pipeline_plugins,
    migrate_data_for_plugin,
    setup_datasource_oauth_client,
    setup_system_tool_oauth_client,
    setup_system_trigger_oauth_client,
    transform_datasource_credentials,
)
from .rbac import migrate_dataset_permissions_to_rbac, migrate_member_roles_to_rbac
from .retention import (
    archive_workflow_runs,
    archive_workflow_runs_plan,
    backfill_workflow_run_archive_bundles,
    clean_expired_messages,
    clean_workflow_runs,
    cleanup_orphaned_draft_variables,
    clear_free_plan_tenant_expired_logs,
    delete_archived_workflow_runs,
    export_app_messages,
    restore_workflow_runs,
)
from .storage import clear_orphaned_file_records, file_usage, migrate_oss, remove_orphaned_files_on_storage
from .system import (
    convert_to_agent_apps,
    fix_app_site_missing,
    reset_encrypt_key_pair,
    upgrade_db,
)
from .vector import (
    add_qdrant_index,
    migrate_annotation_vector_database,
    migrate_knowledge_vector_database,
    old_metadata_migration,
    vdb_migrate,
)

__all__ = [
    "add_qdrant_index",
    "archive_workflow_runs",
    "archive_workflow_runs_plan",
    "backfill_plugin_auto_upgrade",
    "backfill_workflow_run_archive_bundles",
    "clean_expired_messages",
    "clean_workflow_runs",
    "cleanup_orphaned_draft_variables",
    "clear_free_plan_tenant_expired_logs",
    "clear_orphaned_file_records",
    "convert_to_agent_apps",
    "create_tenant",
    "data_migrate",
    "delete_archived_workflow_runs",
    "export_app_messages",
    "export_migration_data",
    "export_migration_data_template",
    "extract_plugins",
    "extract_unique_plugins",
    "file_usage",
    "fix_app_site_missing",
    "import_migration_data",
    "install_plugins",
    "install_rag_pipeline_plugins",
    "legacy_model_types",
    "migrate_annotation_vector_database",
    "migrate_data_for_plugin",
    "migrate_dataset_permissions_to_rbac",
    "migrate_knowledge_vector_database",
    "migrate_member_roles_to_rbac",
    "migrate_oss",
    "migration_data_wizard",
    "old_metadata_migration",
    "remove_orphaned_files_on_storage",
    "reset_email",
    "reset_encrypt_key_pair",
    "reset_password",
    "restore_workflow_runs",
    "setup_datasource_oauth_client",
    "setup_system_tool_oauth_client",
    "setup_system_trigger_oauth_client",
    "transform_datasource_credentials",
    "upgrade_db",
    "vdb_migrate",
]
