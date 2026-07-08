import json
import logging
import time
from typing import Any, cast

import click
from pydantic import TypeAdapter
from sqlalchemy import delete, func, select
from sqlalchemy.engine import CursorResult

from configs import dify_config
from core.helper import encrypter
from core.plugin.entities.plugin_daemon import CredentialType
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.plugin_service import PluginService
from core.tools.utils.system_encryption import encrypt_system_params
from extensions.ext_database import db
from models import Tenant
from models.account import TenantPluginAutoUpgradeCategory, TenantPluginAutoUpgradeStrategy
from models.oauth import DatasourceOauthParamConfig, DatasourceProvider
from models.provider_ids import DatasourceProviderID, ToolProviderID
from models.source import DataSourceApiKeyAuthBinding, DataSourceOauthBinding
from models.tools import ToolOAuthSystemClient
from services.plugin.data_migration import PluginDataMigration
from services.plugin.plugin_auto_upgrade_service import PluginAutoUpgradeService
from services.plugin.plugin_migration import PluginMigration

logger = logging.getLogger(__name__)


@click.command("setup-system-tool-oauth-client", help="Setup system tool oauth client.")
@click.option("--provider", prompt=True, help="Provider name")
@click.option("--client-params", prompt=True, help="Client Params")
def setup_system_tool_oauth_client(provider, client_params):
    """
    Setup system tool oauth client
    """
    provider_id = ToolProviderID(provider)
    provider_name = provider_id.provider_name
    plugin_id = provider_id.plugin_id

    try:
        # json validate
        click.echo(click.style(f"Validating client params: {client_params}", fg="yellow"))
        client_params_dict = TypeAdapter(dict[str, Any]).validate_json(client_params)
        click.echo(click.style("Client params validated successfully.", fg="green"))

        click.echo(click.style(f"Encrypting client params: {client_params}", fg="yellow"))
        click.echo(click.style(f"Using SECRET_KEY: `{dify_config.SECRET_KEY}`", fg="yellow"))
        oauth_client_params = encrypt_system_params(client_params_dict)
        click.echo(click.style("Client params encrypted successfully.", fg="green"))
    except Exception as e:
        click.echo(click.style(f"Error parsing client params: {str(e)}", fg="red"))
        return

    deleted_count = cast(
        CursorResult,
        db.session.execute(
            delete(ToolOAuthSystemClient).where(
                ToolOAuthSystemClient.provider == provider_name,
                ToolOAuthSystemClient.plugin_id == plugin_id,
            )
        ),
    ).rowcount
    if deleted_count > 0:
        click.echo(click.style(f"Deleted {deleted_count} existing oauth client params.", fg="yellow"))

    oauth_client = ToolOAuthSystemClient(
        provider=provider_name,
        plugin_id=plugin_id,
        encrypted_oauth_params=oauth_client_params,
    )
    db.session.add(oauth_client)
    db.session.commit()
    click.echo(click.style(f"OAuth client params setup successfully. id: {oauth_client.id}", fg="green"))


