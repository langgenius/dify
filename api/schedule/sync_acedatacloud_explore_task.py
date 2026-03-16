"""Periodic task: ensure AceDataCloud workflow templates are registered in Explore.

This task runs on the Celery beat schedule (every 30 minutes by default).
It is completely independent of user login — it picks the *first* tenant that
owns one of the workflow apps (the one created by the first AceDataCloud user)
and ensures every workflow YAML has a corresponding RecommendedApp + Site row
in the database so the Explore page always shows the templates.

The task is fully idempotent: it only creates missing records.
"""

import logging
import time

import click
from sqlalchemy import select
from sqlalchemy.orm import Session

import app
from extensions.ext_database import db
from models import Account, App
from models.model import RecommendedApp
from tasks.import_acedatacloud_workflow_templates_task import (
    _get_workflow_files,
    _parse_workflow_yaml,
    _register_explore_apps,
)

logger = logging.getLogger(__name__)


def _find_explore_tenant(session: Session, workflow_files: list) -> str | None:
    """Find a tenant that already has at least one of the workflow apps imported.

    Returns tenant_id or None.
    """
    # Strategy 1: Check if any RecommendedApp records already exist.
    # The associated App's tenant_id is the one we want.
    existing_rec = session.execute(
        select(RecommendedApp.app_id)
        .where(RecommendedApp.category == "AceDataCloud", RecommendedApp.is_listed == True)
        .limit(1)
    ).scalar_one_or_none()
    if existing_rec:
        app_obj = session.get(App, str(existing_rec))
        if app_obj:
            return str(app_obj.tenant_id)

    # Strategy 2: Search by app name from the first workflow YAML.
    for wf_file in workflow_files:
        parsed = _parse_workflow_yaml(wf_file)
        app_name = parsed.get("app", {}).get("name", "")
        if not app_name:
            continue

        app_id = session.execute(select(App.id, App.tenant_id).where(App.name == app_name).limit(1)).first()
        if app_id:
            return str(app_id.tenant_id)

    return None


@app.celery.task(queue="plugin")
def sync_acedatacloud_explore_task():
    """Ensure all AceDataCloud workflow templates are visible on the Explore page.

    Runs periodically via Celery beat. Idempotent — safe to run any number of times.
    """
    click.echo(click.style("Start sync AceDataCloud Explore apps.", fg="green"))
    start_at = time.perf_counter()

    workflow_files = _get_workflow_files()
    if not workflow_files:
        click.echo(click.style("No workflow files found, skipping.", fg="yellow"))
        return

    with Session(db.engine) as session:
        tenant_id = _find_explore_tenant(session, workflow_files)
        if not tenant_id:
            # No tenant has any of the workflow apps yet.
            # This means no AceDataCloud user has logged in at all.
            # We need to import the apps into a system tenant first.
            # Find any admin/owner account to use.
            account = session.execute(select(Account).limit(1)).scalar_one_or_none()
            if not account:
                click.echo(click.style("No accounts in DB yet — nothing to register.", fg="yellow"))
                return

            # Import workflows into the first available tenant
            from models.account import TenantAccountJoin

            join = session.execute(
                select(TenantAccountJoin.tenant_id).where(TenantAccountJoin.account_id == account.id).limit(1)
            ).scalar_one_or_none()

            if not join:
                click.echo(click.style("No tenant found for account — skipping.", fg="yellow"))
                return

            tenant_id = str(join)

            # Import workflows first (only if they don't exist)
            from tasks.import_acedatacloud_workflow_templates_task import _import_single_workflow

            for wf_file in workflow_files:
                _import_single_workflow(
                    session=session,
                    account=account,
                    tenant_id=tenant_id,
                    wf_file=wf_file,
                )

        registered = _register_explore_apps(
            session=session,
            tenant_id=tenant_id,
            workflow_files=workflow_files,
        )

    end_at = time.perf_counter()
    click.echo(
        click.style(
            f"Sync AceDataCloud Explore done: registered={registered} latency={end_at - start_at:.2f}s",
            fg="green",
        )
    )
