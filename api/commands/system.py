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

logger = logging.getLogger(__name__)

DB_UPGRADE_LOCK_TTL_SECONDS = 60


@click.command(
    "reset-encrypt-key-pair",
    help="Reset the asymmetric key pair of workspace for encrypt LLM credentials. "
    "After the reset, all LLM credentials will become invalid, "
    "requiring re-entry."
    "Only support SELF_HOSTED mode.",
)
@click.confirmation_option(
    prompt=click.style(
        "Are you sure you want to reset encrypt key pair? This operation cannot be rolled back!", fg="red"
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


def _do_import_custom_data(input_file):
    """
    Import custom tools, workflows, and workflow tools from a JSON file.

    Input JSON format:
    {
        "tools": [...],
        "workflows": [...],
        "workflow_tools": [...]
    }
    """
    import json
    import traceback

    from sqlalchemy import or_
    from sqlalchemy.orm import Session

    from core.tools.entities.tool_entities import WorkflowToolParameterConfiguration
    from models import Account, ApiToken, Tenant
    from models.account import TenantAccountJoin
    from models.model import App
    from models.tools import ApiToolProvider, WorkflowToolProvider
    from services.app_dsl_service import AppDslService
    from services.tools.api_tools_manage_service import ApiToolManageService
    from services.tools.workflow_tools_manage_service import WorkflowToolManageService
    from services.workflow_service import WorkflowService

    click.echo(click.style("=== import-custom-data ===", fg="cyan", bold=True))
    click.echo(f"Input file: {input_file}")

    with open(input_file, encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        click.echo(click.style("Error: JSON must be a dict with tools/workflows/workflow_tools keys.", fg="red"))
        return

    tools_data = data.get("tools", [])
    workflows_data = data.get("workflows", [])
    workflow_tools_data = data.get("workflow_tools", [])
    click.echo(
        f"Plan: {len(tools_data)} tools, {len(workflows_data)} workflows, {len(workflow_tools_data)} workflow_tools"
    )

    tool_success_list, tool_error_list = [], []
    workflow_success_list, workflow_error_list = [], []
    workflow_tools_success_list, workflow_tools_error_list = [], []

    # ── Import custom tools ──────────────────────────────────────────────────────────
    if tools_data:
        click.echo(click.style(f"\n[Tools] importing {len(tools_data)} item(s)...", fg="cyan"))
    for idx, tool_data in enumerate(tools_data, 1):
        provider_name = tool_data.get("provider_name", "Unknown")
        click.echo(f"  [{idx}/{len(tools_data)}] tool: {provider_name}")
        try:
            for field in ["provider_name", "schema"]:
                if field not in tool_data:
                    raise ValueError(f"Missing required field: {field}")
            tenant_name = tool_data["tenant_name"]
            tenant = db.session.query(Tenant).where(Tenant.name == tenant_name).first()
            if tenant is None:
                raise ValueError(f"Tenant not found: {tenant_name}")
            click.echo(f"    tenant: {tenant_name} (id={tenant.id})")
            tenant_account = (
                db.session.query(Account)
                .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
                .filter(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.role == "owner")
                .order_by(TenantAccountJoin.created_at.asc())
                .first()
            )
            if tenant_account is None:
                raise ValueError(f"No owner account found for tenant: {tenant_name}")
            click.echo(f"    account: {tenant_account.email} (id={tenant_account.id})")
            schema_info = ApiToolManageService.parser_api_schema(schema=tool_data["schema"])
            click.echo(f"    schema_type: {schema_info['schema_type']}")
            icon = tool_data.get("icon", {"content": "🕵️", "background": "#FEF7C3"})
            credentials = tool_data.get("credentials", {"auth_type": "none"})
            exist_obj = db.session.query(ApiToolProvider).where(ApiToolProvider.name == provider_name).first()
            if exist_obj:
                click.echo(f"    existing provider found (id={exist_obj.id}), updating...")
                ApiToolManageService.update_api_tool_provider(
                    user_id=tenant_account.id,
                    tenant_id=tenant.id,
                    provider_name=provider_name,
                    original_provider=exist_obj.name,
                    _schema_type=schema_info["schema_type"],
                    schema=tool_data["schema"],
                    privacy_policy=tool_data.get("privacy_policy", ""),
                    credentials=credentials,
                    custom_disclaimer=tool_data.get("custom_disclaimer", ""),
                    labels=tool_data.get("labels", []),
                    icon=icon,
                )
                click.echo(click.style(f"    ✓ Updated tool: {provider_name}", fg="green"))
            else:
                click.echo(f"    no existing provider, creating (provider_name={provider_name or 'auto'})...")
                ApiToolManageService.create_api_tool_provider(
                    user_id=tenant_account.id,
                    tenant_id=tenant.id,
                    provider_name=provider_name,
                    schema_type=schema_info["schema_type"],
                    schema=tool_data["schema"],
                    privacy_policy=tool_data.get("privacy_policy", ""),
                    credentials=credentials,
                    custom_disclaimer=tool_data.get("custom_disclaimer", ""),
                    labels=tool_data.get("labels", []),
                    icon=icon,
                )
                click.echo(click.style(f"    ✓ Created tool: {provider_name}", fg="green"))
            tool_success_list.append(provider_name)
        except Exception as e:
            db.session.rollback()
            tool_error_list.append(provider_name)
            click.echo(click.style(f"    ✗ FAILED: {e}", fg="red"))
            traceback.print_exc()

    # ── Import workflow DSL ──────────────────────────────────────────────────────────
    if workflows_data:
        click.echo(click.style(f"\n[Workflows] importing {len(workflows_data)} item(s)...", fg="cyan"))
    for idx, workflow_data in enumerate(workflows_data, 1):
        _name = workflow_data.get("name", f"workflow-{idx}")
        app_id = workflow_data.get("id", "")
        click.echo(f"  [{idx}/{len(workflows_data)}] workflow: {_name} (id={app_id})")
        try:
            for field in ["dsl", "tenant_name"]:
                if field not in workflow_data:
                    raise ValueError(f"Missing required field: {field}")
            tenant_name = workflow_data["tenant_name"]
            tenant = db.session.query(Tenant).where(Tenant.name == tenant_name).first()
            if tenant is None:
                raise ValueError(f"Tenant not found: {tenant_name}")
            click.echo(f"    tenant: {tenant_name} (id={tenant.id})")
            tenant_account = (
                db.session.query(Account)
                .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
                .filter(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.role == "owner")
                .order_by(TenantAccountJoin.created_at.asc())
                .first()
            )
            if tenant_account is None:
                raise ValueError(f"No owner account found for tenant: {tenant_name}")
            # set current tenant
            tenant_account.current_tenant = tenant
            click.echo(f"    account: {tenant_account.email} (id={tenant_account.id})")
            dsl_content = workflow_data["dsl"]
            exist_obj = db.session.query(App).where(App.id == app_id).first()
            click.echo(f"    app exists: {exist_obj is not None}")
            with Session(db.engine) as session:
                import_service = AppDslService(session)
                if exist_obj:
                    click.echo(f"    updating existing app (id={app_id})...")
                    import_result = import_service.import_app(
                        account=tenant_account,
                        import_mode="yaml-content",
                        yaml_content=dsl_content,
                        app_id=app_id,
                    )
                else:
                    click.echo(f"    creating new app (import_app_id={app_id})...")
                    import_result = import_service.import_app(
                        account=tenant_account,
                        import_mode="yaml-content",
                        yaml_content=dsl_content,
                        import_app_id=app_id,
                    )
                session.commit()
                click.echo(f"    DSL import result: app_id={getattr(import_result, 'app_id', app_id)}")
                # auto publish
                try:
                    db.session.flush()
                    app_model = db.session.query(App).where(App.id == app_id).first()
                    click.echo("    publishing workflow...")
                    workflow = WorkflowService().publish_workflow(
                        session=session,
                        app_model=app_model,
                        account=tenant_account,
                        marked_name="",
                        marked_comment="",
                    )
                    app_model.workflow_id = workflow.id
                    db.session.commit()
                    session.commit()
                    click.echo(f"    workflow published (workflow_id={workflow.id})")
                except Exception as pub_e:
                    db.session.rollback()
                    click.echo(click.style(f"    ⚠ publish failed (non-fatal): {pub_e}", fg="yellow"))
                # auto publish api
                publish_api = workflow_data.get("publish_api", False)
                api_key = None
                if publish_api:
                    exist_api = (
                        db.session.query(ApiToken).filter(ApiToken.type == "app", ApiToken.app_id == app_id).first()
                    )
                    if exist_api:
                        api_key = exist_api.token
                        click.echo(f"    reusing existing api_key: {api_key[:8]}...")
                    else:
                        key = ApiToken.generate_api_key("app", 24)
                        api_token = ApiToken()
                        api_token.app_id = app_id
                        api_token.tenant_id = tenant.id
                        api_token.token = key
                        api_token.type = "app"
                        db.session.add(api_token)
                        db.session.commit()
                        api_key = key
                        click.echo(f"    created new api_key: {api_key[:8]}...")
                workflow_success_list.append({"name": _name, "api_key": api_key})
                click.echo(click.style(f"    ✓ Done: {_name}  api_key={api_key}", fg="green"))
        except Exception as e:
            db.session.rollback()
            workflow_error_list.append({"name": _name})
            click.echo(click.style(f"    ✗ FAILED: {e}", fg="red"))
            traceback.print_exc()

    # ── Import workflow tools ────────────────────────────────────────────────────────
    if workflow_tools_data:
        click.echo(click.style(f"\n[Workflow Tools] importing {len(workflow_tools_data)} item(s)...", fg="cyan"))
        db.session.rollback()
    for idx, workflow_tool_data in enumerate(workflow_tools_data, 1):
        tool_name = workflow_tool_data.get("name", "Unknown")
        _id = workflow_tool_data.get("id", "")
        click.echo(f"  [{idx}/{len(workflow_tools_data)}] workflow_tool: {tool_name} (id={_id})")
        try:
            for field in ["id", "name", "app_id", "tenant_name", "parameters"]:
                if field not in workflow_tool_data:
                    raise ValueError(f"Missing required field: {field}")
            tenant_name = workflow_tool_data["tenant_name"]
            tenant = db.session.query(Tenant).where(Tenant.name == tenant_name).first()
            if tenant is None:
                raise ValueError(f"Tenant not found: {tenant_name}")
            click.echo(f"    tenant: {tenant_name} (id={tenant.id}), app_id={workflow_tool_data['app_id']}")
            tenant_account = (
                db.session.query(Account)
                .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
                .filter(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.role == "owner")
                .order_by(TenantAccountJoin.created_at.asc())
                .first()
            )
            if tenant_account is None:
                raise ValueError(f"No owner account found for tenant: {tenant_name}")
            click.echo(f"    account: {tenant_account.email} (id={tenant_account.id})")
            existing = (
                db.session.query(WorkflowToolProvider)
                .filter(
                    WorkflowToolProvider.tenant_id == tenant.id,
                    or_(
                        WorkflowToolProvider.name == tool_name,
                        WorkflowToolProvider.app_id == workflow_tool_data["app_id"],
                    ),
                )
                .first()
            )
            click.echo(f"    existing workflow_tool: {existing.id if existing else 'none'}")
            kwargs = {
                "user_id": tenant_account.id,
                "tenant_id": tenant.id,
                "name": tool_name,
                "label": workflow_tool_data.get("name"),
                "icon": workflow_tool_data.get("icon", {"content": "🤖", "background": "#FFEAD5"}),
                "description": workflow_tool_data.get("description", ""),
                "parameters": [
                    p if isinstance(p, WorkflowToolParameterConfiguration) else WorkflowToolParameterConfiguration(**p)
                    for p in workflow_tool_data["parameters"]
                ],
                "privacy_policy": workflow_tool_data.get("privacy_policy", ""),
                "labels": workflow_tool_data.get("labels", []),
            }
            if existing:
                WorkflowToolManageService.update_workflow_tool(workflow_tool_id=existing.id, **kwargs)
                click.echo(click.style(f"    ✓ Updated workflow tool: {tool_name}", fg="green"))
            else:
                WorkflowToolManageService.create_workflow_tool(
                    workflow_app_id=workflow_tool_data["app_id"],
                    import_id=_id,
                    **kwargs,
                )
                click.echo(click.style(f"    ✓ Created workflow tool: {tool_name}", fg="green"))
            workflow_tools_success_list.append(tool_name)
        except Exception as e:
            db.session.rollback()
            workflow_tools_error_list.append(tool_name)
            click.echo(click.style(f"    ✗ FAILED: {e}", fg="red"))
            traceback.print_exc()
    mcp_tools_data = data.get("mcp_tools", [])
    mcp_success_list = []
    mcp_error_list = []
    if mcp_tools_data:
        click.echo(click.style(f"\n[mcp Tools] importing {len(mcp_tools_data)} item(s)...", fg="cyan"))

        from sqlalchemy import or_

        from core.entities.mcp_provider import MCPAuthentication, MCPConfiguration
        from models.tools import MCPToolProvider
        from services.tools.mcp_tools_manage_service import MCPToolManageService

        for mcp_data in mcp_tools_data:
            try:
                # Validate required fields
                required_fields = ["name", "server_url", "server_identifier"]
                for field in required_fields:
                    if field not in mcp_data:
                        raise ValueError(f"Missing required field: {field}")

                tenant_name = mcp_data["tenant_name"]
                tenant = db.session.query(Tenant).where(Tenant.name == tenant_name).first()
                if tenant is None:
                    raise ValueError(f"Tenant not found: {tenant_name}")
                tenant_account = (
                    db.session.query(Account)
                    .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
                    .filter(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.role == "owner")
                    .order_by(TenantAccountJoin.created_at.asc())
                    .first()
                )
                if tenant_account is None:
                    raise ValueError(f"No owner account found for tenant: {tenant_name}")
                # Build MCP configuration
                configuration = MCPConfiguration.model_validate(mcp_data.get("configuration", {}))
                authentication = None
                if mcp_data.get("authentication"):
                    authentication = MCPAuthentication.model_validate(mcp_data["authentication"])
                import_id = mcp_data.get("id")
                # Check if already exists
                existing_provider = (
                    db.session.query(MCPToolProvider)
                    .filter(
                        or_(
                            MCPToolProvider.id == import_id,
                            MCPToolProvider.server_identifier == mcp_data["server_identifier"],
                        ),
                        MCPToolProvider.tenant_id == tenant.id,
                    )
                    .first()
                )

                if existing_provider:
                    # Update existing MCP tool
                    service = MCPToolManageService(session=db.session)
                    service.update_provider(
                        provider_id=existing_provider.id,
                        tenant_id=tenant.id,
                        server_url=mcp_data["server_url"],
                        name=mcp_data["name"],
                        icon=mcp_data.get("icon", ""),
                        icon_type=mcp_data.get("icon_type", "emoji"),
                        icon_background=mcp_data.get("icon_background", ""),
                        server_identifier=mcp_data["server_identifier"],
                        headers=mcp_data.get("headers", {}),
                        configuration=configuration,
                        authentication=authentication,
                    )
                    db.session.commit()
                    mcp_success_list.append(mcp_data["name"])
                    click.echo(click.style(f"    ✓ updated mcp tool: {mcp_data['name']}", fg="green"))
                else:
                    # Create new MCP tool
                    service = MCPToolManageService(session=db.session)
                    service.create_provider(
                        tenant_id=tenant.id,
                        user_id=tenant_account.id,
                        server_url=mcp_data["server_url"],
                        name=mcp_data["name"],
                        icon=mcp_data.get("icon", ""),
                        icon_type=mcp_data.get("icon_type", "emoji"),
                        icon_background=mcp_data.get("icon_background", ""),
                        server_identifier=mcp_data["server_identifier"],
                        headers=mcp_data.get("headers", {}),
                        configuration=configuration,
                        authentication=authentication,
                    )
                    db.session.commit()
                    mcp_success_list.append(mcp_data["name"])
                    click.echo(click.style(f"    ✓ Created mcp tool: {mcp_data['name']}", fg="green"))

            except Exception as e:
                db.session.rollback()
                mcp_error_list.append(mcp_data.get("name", "Unknown"))
                click.echo(click.style(f"    ✗ FAILED: {e}", fg="red"))
                traceback.print_exc()
    # ── Summary ───────────────────────────────────────────────────────────────────
    click.echo(click.style("\n=== Summary ===", fg="cyan", bold=True))
    click.echo(
        click.style(
            f"Tools        : {len(tool_success_list)} ok, {len(tool_error_list)} failed"
            + (f"  failed={tool_error_list}" if tool_error_list else ""),
            fg="green" if not tool_error_list else "yellow",
        )
    )
    click.echo(
        click.style(
            f"Workflows    : {len(workflow_success_list)} ok, {len(workflow_error_list)} failed"
            + (f"  failed={[w['name'] for w in workflow_error_list]}" if workflow_error_list else ""),
            fg="green" if not workflow_error_list else "yellow",
        )
    )
    for w in workflow_success_list:
        click.echo(f"  {w['name']}  api_key={w['api_key']}")
    click.echo(
        click.style(
            f"WorkflowTools: {len(workflow_tools_success_list)} ok, {len(workflow_tools_error_list)} failed"
            + (f"  failed={workflow_tools_error_list}" if workflow_tools_error_list else ""),
            fg="green" if not workflow_tools_error_list else "yellow",
        )
    )
    click.echo(
        click.style(
            f"mcp Tools        : {len(mcp_success_list)} ok, {len(mcp_error_list)} failed"
            + (f"  failed={mcp_error_list}" if mcp_error_list else ""),
            fg="green" if not mcp_error_list else "yellow",
        )
    )


def _do_export_custom_data(input_file, output_file):
    """
    Export custom tools, workflows, and workflow tools to a JSON file.

    Input JSON format:
    {
        "tenant_name": "xxx",
        "tools": ["tool_name1", ...],
        "workflows": ["app_id1", ...],
        "workflow_tools": ["tool_id1", ...],
        "export_all_workflows": false
        "workflow_publish_api": false
    }
    """
    import json
    import os
    import traceback

    from graphon.model_runtime.utils.encoders import jsonable_encoder

    from core.tools.tool_manager import ToolManager
    from models import Account, Tenant
    from models.account import TenantAccountJoin
    from services.app_dsl_service import AppDslService
    from services.tools.workflow_tools_manage_service import WorkflowToolManageService

    click.echo(click.style("=== export-custom-data ===", fg="cyan", bold=True))
    click.echo(f"Input file : {input_file}")
    click.echo(f"Output file: {output_file}")

    with open(input_file, encoding="utf-8") as f:
        data = json.load(f)

    if not isinstance(data, dict):
        click.echo(click.style("Error: JSON must be a dict.", fg="red"))
        return

    tenant_name = data.get("tenant_name", os.getenv("INIT_WORKSPACE_NAME", ""))
    tenant = db.session.query(Tenant).where(Tenant.name == tenant_name).first()
    if tenant:
        click.echo(f"Tenant: {tenant_name} (id={tenant.id})")
    else:
        click.echo(click.style(f"Tenant not found: {tenant_name}", fg="yellow"))

    tools_data = data.get("tools", [])
    workflows_data = data.get("workflows", [])
    workflow_publish_api = data.get("workflow_publish_api", False)
    workflow_tools_data = data.get("workflow_tools", [])
    mcp_tools_data = data.get("mcp_tools", [])
    mcp_tools_list = []
    export_all_workflows = data.get("export_all_workflows", False)
    click.echo(
        f"Plan: export_all_workflows={export_all_workflows}, "
        f"{len(tools_data)} tools, {len(workflows_data)} workflows, {len(workflow_tools_data)} workflow_tools"
    )

    tool_list, workflow_list, workflow_tools_list = [], [], []

    # ── Export all workflows ──────────────────────────────────────────────────────────
    if export_all_workflows:
        apps = db.session.query(App).where(App.mode.in_(["workflow", "advanced-chat"])).all()
        click.echo(click.style(f"\n[Workflows] export_all_workflows=True, found {len(apps)} app(s)...", fg="cyan"))
        for idx, app in enumerate(apps, 1):
            click.echo(f"  [{idx}/{len(apps)}] {app.id}  name={app.name}  mode={app.mode}")
            try:
                dsl_content = AppDslService.export_dsl(app_model=app, include_secret=True)
                workflow_list.append(
                    {
                        "id": app.id,
                        "name": app.name,
                        "dsl": dsl_content,
                        "tenant_name": tenant_name,
                        "publish_api": workflow_publish_api,
                    }
                )
                click.echo(click.style("    ✓ Exported", fg="green"))
            except Exception as e:
                click.echo(click.style(f"    ✗ FAILED: {e}", fg="red"))
                traceback.print_exc()
        result = {"workflows": workflow_list}
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        summary = f"\n=== Summary ===\nExported {len(workflow_list)}/{len(apps)} workflows → {output_file}"
        click.echo(click.style(summary, fg="cyan", bold=True))
        return

    # ── Export tools ────────────────────────────────────────────────────────────────
    if tools_data:
        if tenant is None:
            click.echo(click.style(f"\n[Tools] skipped — tenant not found: {tenant_name}", fg="red"))
        else:
            click.echo(click.style(f"\n[Tools] exporting {len(tools_data)} item(s)...", fg="cyan"))
            for idx, tool_name in enumerate(tools_data, 1):
                click.echo(f"  [{idx}/{len(tools_data)}] tool: {tool_name}")
                try:
                    tool_dict = ToolManager.user_get_api_provider(provider=tool_name, tenant_id=tenant.id, mask=False)
                    tool_dict["tenant_name"] = tenant_name
                    tool_dict["provider_name"] = tool_name
                    tool_dict.pop("tools", None)
                    tool_list.append(tool_dict)
                    click.echo(click.style(f"    ✓ Exported tool: {tool_name}", fg="green"))
                except Exception as e:
                    click.echo(click.style(f"    ✗ FAILED: {e}", fg="red"))
                    traceback.print_exc()

    # ── Export workflow DSL ──────────────────────────────────────────────────────────
    if workflows_data:
        click.echo(click.style(f"\n[Workflows] exporting {len(workflows_data)} item(s)...", fg="cyan"))
        for idx, workflow_id in enumerate(workflows_data, 1):
            click.echo(f"  [{idx}/{len(workflows_data)}] workflow_id: {workflow_id}")
            try:
                app = db.session.query(App).where(App.id == workflow_id).first()
                if app is None:
                    raise ValueError(f"App not found: {workflow_id}")
                click.echo(f"    name={app.name}  mode={app.mode}")
                dsl_content = AppDslService.export_dsl(app_model=app, include_secret=True)
                workflow_list.append(
                    {
                        "id": workflow_id,
                        "name": app.name,
                        "dsl": dsl_content,
                        "tenant_name": tenant_name,
                        "publish_api": workflow_publish_api,
                    }
                )
                click.echo(click.style(f"    ✓ Exported workflow: {app.name}", fg="green"))
            except Exception as e:
                click.echo(click.style(f"    ✗ FAILED: {e}", fg="red"))
                traceback.print_exc()

    # ── Export workflow tools ────────────────────────────────────────────────────────
    if workflow_tools_data:
        if tenant is None:
            click.echo(click.style(f"\n[Workflow Tools] skipped — tenant not found: {tenant_name}", fg="red"))
        else:
            click.echo(click.style(f"\n[Workflow Tools] exporting {len(workflow_tools_data)} item(s)...", fg="cyan"))
            tenant_account = (
                db.session.query(Account)
                .join(TenantAccountJoin, Account.id == TenantAccountJoin.account_id)
                .filter(TenantAccountJoin.tenant_id == tenant.id, TenantAccountJoin.role == "owner")
                .order_by(TenantAccountJoin.created_at.asc())
                .first()
            )
            if tenant_account is None:
                click.echo(
                    click.style(f"[Workflow Tools] skipped — no owner account for tenant: {tenant_name}", fg="red")
                )
            else:
                click.echo(f"    account: {tenant_account.email} (id={tenant_account.id})")
            for idx, _id in enumerate(workflow_tools_data, 1):
                click.echo(f"  [{idx}/{len(workflow_tools_data)}] workflow_tool_id: {_id}")
                try:
                    if tenant_account is None:
                        raise ValueError(f"No owner account found for tenant: {tenant_name}")
                    tool_info = WorkflowToolManageService.get_workflow_tool_by_tool_id(
                        user_id=tenant_account.id,
                        tenant_id=tenant.id,
                        workflow_tool_id=_id,
                    )
                    tool_info = jsonable_encoder(tool_info)
                    tool_info["tenant_name"] = tenant_name
                    tool_info["id"] = _id
                    tool_info["app_id"] = tool_info.get("workflow_app_id")
                    for k in ["workflow_tool_id", "workflow_app_id", "tool"]:
                        tool_info.pop(k, None)
                    workflow_tools_list.append(tool_info)
                    click.echo(click.style(f"    ✓ Exported workflow tool: {tool_info.get('name', _id)}", fg="green"))
                except Exception as e:
                    click.echo(click.style(f"    ✗ FAILED: {e}", fg="red"))
                    traceback.print_exc()
    # Export MCP tools
    if mcp_tools_data:
        if tenant is None:
            click.echo(click.style(f"\n[mcp Tools] skipped — tenant not found: {tenant_name}", fg="red"))
        else:
            click.echo(click.style(f"\n[mcp Tools] exporting {len(mcp_tools_data)} item(s)...", fg="cyan"))
            from models.tools import MCPToolProvider

            for mcp_id in mcp_tools_data:
                try:
                    # Query MCP tool
                    mcp_provider = (
                        db.session.query(MCPToolProvider)
                        .filter(MCPToolProvider.id == mcp_id, MCPToolProvider.tenant_id == tenant.id)
                        .first()
                    )
                    if mcp_provider is None:
                        raise ValueError(f"MCP tool not found: {mcp_id}")
                    mcp_provider_entity = mcp_provider.to_entity()
                    # Process icon field
                    provider_icon = mcp_provider_entity.provider_icon
                    icon_background = None
                    if isinstance(provider_icon, dict):
                        icon_type = "emoji"  # emoji-type icon is stored as a dict
                        icon_background = provider_icon.get("background")
                        icon_content = provider_icon.get("content")
                    else:
                        icon_type = "url"  # other types are URLs
                        icon_content = provider_icon
                        # Build configuration
                    configuration = {"timeout": mcp_provider.timeout, "sse_read_timeout": mcp_provider.sse_read_timeout}
                    # Build export data
                    mcp_dict = {
                        "id": mcp_provider.id,
                        "name": mcp_provider.name,
                        "server_url": mcp_provider_entity.decrypt_server_url(),
                        "server_identifier": mcp_provider.server_identifier,
                        "icon": icon_content,
                        "icon_type": icon_type,
                        "icon_background": icon_background,
                        "headers": mcp_provider_entity.decrypt_headers(),
                        "configuration": configuration,
                        "authentication": None,
                        "tenant_name": tenant_name,
                    }
                    mcp_tools_list.append(mcp_dict)
                    click.echo(click.style(f"    ✓ Exported mcp tool: {mcp_provider.name}", fg="green"))
                except Exception as e:
                    click.echo(click.style(f"    ✗ FAILED: {e}", fg="red"))
                    traceback.print_exc()
    result = {
        "workflows": workflow_list,
        "tools": tool_list,
        "workflow_tools": workflow_tools_list,
        "mcp_tools": mcp_tools_list,
    }
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    click.echo(click.style("\n=== Summary ===", fg="cyan", bold=True))
    click.echo(f"Tools        : {len(tool_list)} exported")
    click.echo(f"Workflows    : {len(workflow_list)} exported")
    click.echo(f"WorkflowTools: {len(workflow_tools_list)} exported")
    click.echo(f"McpTools     : {len(mcp_tools_list)} exported")
    click.echo(click.style(f"Output written to {output_file}", fg="green"))


@click.command("import-custom-data", help="Import custom tools/workflows/workflow_tools from a JSON file.")
@click.option("--input", "input_file", required=True, help="Path to input JSON file")
def import_custom_data(input_file):
    _do_import_custom_data(input_file)


@click.command("export-custom-data", help="Export custom tools/workflows/workflow_tools to a JSON file.")
@click.option("--input", "input_file", required=True, help="Path to input JSON file with export config")
@click.option("--output", "output_file", required=True, help="Path to output JSON file")
def export_custom_data(input_file, output_file):
    _do_export_custom_data(input_file, output_file)


@click.command("migration-custom-datas", help="Interactive menu: export/import custom data or migrate API data.")
def migration_custom_datas():
    """
    Interactive menu:
      1. export-custom-data
      2. import-custom-data
    """
    click.echo(click.style("\n=== migration-custom-datas ===", fg="cyan", bold=True))
    click.echo("1. Export custom data")
    click.echo("2. Import custom data")
    choice = click.prompt("Select an operation (1-2)", type=click.Choice(["1", "2"]))

    if choice == "1":
        input_file = click.prompt("Enter config file path (input JSON)")
        output_file = click.prompt("Enter output file path (output JSON)", default="export_output.json")
        _do_export_custom_data(input_file, output_file)
    elif choice == "2":
        input_file = click.prompt("Enter import data file path (input JSON)")
        _do_import_custom_data(input_file)