@click.command("setup-system-trigger-oauth-client", help="Setup system trigger oauth client.")
@click.option("--provider", prompt=True, help="Provider name")
@click.option("--client-params", prompt=True, help="Client Params")
def setup_system_trigger_oauth_client(provider, client_params):
    """
    Setup system trigger oauth client
    """
    from models.provider_ids import TriggerProviderID
    from models.trigger import TriggerOAuthSystemClient

    provider_id = TriggerProviderID(provider)
    provider_name = provider_id.provider_name
    plugin_id = provider_id.plugin_id

    try:
        # json validate
        click.echo(click.style(f"Validating client params: {client_params}", fg="yellow"))
        client_params_dict = TypeAdapter(dict[str, Any]).validate_json(client_params)
        click.echo(click.style("Client params validated successfully.", fg="green"))

        click.echo(click.style(f"Encrypting client params: {client_params}", fg="yellow"))
        click.echo(click.style(f"Using SECRET_KEY: `{dify_config.SECRET_KEY}`", fg="yellow"))
        oauth_client_params = encrypt_system_params(client_params_dict)
        click.echo(click.style("Client params encrypted successfully.", fg="green"))
    except Exception as e:
        click.echo(click.style(f"Error parsing client params: {str(e)}", fg="red"))
        return

    deleted_count = cast(
        CursorResult,
        db.session.execute(
            delete(TriggerOAuthSystemClient).where(
                TriggerOAuthSystemClient.provider == provider_name,
                TriggerOAuthSystemClient.plugin_id == plugin_id,
            )
        ),
    ).rowcount
    if deleted_count > 0:
        click.echo(click.style(f"Deleted {deleted_count} existing oauth client params.", fg="yellow"))

    oauth_client = TriggerOAuthSystemClient(
        provider=provider_name,
        plugin_id=plugin_id,
        encrypted_oauth_params=oauth_client_params,
    )
    db.session.add(oauth_client)
    db.session.commit()
    click.echo(click.style(f"OAuth client params setup successfully. id: {oauth_client.id}", fg="green"))


@click.command("setup-datasource-oauth-client", help="Setup datasource oauth client.")
@click.option("--provider", prompt=True, help="Provider name")
@click.option("--client-params", prompt=True, help="Client Params")
def setup_datasource_oauth_client(provider, client_params):
    """
    Setup datasource oauth client
    """
    provider_id = DatasourceProviderID(provider)
    provider_name = provider_id.provider_name
    plugin_id = provider_id.plugin_id

    try:
        # json validate
        click.echo(click.style(f"Validating client params: {client_params}", fg="yellow"))
        client_params_dict = TypeAdapter(dict[str, Any]).validate_json(client_params)
        click.echo(click.style("Client params validated successfully.", fg="green"))
    except Exception as e:
        click.echo(click.style(f"Error parsing client params: {str(e)}", fg="red"))
        return

    click.echo(click.style(f"Ready to delete existing oauth client params: {provider_name}", fg="yellow"))
    deleted_count = cast(
        CursorResult,
        db.session.execute(
            delete(DatasourceOauthParamConfig).where(
                DatasourceOauthParamConfig.provider == provider_name,
                DatasourceOauthParamConfig.plugin_id == plugin_id,
            )
        ),
    ).rowcount
    if deleted_count > 0:
        click.echo(click.style(f"Deleted {deleted_count} existing oauth client params.", fg="yellow"))

    click.echo(click.style(f"Ready to setup datasource oauth client: {provider_name}", fg="yellow"))
    oauth_client = DatasourceOauthParamConfig(
        provider=provider_name,
        plugin_id=plugin_id,
        system_credentials=client_params_dict,
    )
    db.session.add(oauth_client)
    db.session.commit()
    click.echo(click.style(f"provider: {provider_name}", fg="green"))
    click.echo(click.style(f"plugin_id: {plugin_id}", fg="green"))
    click.echo(click.style(f"params: {json.dumps(client_params_dict, indent=2, ensure_ascii=False)}", fg="green"))
    click.echo(click.style(f"Datasource oauth client setup successfully. id: {oauth_client.id}", fg="green"))


