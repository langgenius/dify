from dify_app import DifyApp


def init_app(app: DifyApp):
    from commands import (
        add_qdrant_index,
        clear_free_plan_tenant_expired_logs,
        convert_to_agent_apps,
        create_tenant,
        extract_plugins,
        extract_unique_plugins,
        fix_app_site_missing,
        install_plugins,
        migrate_data_for_plugin,
        old_metadata_migration,
        reset_email,
        reset_encrypt_key_pair,
        reset_password,
        upgrade_db,
        vdb_migrate,
    )

    cmds_to_register = [
        reset_password,
        reset_email,
        reset_encrypt_key_pair,
        vdb_migrate,
        convert_to_agent_apps,
        add_qdrant_index,
        create_tenant,
        upgrade_db,
        fix_app_site_missing,
        migrate_data_for_plugin,
        extract_plugins,
        extract_unique_plugins,
        install_plugins,
        old_metadata_migration,
        clear_free_plan_tenant_expired_logs,
    ]
    for cmd in cmds_to_register:
        app.cli.add_command(cmd)
