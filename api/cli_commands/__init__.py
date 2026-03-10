"""
CLI command modules extracted from `commands.py`.
"""

from cli_commands.account import create_tenant, reset_email, reset_password
from cli_commands.plugin import (
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
from cli_commands.storage import clear_orphaned_file_records, file_usage, migrate_oss, remove_orphaned_files_on_storage
from cli_commands.system import convert_to_agent_apps, fix_app_site_missing, reset_encrypt_key_pair, upgrade_db
from cli_commands.vector import (
    add_qdrant_index,
    migrate_annotation_vector_database,
    migrate_knowledge_vector_database,
    old_metadata_migration,
    vdb_migrate,
)

__all__ = [
    "add_qdrant_index",
    "clear_orphaned_file_records",
    "convert_to_agent_apps",
    "create_tenant",
    "extract_plugins",
    "extract_unique_plugins",
    "file_usage",
    "fix_app_site_missing",
    "install_plugins",
    "install_rag_pipeline_plugins",
    "migrate_annotation_vector_database",
    "migrate_data_for_plugin",
    "migrate_knowledge_vector_database",
    "migrate_oss",
    "old_metadata_migration",
    "remove_orphaned_files_on_storage",
    "reset_email",
    "reset_encrypt_key_pair",
    "reset_password",
    "setup_datasource_oauth_client",
    "setup_system_tool_oauth_client",
    "setup_system_trigger_oauth_client",
    "transform_datasource_credentials",
    "upgrade_db",
    "vdb_migrate",
]