@click.command("transform-datasource-credentials", help="Transform datasource credentials.")
@click.option(
    "--environment", prompt=True, help="the environment to transform datasource credentials", default="online"
)
def transform_datasource_credentials(environment: str):
    """
    Transform datasource credentials
    """
    try:
        installer_manager = PluginInstaller()
        plugin_migration = PluginMigration()

        notion_plugin_id = "langgenius/notion_datasource"
        firecrawl_plugin_id = "langgenius/firecrawl_datasource"
        jina_plugin_id = "langgenius/jina_datasource"
        if environment == "online":
            notion_package_identifier = plugin_migration._fetch_latest_package_identifier(notion_plugin_id)
            firecrawl_package_identifier = plugin_migration._fetch_latest_package_identifier(firecrawl_plugin_id)
            jina_package_identifier = plugin_migration._fetch_latest_package_identifier(jina_plugin_id)
        else:
            notion_package_identifier = None
            firecrawl_package_identifier = None
            jina_package_identifier = None
        oauth_credential_type = CredentialType.OAUTH2
        api_key_credential_type = CredentialType.API_KEY

        # deal notion credentials
        deal_notion_count = 0
        notion_credentials = db.session.scalars(
            select(DataSourceOauthBinding).where(DataSourceOauthBinding.provider == "notion")
        ).all()
        if notion_credentials:
            notion_credentials_tenant_mapping: dict[str, list[DataSourceOauthBinding]] = {}
            for notion_credential in notion_credentials:
                tenant_id = notion_credential.tenant_id
                if tenant_id not in notion_credentials_tenant_mapping:
                    notion_credentials_tenant_mapping[tenant_id] = []
                notion_credentials_tenant_mapping[tenant_id].append(notion_credential)
            for tenant_id, notion_tenant_credentials in notion_credentials_tenant_mapping.items():
                tenant = db.session.scalar(select(Tenant).where(Tenant.id == tenant_id))
                if not tenant:
                    continue
                try:
                    # check notion plugin is installed
                    installed_plugins = installer_manager.list_plugins(tenant_id)
                    installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
                    if notion_plugin_id not in installed_plugins_ids:
                        if notion_package_identifier:
                            # install notion plugin
                            PluginService.install_from_marketplace_pkg(tenant_id, [notion_package_identifier])
                    auth_count = 0
                    for notion_tenant_credential in notion_tenant_credentials:
                        auth_count += 1
                        # get credential oauth params
                        access_token = notion_tenant_credential.access_token
                        # notion info
                        notion_info = notion_tenant_credential.source_info
                        workspace_id = notion_info.get("workspace_id")
                        workspace_name = notion_info.get("workspace_name")
                        workspace_icon = notion_info.get("workspace_icon")
                        new_credentials = {
                            "integration_secret": encrypter.encrypt_token(tenant_id, access_token),
                            "workspace_id": workspace_id,
                            "workspace_name": workspace_name,
                            "workspace_icon": workspace_icon,
                        }
                        datasource_provider = DatasourceProvider(
                            provider="notion_datasource",
                            tenant_id=tenant_id,
                            plugin_id=notion_plugin_id,
                            auth_type=oauth_credential_type.value,
                            encrypted_credentials=new_credentials,
                            name=f"Auth {auth_count}",
                            avatar_url=workspace_icon or "default",
                            is_default=False,
                        )
                        db.session.add(datasource_provider)
                        deal_notion_count += 1
                except Exception as e:
                    click.echo(
                        click.style(
                            f"Error transforming notion credentials: {str(e)}, tenant_id: {tenant_id}", fg="red"
                        )
                    )
                    continue
                db.session.commit()
        # deal firecrawl credentials
        deal_firecrawl_count = 0
        firecrawl_credentials = db.session.scalars(
            select(DataSourceApiKeyAuthBinding).where(DataSourceApiKeyAuthBinding.provider == "firecrawl")
        ).all()
        if firecrawl_credentials:
            firecrawl_credentials_tenant_mapping: dict[str, list[DataSourceApiKeyAuthBinding]] = {}
            for firecrawl_credential in firecrawl_credentials:
                tenant_id = firecrawl_credential.tenant_id
                if tenant_id not in firecrawl_credentials_tenant_mapping:
                    firecrawl_credentials_tenant_mapping[tenant_id] = []
                firecrawl_credentials_tenant_mapping[tenant_id].append(firecrawl_credential)
            for tenant_id, firecrawl_tenant_credentials in firecrawl_credentials_tenant_mapping.items():
                tenant = db.session.scalar(select(Tenant).where(Tenant.id == tenant_id))
                if not tenant:
                    continue
                try:
                    # check firecrawl plugin is installed
                    installed_plugins = installer_manager.list_plugins(tenant_id)
                    installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
                    if firecrawl_plugin_id not in installed_plugins_ids:
                        if firecrawl_package_identifier:
                            # install firecrawl plugin
                            PluginService.install_from_marketplace_pkg(tenant_id, [firecrawl_package_identifier])

                    auth_count = 0
                    for firecrawl_tenant_credential in firecrawl_tenant_credentials:
                        auth_count += 1
                        if not firecrawl_tenant_credential.credentials:
                            click.echo(
                                click.style(
                                    f"Skipping firecrawl credential for tenant {tenant_id} due to missing credentials.",
                                    fg="yellow",
                                )
                            )
                            continue
                        # get credential api key
                        credentials_json = json.loads(firecrawl_tenant_credential.credentials)
                        api_key = credentials_json.get("config", {}).get("api_key")
                        base_url = credentials_json.get("config", {}).get("base_url")
                        new_credentials = {
                            "firecrawl_api_key": api_key,
                            "base_url": base_url,
                        }
                        datasource_provider = DatasourceProvider(
                            provider="firecrawl",
                            tenant_id=tenant_id,
                            plugin_id=firecrawl_plugin_id,
                            auth_type=api_key_credential_type.value,
                            encrypted_credentials=new_credentials,
                            name=f"Auth {auth_count}",
                            avatar_url="default",
                            is_default=False,
                        )
                        db.session.add(datasource_provider)
                        deal_firecrawl_count += 1
                except Exception as e:
                    click.echo(
                        click.style(
                            f"Error transforming firecrawl credentials: {str(e)}, tenant_id: {tenant_id}", fg="red"
                        )
                    )
                    continue
                db.session.commit()
        # deal jina credentials
        deal_jina_count = 0
        jina_credentials = db.session.scalars(
            select(DataSourceApiKeyAuthBinding).where(DataSourceApiKeyAuthBinding.provider == "jinareader")
        ).all()
        if jina_credentials:
            jina_credentials_tenant_mapping: dict[str, list[DataSourceApiKeyAuthBinding]] = {}
            for jina_credential in jina_credentials:
                tenant_id = jina_credential.tenant_id
                if tenant_id not in jina_credentials_tenant_mapping:
                    jina_credentials_tenant_mapping[tenant_id] = []
                jina_credentials_tenant_mapping[tenant_id].append(jina_credential)
            for tenant_id, jina_tenant_credentials in jina_credentials_tenant_mapping.items():
                tenant = db.session.scalar(select(Tenant).where(Tenant.id == tenant_id))
                if not tenant:
                    continue
                try:
                    # check jina plugin is installed
                    installed_plugins = installer_manager.list_plugins(tenant_id)
                    installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
                    if jina_plugin_id not in installed_plugins_ids:
                        if jina_package_identifier:
                            # install jina plugin
                            logger.debug("Installing Jina plugin %s", jina_package_identifier)
                            PluginService.install_from_marketplace_pkg(tenant_id, [jina_package_identifier])

                    auth_count = 0
                    for jina_tenant_credential in jina_tenant_credentials:
                        auth_count += 1
                        if not jina_tenant_credential.credentials:
                            click.echo(
                                click.style(
                                    f"Skipping jina credential for tenant {tenant_id} due to missing credentials.",
                                    fg="yellow",
                                )
                            )
                            continue
                        # get credential api key
                        credentials_json = json.loads(jina_tenant_credential.credentials)
                        api_key = credentials_json.get("config", {}).get("api_key")
                        new_credentials = {
                            "integration_secret": api_key,
                        }
                        datasource_provider = DatasourceProvider(
                            provider="jinareader",
                            tenant_id=tenant_id,
                            plugin_id=jina_plugin_id,
                            auth_type=api_key_credential_type.value,
                            encrypted_credentials=new_credentials,
                            name=f"Auth {auth_count}",
                            avatar_url="default",
                            is_default=False,
                        )
                        db.session.add(datasource_provider)
                        deal_jina_count += 1
                except Exception as e:
                    click.echo(
                        click.style(f"Error transforming jina credentials: {str(e)}, tenant_id: {tenant_id}", fg="red")
                    )
                    continue
                db.session.commit()
    except Exception as e:
        click.echo(click.style(f"Error parsing client params: {str(e)}", fg="red"))
        return
    click.echo(click.style(f"Transforming notion successfully. deal_notion_count: {deal_notion_count}", fg="green"))
    click.echo(
        click.style(f"Transforming firecrawl successfully. deal_firecrawl_count: {deal_firecrawl_count}", fg="green")
    )
    click.echo(click.style(f"Transforming jina successfully. deal_jina_count: {deal_jina_count}", fg="green"))


