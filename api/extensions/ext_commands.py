from dify_app import DifyApp


def init_app(app: DifyApp):
    from commands import (add_account_to_organization_cmd,
                          add_qdrant_doc_id_index, convert_to_agent_apps,
                          create_admin_with_phone, create_organization_cmd,
                          create_tenant, extract_plugins,
                          extract_unique_plugins, fix_app_site_missing,
                          install_plugins, list_organizations_cmd,
                          migrate_data_for_plugin, reset_email,
                          reset_encrypt_key_pair, reset_password,
                          show_organization_cmd, update_organization_cmd,
                          upgrade_db, upload_local_files_to_cloud_storage,
                          upload_private_key_file_cloud_storage, vdb_migrate)

    cmds_to_register = [
        reset_password,
        reset_email,
        reset_encrypt_key_pair,
        vdb_migrate,
        convert_to_agent_apps,
        add_qdrant_doc_id_index,
        create_tenant,
        upgrade_db,
        fix_app_site_missing,
        create_admin_with_phone,
        create_organization_cmd,
        add_account_to_organization_cmd,
        list_organizations_cmd,
        show_organization_cmd,
        update_organization_cmd,
        upload_private_key_file_cloud_storage,
        upload_local_files_to_cloud_storage,
        migrate_data_for_plugin,
        extract_plugins,
        extract_unique_plugins,
        install_plugins,
    ]
    for cmd in cmds_to_register:
        app.cli.add_command(cmd)
