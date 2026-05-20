"""App data maintenance CLI commands."""

import logging

import click
import sqlalchemy as sa
from sqlalchemy import select, update

from events.app_event import app_was_created
from extensions.ext_database import db
from models.model import App, AppMode, Conversation

logger = logging.getLogger(__name__)


@click.command("convert-to-agent-apps", help="Convert Agent Assistant to Agent App.")
def convert_to_agent_apps() -> None:
    """
    Convert Agent Assistant to Agent App.
    """
    click.echo(click.style("Starting convert to agent apps.", fg="green"))

    proceeded_app_ids: list[str] = []

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


@click.command("fix-app-site-missing", help="Fix app related site missing issue.")
def fix_app_site_missing() -> None:
    """
    Fix app related site missing issue.
    """
    click.echo(click.style("Starting fix for missing app-related sites.", fg="green"))

    failed_app_ids: list[str] = []
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