@click.command("migrate-data-for-plugin", help="Migrate data for plugin.")
def migrate_data_for_plugin():
    """
    Migrate data for plugin.
    """
    click.echo(click.style("Starting migrate data for plugin.", fg="white"))

    PluginDataMigration.migrate()

    click.echo(click.style("Migrate data for plugin completed.", fg="green"))


def _candidate_auto_upgrade_strategy_tenant_ids_stmt(limit: int | None = None):
    category_count = len(TenantPluginAutoUpgradeCategory)
    stmt = (
        select(TenantPluginAutoUpgradeStrategy.tenant_id)
        .group_by(TenantPluginAutoUpgradeStrategy.tenant_id)
        .having(func.count(func.distinct(TenantPluginAutoUpgradeStrategy.category)) < category_count)
        .order_by(TenantPluginAutoUpgradeStrategy.tenant_id)
    )

    if limit is not None:
        stmt = stmt.limit(limit)

    return stmt


def _count_auto_upgrade_strategy_tenant_ids(limit: int | None) -> int:
    candidate_stmt = _candidate_auto_upgrade_strategy_tenant_ids_stmt(limit).subquery()
    return db.session.scalar(select(func.count()).select_from(candidate_stmt)) or 0


def _iter_auto_upgrade_strategy_tenant_ids(limit: int | None):
    stmt = _candidate_auto_upgrade_strategy_tenant_ids_stmt(limit).execution_options(yield_per=1000)
    yield from db.session.scalars(stmt)


