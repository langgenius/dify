import datetime
import logging
import time
from collections.abc import Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

import click
import sqlalchemy as sa
import tqdm
from flask import Flask, current_app
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from configs import dify_config
from core.agent.entities import AgentToolEntity
from core.helper import marketplace
from core.plugin.entities.plugin_daemon import PluginInstallTask, PluginInstallTaskStatus
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.plugin_service import PluginService
from core.tools.entities.tool_entities import ToolProviderType
from extensions.ext_database import db
from models.account import Tenant
from models.model import App, AppMode, AppModelConfig
from models.provider_ids import ModelProviderID, ToolProviderID
from models.tools import BuiltinToolProvider
from models.workflow import Workflow
from services.plugin.plugin_migration_models import (
    ExtractedPluginIdentifiers,
    PluginIdentifierResolution,
    PluginInstallBatch,
    PluginInstallResult,
    PluginInstallSummary,
    RagPipelinePluginInstallSummary,
    TenantPluginInstallOutcome,
    TenantPluginInstallPlan,
    TenantPluginNotInstalled,
    TenantPluginRecord,
)

logger = logging.getLogger(__name__)

excluded_providers = ["time", "audio", "code", "webscraper"]
TENANT_INSTALL_BATCH_SIZE = 64
PLUGIN_INSTANCE_INSTALL_BATCH_SIZE = 8
PLUGIN_UPLOAD_WORKERS = 10
PLUGIN_INSTALL_POLL_INTERVAL_SECONDS = 1
PLUGIN_INSTALL_TASK_TIMEOUT_SECONDS = 30 * 60


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
            total_tenant_count = session.scalar(select(func.count(Tenant.id))) or 0

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
                            record = TenantPluginRecord(tenant_id=tenant_id, plugins=list(plugins))
                            f.write(record.model_dump_json(by_alias=True) + "\n")

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
    def _fetch_plugin_unique_identifier(cls, plugin_id: str) -> str | None:
        """
        Fetch plugin unique identifier using plugin id.
        """
        if not dify_config.MARKETPLACE_ENABLED:
            return None
        plugin_manifest = marketplace.batch_fetch_plugin_manifests([plugin_id])
        if not plugin_manifest:
            return None

        return plugin_manifest[0].latest_package_identifier

    @classmethod
    def extract_unique_plugins_to_file(cls, extracted_plugins: str, output_file: str) -> None:
        """
        Extract unique plugins.
        """
        Path(output_file).write_text(cls.extract_unique_plugins(extracted_plugins).model_dump_json(by_alias=True))

    @classmethod
    def extract_unique_plugins(cls, extracted_plugins: str) -> ExtractedPluginIdentifiers:
        plugins: dict[str, str] = {}
        plugin_ids: list[str] = []
        seen_plugin_ids: set[str] = set()
        unresolved_plugin_ids: list[str] = []
        logger.info("Extracting unique plugins from %s", extracted_plugins)
        with open(extracted_plugins) as f:
            for line in f:
                record = TenantPluginRecord.model_validate_json(line)
                for plugin_id in record.plugin_ids:
                    if plugin_id not in seen_plugin_ids:
                        seen_plugin_ids.add(plugin_id)
                        plugin_ids.append(plugin_id)

        def fetch_plugin(plugin_id: str) -> PluginIdentifierResolution:
            try:
                return PluginIdentifierResolution(plugin_id, cls._fetch_plugin_unique_identifier(plugin_id))
            except Exception:
                logger.exception("Failed to fetch plugin unique identifier for %s", plugin_id)
                return PluginIdentifierResolution(plugin_id, None)

        with ThreadPoolExecutor(max_workers=10) as executor:
            with tqdm.tqdm(total=len(plugin_ids)) as progress:
                for resolution in executor.map(fetch_plugin, plugin_ids):
                    if resolution.unique_identifier:
                        plugins[resolution.plugin_id] = resolution.unique_identifier
                    else:
                        unresolved_plugin_ids.append(resolution.plugin_id)
                    progress.update()

        return ExtractedPluginIdentifiers(plugins=plugins, plugin_not_exist=unresolved_plugin_ids)

    @classmethod
    def _install_resolved_plugins_for_tenant(cls, plan: TenantPluginInstallPlan) -> TenantPluginInstallOutcome:
        """
        Install already-resolved marketplace plugins for one tenant.

        The outcome always uses plugin IDs, not plugin unique identifiers, so JSON summaries can be traced back to the
        extracted tenant records without mixing daemon identifier formats into migration output.
        """
        installable_plugin_ids = plan.installable_plugin_ids
        if not installable_plugin_ids:
            return TenantPluginInstallOutcome(tenant_id=plan.tenant_id)

        logger.info("Installing %s plugins for tenant %s", len(installable_plugin_ids), plan.tenant_id)
        manager = PluginInstaller()
        try:
            installed_plugins = manager.list_plugins(plan.tenant_id)
            installed_plugin_ids = {plugin.plugin_id for plugin in installed_plugins}
        except Exception:
            logger.exception("Failed to prepare plugin installation for tenant %s", plan.tenant_id)
            return TenantPluginInstallOutcome(
                tenant_id=plan.tenant_id,
                failed_plugin_ids=installable_plugin_ids,
            )

        failed_plugin_ids: list[str] = []
        for i in range(0, len(installable_plugin_ids), TENANT_INSTALL_BATCH_SIZE):
            batch_plugin_ids = installable_plugin_ids[i : i + TENANT_INSTALL_BATCH_SIZE]
            pending_plugin_ids = tuple(
                plugin_id for plugin_id in batch_plugin_ids if plugin_id not in installed_plugin_ids
            )
            if not pending_plugin_ids:
                continue

            result = cls._install_resolved_plugin_batch(
                PluginInstallBatch.from_plugin_ids(plan.tenant_id, pending_plugin_ids, plan.identifier_by_id),
                manager,
            )
            failed_plugin_ids.extend(result.failed_plugin_ids)

        return TenantPluginInstallOutcome(
            tenant_id=plan.tenant_id,
            failed_plugin_ids=tuple(failed_plugin_ids),
        )

    @classmethod
    def _install_resolved_plugin_batch(
        cls, batch: PluginInstallBatch, manager: PluginInstaller | None = None
    ) -> PluginInstallResult:
        """
        Install a resolved marketplace batch and wait until the daemon reaches a terminal task state.

        Plugin migration summaries are keyed by migration plugin ID, while the daemon reports package
        unique identifiers. Keeping that translation here gives both fake-tenant preinstall and real-tenant install
        the same failure semantics.
        """
        if not batch.plugin_ids:
            return PluginInstallResult()

        manager = manager or PluginInstaller()
        try:
            response = PluginService.install_from_resolved_marketplace_identifiers(
                batch.tenant_id,
                batch.plugin_unique_identifiers,
            )
        except Exception:
            logger.exception("Failed to start plugin installation task for tenant %s", batch.tenant_id)
            return PluginInstallResult(failed_plugin_ids=batch.plugin_ids)

        if response.all_installed:
            return PluginInstallResult(successful_plugin_ids=batch.plugin_ids)

        if not response.task_id:
            logger.error("Plugin installation for tenant %s did not return a task id", batch.tenant_id)
            return PluginInstallResult(failed_plugin_ids=batch.plugin_ids)

        return cls._wait_for_plugin_installation_task(manager, batch, response.task_id)

    @classmethod
    def _wait_for_plugin_installation_task(
        cls, manager: PluginInstaller, batch: PluginInstallBatch, task_id: str
    ) -> PluginInstallResult:
        deadline = time.monotonic() + PLUGIN_INSTALL_TASK_TIMEOUT_SECONDS
        terminal_statuses = {PluginInstallTaskStatus.Failed, PluginInstallTaskStatus.Success}

        while True:
            try:
                status = manager.fetch_plugin_installation_task(batch.tenant_id, task_id)
            except Exception:
                logger.exception("Failed to fetch plugin installation task %s for tenant %s", task_id, batch.tenant_id)
                PluginService.invalidate_plugin_model_providers_cache(batch.tenant_id)
                return PluginInstallResult(failed_plugin_ids=batch.plugin_ids)

            if status.status in terminal_statuses:
                PluginService.invalidate_plugin_model_providers_cache(batch.tenant_id)
                return cls._plugin_install_result_from_task_status(batch, status)

            if time.monotonic() >= deadline:
                logger.error(
                    "Timed out waiting for plugin installation task %s for tenant %s", task_id, batch.tenant_id
                )
                PluginService.invalidate_plugin_model_providers_cache(batch.tenant_id)
                return PluginInstallResult(failed_plugin_ids=batch.plugin_ids)

            time.sleep(PLUGIN_INSTALL_POLL_INTERVAL_SECONDS)

    @staticmethod
    def _plugin_install_result_from_task_status(
        batch: PluginInstallBatch, status: PluginInstallTask
    ) -> PluginInstallResult:
        successful_plugin_ids: list[str] = []
        failed_plugin_ids: list[str] = []
        resolved_plugin_ids: set[str] = set()
        plugin_id_by_identifier = batch.plugin_id_by_identifier

        for plugin in status.plugins:
            plugin_id = plugin_id_by_identifier.get(plugin.plugin_unique_identifier)
            if plugin_id is None:
                logger.warning(
                    "Ignoring install task status for unexpected plugin %s in tenant %s",
                    plugin.plugin_unique_identifier,
                    batch.tenant_id,
                )
                continue

            if plugin_id in resolved_plugin_ids:
                continue

            resolved_plugin_ids.add(plugin_id)
            if plugin.status == PluginInstallTaskStatus.Success:
                successful_plugin_ids.append(plugin_id)
            else:
                failed_plugin_ids.append(plugin_id)
                logger.error(
                    "Failed to install plugin %s for tenant %s, error: %s",
                    plugin.plugin_unique_identifier,
                    batch.tenant_id,
                    plugin.message,
                )

        missing_plugin_ids = tuple(plugin_id for plugin_id in batch.plugin_ids if plugin_id not in resolved_plugin_ids)
        if status.status == PluginInstallTaskStatus.Success:
            successful_plugin_ids.extend(missing_plugin_ids)
        else:
            failed_plugin_ids.extend(missing_plugin_ids)

        return PluginInstallResult(
            successful_plugin_ids=tuple(successful_plugin_ids),
            failed_plugin_ids=tuple(failed_plugin_ids),
        )

    @classmethod
    def _uninstall_all_plugins_for_tenant(cls, tenant_id: str) -> None:
        """Remove every plugin installation for a temporary migration tenant."""
        manager = PluginInstaller()
        try:
            installation = manager.list_plugins(tenant_id)
            while installation:
                for plugin in installation:
                    manager.uninstall(tenant_id, plugin.installation_id)

                installation = manager.list_plugins(tenant_id)
        except Exception:
            logger.exception("Failed to get installation for tenant %s", tenant_id)

    @classmethod
    def install_plugins(cls, extracted_plugins: str, output_file: str, workers: int = 100) -> None:
        """
        Install plugins.
        """
        extracted_plugin_identifiers = cls.extract_unique_plugins(extracted_plugins)
        plugin_identifier_by_id = extracted_plugin_identifiers.identifier_by_id
        not_installed: list[TenantPluginNotInstalled] = []
        failed_plugin_ids: list[str] = []

        # use a fake tenant id to install all the plugins
        fake_tenant_id = uuid4().hex
        logger.info("Installing %s plugin instances for fake tenant %s", len(plugin_identifier_by_id), fake_tenant_id)

        try:
            response = cls.handle_plugin_instance_install(fake_tenant_id, plugin_identifier_by_id)
            failed_plugin_ids.extend(response.failed_plugin_ids)

            # Read line by line, and install plugins for each tenant.
            futures: list[Future[TenantPluginInstallOutcome]] = []
            with ThreadPoolExecutor(max_workers=workers) as thread_pool:
                with open(extracted_plugins) as f:
                    for line in f:
                        record = TenantPluginRecord.model_validate_json(line)
                        plan = TenantPluginInstallPlan.from_record(record, plugin_identifier_by_id)

                        if plan.unresolved_plugin_ids:
                            not_installed.append(plan.to_not_installed_record())

                        if plan.installable_plugin_ids:
                            futures.append(thread_pool.submit(cls._install_resolved_plugins_for_tenant, plan))

            for future in futures:
                outcome = future.result()
                failed_plugin_ids.extend(outcome.failed_plugin_ids)
        finally:
            logger.info("Uninstall plugins")
            cls._uninstall_all_plugins_for_tenant(fake_tenant_id)

        summary = PluginInstallSummary(
            not_installed=not_installed,
            plugin_install_failed=failed_plugin_ids,
        )
        Path(output_file).write_text(summary.model_dump_json(by_alias=True))

    @classmethod
    def install_rag_pipeline_plugins(cls, extracted_plugins: str, output_file: str, workers: int = 100) -> None:
        """
        Install rag pipeline plugins.
        """
        extracted_plugin_identifiers = cls.extract_unique_plugins(extracted_plugins)
        plugin_identifier_by_id = extracted_plugin_identifiers.identifier_by_id
        unresolved_plugin_ids = tuple(extracted_plugin_identifiers.unresolved_plugin_ids)
        failed_plugin_ids: list[str] = list(unresolved_plugin_ids)

        # use a fake tenant id to install all the plugins
        fake_tenant_id = uuid4().hex
        logger.info("Installing %s plugin instances for fake tenant %s", len(plugin_identifier_by_id), fake_tenant_id)

        try:
            response = cls.handle_plugin_instance_install(fake_tenant_id, plugin_identifier_by_id)
            failed_plugin_ids.extend(response.failed_plugin_ids)

            page = 1
            futures: list[Future[TenantPluginInstallOutcome]] = []
            with ThreadPoolExecutor(max_workers=workers) as thread_pool:
                while True:
                    # paginate
                    tenants = db.paginate(sa.select(Tenant).order_by(Tenant.created_at.desc()), page=page, per_page=100)
                    if tenants.items is None or len(tenants.items) == 0:
                        break

                    for tenant in tenants:
                        tenant_id = tenant.id
                        plan = TenantPluginInstallPlan.from_resolved_identifiers(tenant_id, plugin_identifier_by_id)
                        futures.append(thread_pool.submit(cls._install_resolved_plugins_for_tenant, plan))

                    page += 1

            total_success_tenant = 0
            total_failed_tenant = 0
            for future in futures:
                outcome = future.result()
                if outcome.succeeded and not unresolved_plugin_ids:
                    total_success_tenant += 1
                else:
                    total_failed_tenant += 1
                    failed_plugin_ids.extend(outcome.failed_plugin_ids)
        finally:
            # uninstall all the plugins for fake tenant
            cls._uninstall_all_plugins_for_tenant(fake_tenant_id)

        summary = RagPipelinePluginInstallSummary(
            total_success_tenant=total_success_tenant,
            total_failed_tenant=total_failed_tenant,
            plugin_install_failed=failed_plugin_ids,
        )
        Path(output_file).write_text(summary.model_dump_json(by_alias=True))

    @classmethod
    def handle_plugin_instance_install(
        cls, tenant_id: str, plugin_identifiers_map: Mapping[str, str]
    ) -> PluginInstallResult:
        """
        Install plugins for a tenant.
        """
        if plugin_identifiers_map and not dify_config.MARKETPLACE_ENABLED:
            raise ValueError(
                "Marketplace disabled in offline mode; cannot bulk-install plugins. "
                "Pre-upload plugin packages via Console first."
            )
        manager = PluginInstaller()

        # download all the plugins and upload
        futures: dict[Future[None], str] = {}
        uploaded_plugin_ids: list[str] = []
        upload_failed_plugin_ids: set[str] = set()

        def download_and_upload(tenant_id: str, plugin_identifier: str) -> None:
            plugin_package = marketplace.download_plugin_pkg(plugin_identifier)
            if not plugin_package:
                raise Exception(f"Failed to download plugin {plugin_identifier}")

            # upload
            manager.upload_pkg(tenant_id, plugin_package, verify_signature=True)

        with ThreadPoolExecutor(max_workers=PLUGIN_UPLOAD_WORKERS) as thread_pool:
            for plugin_id, plugin_identifier in plugin_identifiers_map.items():
                futures[thread_pool.submit(download_and_upload, tenant_id, plugin_identifier)] = plugin_id

            # Wait for all downloads to complete
            for future, plugin_id in futures.items():
                try:
                    future.result()
                except Exception:
                    logger.exception("Failed to download or upload plugin %s for tenant %s", plugin_id, tenant_id)
                    upload_failed_plugin_ids.add(plugin_id)
                else:
                    uploaded_plugin_ids.append(plugin_id)

        successful_plugin_ids: list[str] = []
        failed_plugin_ids = [plugin_id for plugin_id in plugin_identifiers_map if plugin_id in upload_failed_plugin_ids]
        uploaded_identifier_by_id = {plugin_id: plugin_identifiers_map[plugin_id] for plugin_id in uploaded_plugin_ids}

        # at most 8 plugins one batch
        for i in range(0, len(uploaded_plugin_ids), PLUGIN_INSTANCE_INSTALL_BATCH_SIZE):
            batch_plugin_ids = uploaded_plugin_ids[i : i + PLUGIN_INSTANCE_INSTALL_BATCH_SIZE]
            batch = PluginInstallBatch.from_plugin_ids(tenant_id, batch_plugin_ids, uploaded_identifier_by_id)
            result = cls._install_resolved_plugin_batch(batch, manager)
            successful_plugin_ids.extend(result.successful_plugin_ids)
            failed_plugin_ids.extend(result.failed_plugin_ids)

        return PluginInstallResult(
            successful_plugin_ids=tuple(successful_plugin_ids),
            failed_plugin_ids=tuple(failed_plugin_ids),
        )
