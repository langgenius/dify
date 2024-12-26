import datetime
import logging
from collections.abc import Sequence

import click
from sqlalchemy.orm import Session

from core.agent.entities import AgentToolEntity
from core.entities import DEFAULT_PLUGIN_ID
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
    def extract_plugins(cls) -> None:
        """
        Migrate plugin.
        """
        click.echo(click.style("Migrating models/tools to new plugin Mechanism", fg="white"))
        ended_at = datetime.datetime.now()
        started_at = datetime.datetime(2023, 4, 3, 8, 59, 24)
        current_time = started_at

        while current_time < ended_at:
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

            for tenant_id in tenants:
                plugins = cls.extract_installed_plugin_ids(tenant_id)
                print(plugins)

            current_time = batch_end

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

        NOTE: rename google to gemini
        """
        models = []
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
                if provider_name and "/" not in provider_name:
                    if provider_name == "google":
                        provider_name = "gemini"

                    result.append(DEFAULT_PLUGIN_ID + "/" + provider_name + "/" + provider_name)
                elif provider_name:
                    result.append(provider_name)

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
                if "/" not in row.provider:
                    result.append(DEFAULT_PLUGIN_ID + "/" + row.provider + "/" + row.provider)
                else:
                    result.append(row.provider)

            return result

    @classmethod
    def _handle_builtin_tool_provider(cls, provider_name: str) -> str:
        """
        Handle builtin tool provider.
        """
        if provider_name == "jina":
            provider_name = "jina_tool"
        elif provider_name == "siliconflow":
            provider_name = "siliconflow_tool"
        elif provider_name == "stepfun":
            provider_name = "stepfun_tool"

        if "/" not in provider_name:
            return DEFAULT_PLUGIN_ID + "/" + provider_name + "/" + provider_name
        else:
            return provider_name

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
                            provider_name = cls._handle_builtin_tool_provider(provider_name)
                            result.append(provider_name)

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
                                    result.append(cls._handle_builtin_tool_provider(tool_entity.provider_id))

                            except Exception:
                                logger.exception(f"Failed to process tool {tool}")
                                continue

            return result
