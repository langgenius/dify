import datetime
import json
import logging
import time
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

import click
import tqdm
from flask import Flask, current_app
from sqlalchemy.orm import Session

from core.agent.entities import AgentToolEntity
from core.helper import marketplace
from core.plugin.entities.plugin import ModelProviderID, PluginInstallationSource, ToolProviderID
from core.plugin.entities.plugin_daemon import PluginInstallTaskStatus
from core.plugin.impl.plugin import PluginInstaller
from core.tools.entities.tool_entities import ToolProviderType
from models.account import Tenant
from models.engine import db
from models.model import App, AppMode, AppModelConfig
from models.tools import BuiltinToolProvider
from models.workflow import Workflow

logger = logging.getLogger(__name__)

excluded_providers = ["time", "audio", "code", "webscraper"]


class PluginMigration:
    @classmethod
    def extract_plugins(cls, filepath: str, workers: int) -> None:
        """
        Migrate plugin.
        """
        from threading import Lock

        click.echo(click.style("Migrating models/tools to new plugin Mechanism", fg="white"))
        ended_at = datetime.datetime.now()
        started_at = datetime.datetime(2023, 4, 3, 8, 59, 24)
        current_time = started_at

        with Session(db.engine) as session:
            total_tenant_count = session.query(Tenant.id).count()

        click.echo(click.style(f"Total tenant count: {total_tenant_count}", fg="white"))

        handled_tenant_count = 0
        file_lock = Lock()
        counter_lock = Lock()

        thread_pool = ThreadPoolExecutor(max_workers=workers)

        def process_tenant(flask_app: Flask, tenant_id: str) -> None:
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
                        nonlocal handled_tenant_count
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
                    logger.exception(f"Failed to process tenant {tenant_id}")

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

                for test_interval in test_intervals:
                    tenant_count = (
                        session.query(Tenant.id)
                        .filter(Tenant.created_at.between(current_time, current_time + test_interval))
                        .count()
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

                rs = (
                    session.query(Tenant.id)
                    .filter(Tenant.created_at.between(current_time, batch_end))
                    .order_by(Tenant.created_at)
                )

                tenants = []
                for row in rs:
                    tenant_id = str(row.id)
                    try:
                        tenants.append(tenant_id)
                    except Exception:
                        logger.exception(f"Failed to process tenant {tenant_id}")
                        continue

                    futures.append(
                        thread_pool.submit(
                            process_tenant,
                            current_app._get_current_object(),  # type: ignore[attr-defined]
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
                db.text(f"SELECT DISTINCT {column} FROM {table} WHERE tenant_id = :tenant_id"), {"tenant_id": tenant_id}
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
            rs = session.query(BuiltinToolProvider).filter(BuiltinToolProvider.tenant_id == tenant_id).all()
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
            rs = session.query(Workflow).filter(Workflow.tenant_id == tenant_id).all()
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
                        if provider_name not in excluded_providers and provider_type == ToolProviderType.BUILT_IN.value:
                            result.append(ToolProviderID(provider_name).plugin_id)

            return result

    @classmethod
    def extract_app_tables(cls, tenant_id: str) -> Sequence[str]:
        """
        Extract app tables.
        """
        with Session(db.engine) as session:
            apps = session.query(App).filter(App.tenant_id == tenant_id).all()
            if not apps:
                return []

            agent_app_model_config_ids = [
                app.app_model_config_id for app in apps if app.is_agent or app.mode == AppMode.AGENT_CHAT.value
            ]

            rs = session.query(AppModelConfig).filter(AppModelConfig.id.in_(agent_app_model_config_ids)).all()
            result = []
            for row in rs:
                agent_config = row.agent_mode_dict
                if "tools" in agent_config and isinstance(agent_config["tools"], list):
                    for tool in agent_config["tools"]:
                        if isinstance(tool, dict):
                            try:
                                tool_entity = AgentToolEntity(**tool)
                                if (
                                    tool_entity.provider_type == ToolProviderType.BUILT_IN.value
                                    and tool_entity.provider_id not in excluded_providers
                                ):
                                    result.append(ToolProviderID(tool_entity.provider_id).plugin_id)

                            except Exception:
                                logger.exception(f"Failed to process tool {tool}")
                                continue

            return result

    @classmethod
    def _fetch_plugin_unique_identifier(cls, plugin_id: str) -> Optional[str]:
        """
        Fetch plugin unique identifier using plugin id.
        """
        plugin_manifest = marketplace.batch_fetch_plugin_manifests([plugin_id])
        if not plugin_manifest:
            return None

        return plugin_manifest[0].latest_package_identifier

    @classmethod
    def extract_unique_plugins_to_file(cls, extracted_plugins: str, output_file: str) -> None:
        """
        Extract unique plugins.
        """
        Path(output_file).write_text(json.dumps(cls.extract_unique_plugins(extracted_plugins)))

    @classmethod
    def extract_unique_plugins(cls, extracted_plugins: str) -> Mapping[str, Any]:
        plugins: dict[str, str] = {}
        plugin_ids = []
        plugin_not_exist = []
        logger.info(f"Extracting unique plugins from {extracted_plugins}")
        with open(extracted_plugins) as f:
            for line in f:
                data = json.loads(line)
                new_plugin_ids = data.get("plugins", [])
                for plugin_id in new_plugin_ids:
                    if plugin_id not in plugin_ids:
                        plugin_ids.append(plugin_id)

        def fetch_plugin(plugin_id):
            try:
                unique_identifier = cls._fetch_plugin_unique_identifier(plugin_id)
                if unique_identifier:
                    plugins[plugin_id] = unique_identifier
                else:
                    plugin_not_exist.append(plugin_id)
            except Exception:
                logger.exception(f"Failed to fetch plugin unique identifier for {plugin_id}")
                plugin_not_exist.append(plugin_id)

        with ThreadPoolExecutor(max_workers=10) as executor:
            list(tqdm.tqdm(executor.map(fetch_plugin, plugin_ids), total=len(plugin_ids)))

        return {"plugins": plugins, "plugin_not_exist": plugin_not_exist}

    @classmethod
    def install_plugins(cls, extracted_plugins: str, output_file: str, workers: int = 100) -> None:
        """
        Install plugins.
        """
        manager = PluginInstaller()

        plugins = cls.extract_unique_plugins(extracted_plugins)
        not_installed = []
        plugin_install_failed = []

        # use a fake tenant id to install all the plugins
        fake_tenant_id = uuid4().hex
        logger.info(f"Installing {len(plugins['plugins'])} plugin instances for fake tenant {fake_tenant_id}")

        thread_pool = ThreadPoolExecutor(max_workers=workers)

        response = cls.handle_plugin_instance_install(fake_tenant_id, plugins["plugins"])
        if response.get("failed"):
            plugin_install_failed.extend(response.get("failed", []))

        def install(tenant_id: str, plugin_ids: list[str]) -> None:
            logger.info(f"Installing {len(plugin_ids)} plugins for tenant {tenant_id}")
            # fetch plugin already installed
            installed_plugins = manager.list_plugins(tenant_id)
            installed_plugins_ids = [plugin.plugin_id for plugin in installed_plugins]
            # at most 64 plugins one batch
            for i in range(0, len(plugin_ids), 64):
                batch_plugin_ids = plugin_ids[i : i + 64]
                batch_plugin_identifiers = [
                    plugins["plugins"][plugin_id]
                    for plugin_id in batch_plugin_ids
                    if plugin_id not in installed_plugins_ids and plugin_id in plugins["plugins"]
                ]
                manager.install_from_identifiers(
                    tenant_id,
                    batch_plugin_identifiers,
                    PluginInstallationSource.Marketplace,
                    metas=[
                        {
                            "plugin_unique_identifier": identifier,
                        }
                        for identifier in batch_plugin_identifiers
                    ],
                )

        with open(extracted_plugins) as f:
            """
            Read line by line, and install plugins for each tenant.
            """
            for line in f:
                data = json.loads(line)
                tenant_id = data.get("tenant_id")
                plugin_ids = data.get("plugins", [])
                current_not_installed = {
                    "tenant_id": tenant_id,
                    "plugin_not_exist": [],
                }
                # get plugin unique identifier
                for plugin_id in plugin_ids:
                    unique_identifier = plugins.get(plugin_id)
                    if unique_identifier:
                        current_not_installed["plugin_not_exist"].append(plugin_id)

                if current_not_installed["plugin_not_exist"]:
                    not_installed.append(current_not_installed)

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
            logger.exception(f"Failed to get installation for tenant {fake_tenant_id}")

        Path(output_file).write_text(
            json.dumps(
                {
                    "not_installed": not_installed,
                    "plugin_install_failed": plugin_install_failed,
                }
            )
        )

    @classmethod
    def handle_plugin_instance_install(
        cls, tenant_id: str, plugin_identifiers_map: Mapping[str, str]
    ) -> Mapping[str, Any]:
        """
        Install plugins for a tenant.
        """
        manager = PluginInstaller()

        # download all the plugins and upload
        thread_pool = ThreadPoolExecutor(max_workers=10)
        futures = []

        for plugin_id, plugin_identifier in plugin_identifiers_map.items():

            def download_and_upload(tenant_id, plugin_id, plugin_identifier):
                plugin_package = marketplace.download_plugin_pkg(plugin_identifier)
                if not plugin_package:
                    raise Exception(f"Failed to download plugin {plugin_identifier}")

                # upload
                manager.upload_pkg(tenant_id, plugin_package, verify_signature=True)

            futures.append(thread_pool.submit(download_and_upload, tenant_id, plugin_id, plugin_identifier))

        # Wait for all downloads to complete
        for future in futures:
            future.result()  # This will raise any exceptions that occurred

        thread_pool.shutdown(wait=True)
        success = []
        failed = []

        reverse_map = {v: k for k, v in plugin_identifiers_map.items()}

        # at most 8 plugins one batch
        for i in range(0, len(plugin_identifiers_map), 8):
            batch_plugin_ids = list(plugin_identifiers_map.keys())[i : i + 8]
            batch_plugin_identifiers = [plugin_identifiers_map[plugin_id] for plugin_id in batch_plugin_ids]

            try:
                response = manager.install_from_identifiers(
                    tenant_id=tenant_id,
                    identifiers=batch_plugin_identifiers,
                    source=PluginInstallationSource.Marketplace,
                    metas=[
                        {
                            "plugin_unique_identifier": identifier,
                        }
                        for identifier in batch_plugin_identifiers
                    ],
                )
            except Exception:
                # add to failed
                failed.extend(batch_plugin_identifiers)
                continue

            if response.all_installed:
                success.extend(batch_plugin_identifiers)
                continue

            task_id = response.task_id
            done = False
            while not done:
                status = manager.fetch_plugin_installation_task(tenant_id, task_id)
                if status.status in [PluginInstallTaskStatus.Failed, PluginInstallTaskStatus.Success]:
                    for plugin in status.plugins:
                        if plugin.status == PluginInstallTaskStatus.Success:
                            success.append(reverse_map[plugin.plugin_unique_identifier])
                        else:
                            failed.append(reverse_map[plugin.plugin_unique_identifier])
                            logger.error(
                                f"Failed to install plugin {plugin.plugin_unique_identifier}, error: {plugin.message}"
                            )

                    done = True
                else:
                    time.sleep(1)

        return {"success": success, "failed": failed}