@click.command(
    "backfill-plugin-auto-upgrade",
    help="Backfill category-scoped plugin auto-upgrade strategies and normalize plugin lists.",
)
@click.option("--tenant-id", multiple=True, help="Tenant ID to backfill. Can be passed multiple times.")
@click.option("--limit", type=int, default=None, help="Maximum number of candidate tenants to process.")
@click.option("--batch-size", type=int, default=500, show_default=True, help="Progress reporting batch size.")
@click.option("--dry-run", is_flag=True, help="Only print candidate tenant count.")
def backfill_plugin_auto_upgrade(
    tenant_id: tuple[str, ...],
    limit: int | None,
    batch_size: int,
    dry_run: bool,
):
    """
    Backfill historical auto-upgrade strategies after the category column exists.

    Missing category rows are created from the tenant's tool/default row. Pure default
    strategies become latest for model plugins and fix-only for all other categories.
    Tenants with include/exclude plugin IDs are split
    by installed plugin category using plugin daemon metadata.
    """
    start_at = time.perf_counter()
    candidate_count = len(tenant_id) if tenant_id else _count_auto_upgrade_strategy_tenant_ids(limit)
    click.echo(click.style(f"Found {candidate_count} candidate tenants.", fg="yellow"))

    if dry_run:
        elapsed = time.perf_counter() - start_at
        click.echo(click.style(f"Dry run completed. elapsed={elapsed:.2f}s", fg="green"))
        return

    tenant_ids = list(tenant_id) if tenant_id else _iter_auto_upgrade_strategy_tenant_ids(limit)

    backfilled_count = 0
    created_count = 0
    normalized_count = 0
    skipped_count = 0
    failed_count = 0
    for index, current_tenant_id in enumerate(tenant_ids, start=1):
        try:
            result = PluginAutoUpgradeService.backfill_strategy_categories(
                current_tenant_id,
                session=db.session(),
            )
        except Exception as e:
            failed_count += 1
            click.echo(click.style(f"Failed tenant {current_tenant_id}: {str(e)}", fg="red"))
            continue

        if result.created_count > 0:
            backfilled_count += 1
            created_count += result.created_count
        elif not result.normalized:
            skipped_count += 1
        if result.normalized:
            normalized_count += 1

        if batch_size > 0 and index % batch_size == 0:
            click.echo(
                click.style(
                    f"Processed {index}/{candidate_count} tenants. "
                    f"backfilled={backfilled_count}, created_rows={created_count}, "
                    f"normalized={normalized_count}, skipped={skipped_count}, failed={failed_count}, "
                    f"elapsed={time.perf_counter() - start_at:.2f}s",
                    fg="yellow",
                )
            )

    elapsed = time.perf_counter() - start_at
    click.echo(
        click.style(
            f"Backfill plugin auto-upgrade strategy categories completed. "
            f"backfilled={backfilled_count}, created_rows={created_count}, "
            f"normalized={normalized_count}, skipped={skipped_count}, failed={failed_count}, "
            f"elapsed={elapsed:.2f}s",
            fg="green",
        )
    )


