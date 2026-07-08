import datetime
import json
import logging
import time
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import TypedDict
from uuid import uuid4

import click
import sqlalchemy as sa
import tqdm
from flask import Flask, current_app
from pydantic import TypeAdapter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from configs import dify_config
from core.agent.entities import AgentToolEntity
from core.helper import marketplace
from core.plugin.entities.plugin import PluginInstallationSource
from core.plugin.entities.plugin_daemon import PluginInstallTaskStatus
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.plugin_service import PluginService
from core.tools.entities.tool_entities import ToolProviderType
from extensions.ext_database import db
from libs.pagination import paginate_query
from models.account import Tenant
from models.model import App, AppMode, AppModelConfig
from models.provider_ids import ModelProviderID, ToolProviderID
from models.tools import BuiltinToolProvider
from models.workflow import Workflow

logger = logging.getLogger(__name__)

excluded_providers = ["time", "audio", "code", "webscraper"]


class _TenantPluginRecord(TypedDict):
    tenant_id: str
    plugins: list[str]


_tenant_plugin_adapter: TypeAdapter[_TenantPluginRecord] = TypeAdapter(_TenantPluginRecord)


class ExtractedPluginsDict(TypedDict):
    plugins: dict[str, str]
    plugin_not_exist: list[str]


class PluginInstallResultDict(TypedDict):
    success: list[str]
    failed: list[str]


