import logging

import click
import sqlalchemy as sa
from sqlalchemy import delete, select, update
from sqlalchemy.orm import sessionmaker

from configs import dify_config
from events.app_event import app_was_created
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from libs.db_migration_lock import DbMigrationAutoRenewLock
from libs.rsa import generate_key_pair
from models import Tenant
from models.model import App, AppMode, Conversation
from models.provider import Provider, ProviderModel
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider

logger = logging.getLogger(__name__)

DB_UPGRADE_LOCK_TTL_SECONDS = 60


@click.command(
    "reset-encrypt-key-pair",
    help="Reset the asymmetric key pair of workspace for encrypt LLM credentials. "
    "After the reset, all LLM credentials and tool provider credentials "
    "(builtin / API / MCP) will be purged, requiring re-entry. "
    "Only support SELF_HOSTED mode.",
)
@click.confirmation_option(
    prompt=click.style(
        "Are you sure you want to reset encrypt key pair? "
        "This will also purge builtin / API / MCP tool provider records for every tenant. "
        "This operation cannot be rolled back!",
        fg="red",
    )
)
def reset_encrypt_key_pair():
    """
    Reset the encrypted key pair of workspace for encrypt LLM credentials.
    After the reset, all LLM credentials will become invalid, requiring re-entry.
    Only support SELF_HOSTED mode.
    """
    if dify_config.EDITION != "SELF_HOSTED":
        click.echo(click.style("This command is only for SELF_HOSTED installations.", fg="red"))
        return
    with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
        tenants = session.scalars(select(Tenant)).all()
        for tenant in tenants:
            if not tenant:
                click.echo(click.style("No workspaces found. Run /install first.", fg="red"))
                return

            tenant.encrypt_public_key = generate_key_pair(tenant.id)

            session.execute(delete(Provider).where(Provider.provider_type == "custom", Provider.tenant_id == tenant.id))
            session.execute(delete(ProviderModel).where(ProviderModel.tenant_id == tenant.id))

            # Purge tool provider records that hold credentials encrypted under the
            # tenant key. Leaving them in place causes /console/api/workspaces/current/
            # tool-providers to 500 because decryption fails on stale ciphertext (#35396).
            session.execute(delete(BuiltinToolProvider).where(BuiltinToolProvider.tenant_id == tenant.id))
            session.execute(delete(ApiToolProvider).where(ApiToolProvider.tenant_id == tenant.id))
            session.execute(delete(MCPToolProvider).where(MCPToolProvider.tenant_id == tenant.id))

            click.echo(
                click.style(
                    f"Congratulations! The asymmetric key pair of workspace {tenant.id} has been reset.",
                    fg="green",
                )
            )


@click.command("convert-to-agent-apps", help="Convert Agent Assistant to Agent App.")
def convert_to_agent_apps():
    """
    Convert Agent Assistant to Agent App.
    """
    click.echo(click.style("Starting convert to agent apps.", fg="green"))

    proceeded_app_ids = []

    while True:
        # fetch first 1000 apps
        sql_query = """SELECT a.id AS id FROM apps a
            INNER JOIN app_model_configs am ON a.app_model_config_id=am.id
            WHERE a.mode = 'chat'
            AND am.agent_mode is not null
            AND (
                am.agent_mode like '%"strategy": "function_call"%'
                OR am.agent_mode  like '%"strategy": "react"%'
            )
            AND (
                am.agent_mode like '{"enabled": true%'
                OR am.agent_mode like '{"max_iteration": %'
            ) ORDER BY a.created_at DESC LIMIT 1000
        """

        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(sql_query))

            apps = []
            for i in rs:
                app_id = str(i.id)
                if app_id not in proceeded_app_ids:
                    proceeded_app_ids.append(app_id)
                    app = db.session.scalar(select(App).where(App.id == app_id))
                    if app is not None:
                        apps.append(app)

            if len(apps) == 0:
                break

        for app in apps:
            click.echo(f"Converting app: {app.id}")

            try:
                app.mode = AppMode.AGENT_CHAT
                db.session.commit()

                # update conversation mode to agent
                db.session.execute(
                    update(Conversation).where(Conversation.app_id == app.id).values(mode=AppMode.AGENT_CHAT)
                )

                db.session.commit()
                click.echo(click.style(f"Converted app: {app.id}", fg="green"))
            except Exception as e:
                click.echo(click.style(f"Convert app error: {e.__class__.__name__} {str(e)}", fg="red"))

    click.echo(click.style(f"Conversion complete. Converted {len(proceeded_app_ids)} agent apps.", fg="green"))


@click.command("upgrade-db", help="Upgrade the database")
def upgrade_db():
    click.echo("Preparing database migration...")
    lock = DbMigrationAutoRenewLock(
        redis_client=redis_client,
        name="db_upgrade_lock",
        ttl_seconds=DB_UPGRADE_LOCK_TTL_SECONDS,
        logger=logger,
        log_context="db_migration",
    )
    if lock.acquire(blocking=False):
        migration_succeeded = False
        try:
            click.echo(click.style("Starting database migration.", fg="green"))

            # run db migration
            import flask_migrate

            flask_migrate.upgrade()

            migration_succeeded = True
            click.echo(click.style("Database migration successful!", fg="green"))

        except Exception as e:
            logger.exception("Failed to execute database migration")
            click.echo(click.style(f"Database migration failed: {e}", fg="red"))
            raise SystemExit(1)
        finally:
            status = "successful" if migration_succeeded else "failed"
            lock.release_safely(status=status)
    else:
        click.echo("Database migration skipped")


@click.command("fix-app-site-missing", help="Fix app related site missing issue.")
def fix_app_site_missing():
    """
    Fix app related site missing issue.
    """
    click.echo(click.style("Starting fix for missing app-related sites.", fg="green"))

    failed_app_ids = []
    while True:
        sql = """select apps.id as id from apps left join sites on sites.app_id=apps.id
where sites.id is null limit 1000"""
        with db.engine.begin() as conn:
            rs = conn.execute(sa.text(sql))

            processed_count = 0
            for i in rs:
                processed_count += 1
                app_id = str(i.id)

                if app_id in failed_app_ids:
                    continue

                try:
                    app = db.session.scalar(select(App).where(App.id == app_id))
                    if not app:
                        logger.info("App %s not found", app_id)
                        continue

                    tenant = app.tenant
                    if tenant:
                        accounts = tenant.get_accounts()
                        if not accounts:
                            logger.info("Fix failed for app %s", app.id)
                            continue

                        account = accounts[0]
                        logger.info("Fixing missing site for app %s", app.id)
                        app_was_created.send(app, account=account)
                except Exception:
                    failed_app_ids.append(app_id)
                    click.echo(click.style(f"Failed to fix missing site for app {app_id}", fg="red"))
                    logger.exception("Failed to fix app related site missing issue, app_id: %s", app_id)
                    continue

            if not processed_count:
                break

    click.echo(click.style("Fix for missing app-related sites completed successfully!", fg="green"))