@click.command("extract-plugins", help="Extract plugins.")
@click.option("--output_file", prompt=True, help="The file to store the extracted plugins.", default="plugins.jsonl")
@click.option("--workers", prompt=True, help="The number of workers to extract plugins.", default=10)
def extract_plugins(output_file: str, workers: int):
    """
    Extract plugins.
    """
    click.echo(click.style("Starting extract plugins.", fg="white"))

    PluginMigration.extract_plugins(output_file, workers)

    click.echo(click.style("Extract plugins completed.", fg="green"))


@click.command("extract-unique-identifiers", help="Extract unique identifiers.")
@click.option(
    "--output_file",
    prompt=True,
    help="The file to store the extracted unique identifiers.",
    default="unique_identifiers.json",
)
@click.option(
    "--input_file", prompt=True, help="The file to store the extracted unique identifiers.", default="plugins.jsonl"
)
def extract_unique_plugins(output_file: str, input_file: str):
    """
    Extract unique plugins.
    """
    click.echo(click.style("Starting extract unique plugins.", fg="white"))

    PluginMigration.extract_unique_plugins_to_file(input_file, output_file)

    click.echo(click.style("Extract unique plugins completed.", fg="green"))


@click.command("install-plugins", help="Install plugins.")
@click.option(
    "--input_file", prompt=True, help="The file to store the extracted unique identifiers.", default="plugins.jsonl"
)
@click.option(
    "--output_file", prompt=True, help="The file to store the installed plugins.", default="installed_plugins.jsonl"
)
@click.option("--workers", prompt=True, help="The number of workers to install plugins.", default=100)
def install_plugins(input_file: str, output_file: str, workers: int):
    """
    Install plugins.
    """
    click.echo(click.style("Starting install plugins.", fg="white"))

    PluginMigration.install_plugins(input_file, output_file, workers)

    click.echo(click.style("Install plugins completed.", fg="green"))


@click.command("install-rag-pipeline-plugins", help="Install rag pipeline plugins.")
@click.option(
    "--input_file", prompt=True, help="The file to store the extracted unique identifiers.", default="plugins.jsonl"
)
@click.option(
    "--output_file", prompt=True, help="The file to store the installed plugins.", default="installed_plugins.jsonl"
)
@click.option("--workers", prompt=True, help="The number of workers to install plugins.", default=100)
def install_rag_pipeline_plugins(input_file, output_file, workers):
    """
    Install rag pipeline plugins
    """
    click.echo(click.style("Installing rag pipeline plugins", fg="yellow"))
    plugin_migration = PluginMigration()
    plugin_migration.install_rag_pipeline_plugins(
        input_file,
        output_file,
        workers,
    )
    click.echo(click.style("Installing rag pipeline plugins successfully", fg="green"))