class PluginMigration:
    @classmethod
    def extract_plugins(cls, filepath: str, workers: int):
        """
        Migrate plugin.
        """
        from threading import Lock

        click.echo(click.style("Migrating models/tools to new plugin Mechanism", fg="white"))
        ended_at = datetime.datetime.now()
        started_at = datetime.datetime(2023, 4, 3, 8, 59, 24)
        current_time = started_at

        with Session(db.engine) as session:
            total_tenant_count = session.scalar(select(func.count(Tenant.id))) or 0

        click.echo(click.style(f"Total tenant count: {total_tenant_count}", fg="white"))

        handled_tenant_count = 0
        file_lock = Lock()
        counter_lock = Lock()

        thread_pool = ThreadPoolExecutor(max_workers=workers)

        def process_tenant(flask_app: Flask, tenant_id: str):
            with flask_app.app_context():
                nonlocal handled_tenant_count
                try:
                    plugins = cls.extract_installed_plugin_ids(tenant_id)
                    # Use lock when writing to file
                    with file_lock:
                        with open(filepath, "a") as f:
                            f.write(json.dumps({"tenant_id": tenant_id, "plugins": plugins}) + "\n")

                    # Use lock when updating counter
                    with counter_lock:
                        handled_tenant_count += 1
                        click.echo(
                            click.style(
                                f"[{datetime.datetime.now()}] "
                                f"Processed {handled_tenant_count} tenants "
                                f"({(handled_tenant_count / total_tenant_count) * 100:.1f}%), "
                                f"{handled_tenant_count}/{total_tenant_count}",
                                fg="green",
                            )
                        )
                except Exception:
                    logger.exception("Failed to process tenant %s", tenant_id)

        futures = []

        while current_time < ended_at:
            click.echo(click.style(f"Current time: {current_time}, Started at: {datetime.datetime.now()}", fg="white"))
            # Initial interval of 1 day, will be dynamically adjusted based on tenant count
            interval = datetime.timedelta(days=1)
            # Process tenants in this batch
            with Session(db.engine) as session:
                # Calculate tenant count in next batch with current interval
                # Try different intervals until we find one with a reasonable tenant count
                test_intervals = [
                    datetime.timedelta(days=1),
                    datetime.timedelta(hours=12),
                    datetime.timedelta(hours=6),
                    datetime.timedelta(hours=3),
                    datetime.timedelta(hours=1),
                ]

                tenant_count = 0
                for test_interval in test_intervals:
                    tenant_count = (
                        session.scalar(
                            select(func.count(Tenant.id)).where(
                                Tenant.created_at.between(current_time, current_time + test_interval)
                            )
                        )
                        or 0
                    )
                    if tenant_count <= 100:
                        interval = test_interval
                        break
                else:
                    # If all intervals have too many tenants, use minimum interval
                    interval = datetime.timedelta(hours=1)

                # Adjust interval to target ~100 tenants per batch
                if tenant_count > 0:
                    # Scale interval based on ratio to target count
                    interval = min(
                        datetime.timedelta(days=1),  # Max 1 day
                        max(
                            datetime.timedelta(hours=1),  # Min 1 hour
                            interval * (100 / tenant_count),  # Scale to target 100
                        ),
                    )

                batch_end = min(current_time + interval, ended_at)

                rs = session.execute(
                    select(Tenant.id)
                    .where(Tenant.created_at.between(current_time, batch_end))
                    .order_by(Tenant.created_at)
                )

                tenants = []
                for row in rs:
                    tenant_id = str(row.id)
                    try:
                        tenants.append(tenant_id)
                    except Exception:
                        logger.exception("Failed to process tenant %s", tenant_id)
                        continue

                    futures.append(
                        thread_pool.submit(
                            process_tenant,
                            current_app._get_current_object(),  # type: ignore
                            tenant_id,
                        )
                    )

            current_time = batch_end

        # wait for all threads to finish
        for future in futures:
            future.result()

    @classmethod
    def extract_installed_plugin_ids(cls, tenant_id: str) -> Sequence[str]:
        """
        Extract installed plugin ids.
        """
        tools = cls.extract_tool_tables(tenant_id)
        models = cls.extract_model_tables(tenant_id)
        workflows = cls.extract_workflow_tables(tenant_id)
        apps = cls.extract_app_tables(tenant_id)

        return list({*tools, *models, *workflows, *apps})

    @classmethod
    def extract_model_tables(cls, tenant_id: str) -> Sequence[str]:
        """
        Extract model tables.

        """
        models: list[str] = []
        table_pairs = [
            ("providers", "provider_name"),
            ("provider_models", "provider_name"),
            ("provider_orders", "provider_name"),
            ("tenant_default_models", "provider_name"),
            ("tenant_preferred_model_providers", "provider_name"),
            ("provider_model_settings", "provider_name"),
            ("load_balancing_model_configs", "provider_name"),
        ]

        for table, column in table_pairs:
            models.extend(cls.extract_model_table(tenant_id, table, column))

        # duplicate models
        models = list(set(models))

        return models

    @classmethod
    def extract_model_table(cls, tenant_id: str, table: str, column: str) -> Sequence[str]:
        """
        Extract model table.
        """
        with Session(db.engine) as session:
            rs = session.execute(
                sa.text(f"SELECT DISTINCT {column} FROM {table} WHERE tenant_id = :tenant_id"), {"tenant_id": tenant_id}
            )
            result = []
            for row in rs:
                provider_name = str(row[0])
                result.append(ModelProviderID(provider_name).plugin_id)

            return result

    @classmethod
    def extract_tool_tables(cls, tenant_id: str) -> Sequence[str]:
        """
        Extract tool tables.
        """
        with Session(db.engine) as session:
            rs = session.scalars(select(BuiltinToolProvider).where(BuiltinToolProvider.tenant_id == tenant_id)).all()
            result = []
            for row in rs:
                result.append(ToolProviderID(row.provider).plugin_id)

            return result

    @classmethod
    def extract_workflow_tables(cls, tenant_id: str) -> Sequence[str]:
        """
        Extract workflow tables, only ToolNode is required.
        """

        with Session(db.engine) as session:
            rs = session.scalars(select(Workflow).where(Workflow.tenant_id == tenant_id)).all()
            result = []
            for row in rs:
                graph = row.graph_dict
                # get nodes
                nodes = graph.get("nodes", [])

                for node in nodes:
                    data = node.get("data", {})
                    if data.get("type") == "tool":
                        provider_name = data.get("provider_name")
                        provider_type = data.get("provider_type")
                        if provider_name not in excluded_providers and provider_type == ToolProviderType.BUILT_IN:
                            result.append(ToolProviderID(provider_name).plugin_id)

            return result

    @classmethod
    def extract_app_tables(cls, tenant_id: str) -> Sequence[str]:
        """
        Extract app tables.
        """
        with Session(db.engine) as session:
            apps = session.scalars(select(App).where(App.tenant_id == tenant_id)).all()
            if not apps:
                return []

            agent_app_model_config_ids = [
                app.app_model_config_id for app in apps if app.is_agent or app.mode == AppMode.AGENT_CHAT
            ]

            rs = session.scalars(select(AppModelConfig).where(AppModelConfig.id.in_(agent_app_model_config_ids))).all()
            result = []
            for row in rs:
                agent_config = row.agent_mode_dict
                if "tools" in agent_config and isinstance(agent_config["tools"], list):
                    for tool in agent_config["tools"]:
                        if isinstance(tool, dict):
                            try:
                                tool_entity = AgentToolEntity.model_validate(tool)
                                if (
                                    tool_entity.provider_type == ToolProviderType.BUILT_IN
                                    and tool_entity.provider_id not in excluded_providers
                                ):
                                    result.append(ToolProviderID(tool_entity.provider_id).plugin_id)

                            except Exception:
                                logger.exception("Failed to process tool %s", tool)
                                continue

            return result

    @classmethod
    def _fetch_latest_package_identifier(cls, plugin_id: str) -> str | None:
        """
        Fetch the latest marketplace package identifier using a plugin id.
        """
        if not dify_config.MARKETPLACE_ENABLED:
            return None
        plugin_manifest = marketplace.batch_fetch_plugin_manifests([plugin_id])
        if not plugin_manifest:
            return None

        return plugin_manifest[0].latest_package_identifier

    @classmethod
    def extract_unique_plugins_to_file(cls, extracted_plugins: str, output_file: str):
        """
        Extract unique plugins.
        """
        Path(output_file).write_text(json.dumps(cls.extract_unique_plugins(extracted_plugins)))

    @classmethod
    def extract_unique_plugins(cls, extracted_plugins: str) -> ExtractedPluginsDict:
        package_identifier_by_plugin_id: dict[str, str] = {}
        plugin_ids = []
        plugin_not_exist = []
        logger.info("Extracting unique plugins from %s", extracted_plugins)
        with open(extracted_plugins) as f:
            for line in f:
                data = _tenant_plugin_adapter.validate_json(line)
                for plugin_id in data["plugins"]:
                    if plugin_id not in plugin_ids:
                        plugin_ids.append(plugin_id)

        def fetch_plugin(plugin_id):
            try:
                latest_package_identifier = cls._fetch_latest_package_identifier(plugin_id)
                if latest_package_identifier:
                    package_identifier_by_plugin_id[plugin_id] = latest_package_identifier
                else:
                    plugin_not_exist.append(plugin_id)
            except Exception:
                logger.exception("Failed to fetch latest package identifier for %s", plugin_id)
                plugin_not_exist.append(plugin_id)

        with ThreadPoolExecutor(max_workers=10) as executor:
            list(tqdm.tqdm(executor.map(fetch_plugin, plugin_ids), total=len(plugin_ids)))

        return {"plugins": package_identifier_by_plugin_id, "plugin_not_exist": plugin_not_exist}

    @classmethod
    def install_plugins(cls, extracted_plugins: str, output_file: str, workers: int = 100):
        """
        Install plugins.
        """
        manager = PluginInstaller()

        extracted = cls.extract_unique_plugins(extracted_plugins)
        package_identifier_by_plugin_id = extracted["plugins"]
        not_installed = []
        plugin_install_failed = []

        # use a fake tenant id to install all the plugins
        fake_tenant_id = uuid4().hex
        logger.info(
            "Installing %s plugin instances for fake tenant %s",
            len(package_identifier_by_plugin_id),
            fake_tenant_id,
        )

        thread_pool = ThreadPoolExecutor(max_workers=workers)

        response = cls.handle_plugin_instance_install(fake_tenant_id, package_identifier_by_plugin_id)
        if response.get("failed"):
            plugin_install_failed.extend(response.get("failed", []))

        def install(tenant_id: str, plugin_ids: list[str]):
            logger.info("Installing %s plugins for tenant %s", len(plugin_ids), tenant_id)
            # fetch plugin already installed
            installed_plugins = manager.list_plugins(tenant_id)
            installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
            # at most 64 plugins one batch
            for i in range(0, len(plugin_ids), 64):
                batch_plugin_ids = plugin_ids[i : i + 64]
                batch_package_identifiers = [
                    package_identifier_by_plugin_id[plugin_id]
                    for plugin_id in batch_plugin_ids
                    if plugin_id not in installed_plugins_ids and plugin_id in package_identifier_by_plugin_id
                ]
                if batch_package_identifiers:
                    manager.install_from_identifiers(
                        tenant_id,
                        batch_package_identifiers,
                        PluginInstallationSource.Marketplace,
                        metas=[
                            {
                                "plugin_unique_identifier": package_identifier,
                            }
                            for package_identifier in batch_package_identifiers
                        ],
                    )
                    PluginService.invalidate_plugin_model_providers_cache(tenant_id)

        with open(extracted_plugins) as f:
            """
            Read line by line, and install plugins for each tenant.
            """
            for line in f:
                data = _tenant_plugin_adapter.validate_json(line)
                tenant_id = data["tenant_id"]
                plugin_ids = data["plugins"]
                plugin_not_exist = [
                    plugin_id for plugin_id in plugin_ids if plugin_id not in package_identifier_by_plugin_id
                ]

                if plugin_not_exist:
                    not_installed.append(
                        {
                            "tenant_id": tenant_id,
                            "plugin_not_exist": plugin_not_exist,
                        }
                    )

                thread_pool.submit(install, tenant_id, plugin_ids)

        thread_pool.shutdown(wait=True)

        logger.info("Uninstall plugins")

        # get installation
        try:
            installation = manager.list_plugins(fake_tenant_id)
            while installation:
                for plugin in installation:
                    manager.uninstall(fake_tenant_id, plugin.installation_id)

                installation = manager.list_plugins(fake_tenant_id)
        except Exception:
            logger.exception("Failed to get installation for tenant %s", fake_tenant_id)

        Path(output_file).write_text(
            json.dumps(
                {
                    "not_installed": not_installed,
                    "plugin_install_failed": plugin_install_failed,
                }
            )
        )

    @classmethod
    def install_rag_pipeline_plugins(cls, extracted_plugins: str, output_file: str, workers: int = 100) -> None:
        """
        Install rag pipeline plugins.
        """
        manager = PluginInstaller()

        extracted = cls.extract_unique_plugins(extracted_plugins)
        package_identifier_by_plugin_id = extracted["plugins"]
        plugin_install_failed = []

        # use a fake tenant id to install all the plugins
        fake_tenant_id = uuid4().hex
        logger.info(
            "Installing %s plugin instances for fake tenant %s",
            len(package_identifier_by_plugin_id),
            fake_tenant_id,
        )

        thread_pool = ThreadPoolExecutor(max_workers=workers)

        response = cls.handle_plugin_instance_install(fake_tenant_id, package_identifier_by_plugin_id)
        if response.get("failed"):
            plugin_install_failed.extend(response.get("failed", []))

        def install(
            tenant_id: str,
            package_identifier_by_plugin_id: dict[str, str],
            total_success_tenant: int,
            total_failed_tenant: int,
        ) -> None:
            logger.info("Installing %s plugins for tenant %s", len(package_identifier_by_plugin_id), tenant_id)
            try:
                # fetch plugin already installed
                installed_plugins = manager.list_plugins(tenant_id)
                installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
                # at most 64 plugins one batch
                for i in range(0, len(package_identifier_by_plugin_id), 64):
                    batch_plugin_ids = list(package_identifier_by_plugin_id.keys())[i : i + 64]
                    batch_package_identifiers = [
                        package_identifier_by_plugin_id[plugin_id]
                        for plugin_id in batch_plugin_ids
                        if plugin_id not in installed_plugins_ids and plugin_id in package_identifier_by_plugin_id
                    ]
                    PluginService.install_from_marketplace_pkg(tenant_id, batch_package_identifiers)

                total_success_tenant += 1
            except Exception:
                logger.exception("Failed to install plugins for tenant %s", tenant_id)
                total_failed_tenant += 1

        page = 1
        total_success_tenant = 0
        total_failed_tenant = 0
        while True:
            # paginate
            tenants = paginate_query(sa.select(Tenant).order_by(Tenant.created_at.desc()), page=page, per_page=100)
            if tenants.items is None or len(tenants.items) == 0:
                break

            for tenant in tenants:
                tenant_id = tenant.id
                # get plugin unique identifier
                thread_pool.submit(
                    install,
                    tenant_id,
                    package_identifier_by_plugin_id,
                    total_success_tenant,
                    total_failed_tenant,
                )

            page += 1

        thread_pool.shutdown(wait=True)

        # uninstall all the plugins for fake tenant
        try:
            installation = manager.list_plugins(fake_tenant_id)
            while installation:
                for plugin in installation:
                    manager.uninstall(fake_tenant_id, plugin.installation_id)

                installation = manager.list_plugins(fake_tenant_id)
        except Exception:
            logger.exception("Failed to get installation for tenant %s", fake_tenant_id)

        Path(output_file).write_text(
            json.dumps(
                {
                    "total_success_tenant": total_success_tenant,
                    "total_failed_tenant": total_failed_tenant,
                    "plugin_install_failed": plugin_install_failed,
                }
            )
        )

    @classmethod
    def handle_plugin_instance_install(
        cls, tenant_id: str, package_identifier_by_plugin_id: Mapping[str, str]
    ) -> PluginInstallResultDict:
        """
        Install plugins for a tenant.
        """
        if package_identifier_by_plugin_id and not dify_config.MARKETPLACE_ENABLED:
            raise ValueError(
                "Marketplace disabled in offline mode; cannot bulk-install plugins. "
                "Pre-upload plugin packages via Console first."
            )
        manager = PluginInstaller()

        # download all the plugins and upload
        thread_pool = ThreadPoolExecutor(max_workers=10)
        futures = []

        for plugin_id, package_identifier in package_identifier_by_plugin_id.items():

            def download_and_upload(tenant_id, plugin_id, package_identifier):
                plugin_package = marketplace.download_plugin_pkg(package_identifier)
                if not plugin_package:
                    raise Exception(f"Failed to download plugin {package_identifier}")

                # upload
                manager.upload_pkg(tenant_id, plugin_package, verify_signature=True)

            futures.append(thread_pool.submit(download_and_upload, tenant_id, plugin_id, package_identifier))

        # Wait for all downloads to complete
        for future in futures:
            future.result()  # This will raise any exceptions that occurred

        thread_pool.shutdown(wait=True)
        success = []
        failed = []

        plugin_id_by_package_identifier = {v: k for k, v in package_identifier_by_plugin_id.items()}

        # at most 8 plugins one batch
        for i in range(0, len(package_identifier_by_plugin_id), 8):
            batch_plugin_ids = list(package_identifier_by_plugin_id.keys())[i : i + 8]
            batch_package_identifiers = [package_identifier_by_plugin_id[plugin_id] for plugin_id in batch_plugin_ids]

            try:
                response = manager.install_from_identifiers(
                    tenant_id=tenant_id,
                    identifiers=batch_package_identifiers,
                    source=PluginInstallationSource.Marketplace,
                    metas=[
                        {
                            "plugin_unique_identifier": package_identifier,
                        }
                        for package_identifier in batch_package_identifiers
                    ],
                )
                PluginService.invalidate_plugin_model_providers_cache(tenant_id)
            except Exception:
                # add to failed
                failed.extend(batch_plugin_ids)
                continue

            if response.all_installed:
                success.extend(batch_plugin_ids)
                continue

            task_id = response.task_id
            done = False
            while not done:
                status = manager.fetch_plugin_installation_task(tenant_id, task_id)
                if status.status in [PluginInstallTaskStatus.Failed, PluginInstallTaskStatus.Success]:
                    PluginService.invalidate_plugin_model_providers_cache(tenant_id)
                    for plugin in status.plugins:
                        plugin_id = plugin_id_by_package_identifier.get(
                            plugin.plugin_unique_identifier, plugin.plugin_unique_identifier.split(":", 1)[0]
                        )
                        if plugin.status == PluginInstallTaskStatus.Success:
                            success.append(plugin_id)
                        else:
                            failed.append(plugin_id)
                            logger.error(
                                "Failed to install plugin %s, error: %s",
                                plugin.plugin_unique_identifier,
                                plugin.message,
                            )

                    done = True
                else:
                    time.sleep(1)

        return {"success": success, "failed": failed}
