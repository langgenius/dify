"""
CLI command modules extracted from `commands.py`.
"""

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

__all__ = [
    "clear_orphaned_file_records",
    "extract_plugins",
    "extract_unique_plugins",
    "file_usage",
    "install_plugins",
    "install_rag_pipeline_plugins",
    "migrate_data_for_plugin",
    "migrate_oss",
    "remove_orphaned_files_on_storage",
    "setup_datasource_oauth_client",
    "setup_system_tool_oauth_client",
    "setup_system_trigger_oauth_client",
    "transform_datasource_credentials",
]
