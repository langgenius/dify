from dify_app import DifyApp


def init_app(app: DifyApp):
    from commands import (
        add_qdrant_doc_id_index,
        convert_to_agent_apps,
        create_tenant,
        fix_app_site_missing,
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
        add_qdrant_doc_id_index,
        create_tenant,
        upgrade_db,
        fix_app_site_missing,
    ]
    for cmd in cmds_to_register:
        app.cli.add_command(cmd)
