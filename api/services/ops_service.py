import logging
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.ops.entities.config_entity import BaseTracingConfig, TracingProviderEnum
from core.ops.ops_trace_manager import OpsTraceManager, TracingProviderConfigEntry, provider_config_map
from models.model import App, TraceAppConfig

logger = logging.getLogger(__name__)

_SUPPORTED_TRACING_PROVIDERS = frozenset(provider.value for provider in TracingProviderEnum)


class OpsService:
    @classmethod
    def get_tracing_app_config(cls, app_id: str, tracing_provider: str, session: Session):
        """
        Get tracing app config
        :param app_id: app id
        :param tracing_provider: tracing provider
        :return:
        """
        trace_config_data: TraceAppConfig | None = session.scalar(
            select(TraceAppConfig)
            .where(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
            .order_by(TraceAppConfig.id)
            .limit(1)
        )

        if not trace_config_data:
            return None

        app = session.get(App, app_id)
        if not app:
            return None

        return cls._serialize_tracing_app_config(trace_config_data, app.tenant_id)

    @classmethod
    def get_tracing_app_configs(cls, app_id: str, include_config: bool, session: Session) -> dict[str, Any]:
        """Return configured providers and optionally their obfuscated configurations in one query."""
        if not include_config:
            configured_providers = session.scalars(
                select(TraceAppConfig.tracing_provider)
                .where(TraceAppConfig.app_id == app_id)
                .order_by(TraceAppConfig.tracing_provider, TraceAppConfig.id)
            ).all()
            return {"configured_providers": cls._canonical_provider_names(configured_providers), "configs": None}

        trace_configs = list(
            session.scalars(
                select(TraceAppConfig)
                .where(TraceAppConfig.app_id == app_id)
                .order_by(TraceAppConfig.tracing_provider, TraceAppConfig.id)
            ).all()
        )
        canonical_trace_configs = cls._canonical_tracing_configs(trace_configs, app_id)
        configured_providers = [config.tracing_provider for config in canonical_trace_configs]
        if not canonical_trace_configs:
            return {"configured_providers": configured_providers, "configs": []}

        app = session.get(App, app_id)
        if not app:
            return {"configured_providers": [], "configs": []}

        serialized_configs: list[dict[str, Any]] = []
        for config in canonical_trace_configs:
            try:
                serialized_configs.append(cls._serialize_tracing_app_config(config, app.tenant_id))
            except Exception:
                logger.exception(
                    "Failed to serialize tracing config %s for app %s and provider %s",
                    config.id,
                    app_id,
                    config.tracing_provider,
                )
                serialized_configs.append(
                    {
                        "id": config.id,
                        "app_id": config.app_id,
                        "tracing_provider": config.tracing_provider,
                        "error": "config_unavailable",
                    }
                )

        return {"configured_providers": configured_providers, "configs": serialized_configs}

    @staticmethod
    def _canonical_provider_names(providers: Sequence[str | None]) -> list[str]:
        return list(
            dict.fromkeys(
                provider
                for provider in providers
                if provider is not None and provider in _SUPPORTED_TRACING_PROVIDERS
            )
        )

    @staticmethod
    def _canonical_tracing_configs(trace_configs: list[TraceAppConfig], app_id: str) -> list[TraceAppConfig]:
        canonical_configs: list[TraceAppConfig] = []
        seen_providers: set[str] = set()
        for config in trace_configs:
            provider = config.tracing_provider
            if provider is None or provider not in _SUPPORTED_TRACING_PROVIDERS:
                logger.warning(
                    "Ignoring unsupported tracing provider %s for app %s and config %s",
                    provider,
                    app_id,
                    config.id,
                )
                continue
            if provider in seen_providers:
                logger.warning(
                    "Ignoring duplicate tracing config %s for app %s and provider %s",
                    config.id,
                    app_id,
                    provider,
                )
                continue
            seen_providers.add(provider)
            canonical_configs.append(config)
        return canonical_configs

    @classmethod
    def _serialize_tracing_app_config(cls, trace_config_data: TraceAppConfig, tenant_id: str) -> dict[str, Any]:
        """Decrypt a stored tracing configuration and return an obfuscated API representation."""
        tracing_provider = trace_config_data.tracing_provider
        if not tracing_provider:
            raise ValueError("Tracing provider cannot be None.")
        if trace_config_data.tracing_config is None:
            raise ValueError("Tracing config cannot be None.")
        decrypt_tracing_config = OpsTraceManager.decrypt_tracing_config(
            tenant_id, tracing_provider, trace_config_data.tracing_config
        )
        new_decrypt_tracing_config = OpsTraceManager.obfuscated_decrypt_token(tracing_provider, decrypt_tracing_config)

        if tracing_provider == "arize" and (
            "project_url" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_url")
        ):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update({"project_url": project_url})
            except Exception:
                new_decrypt_tracing_config.update({"project_url": "https://app.arize.com/"})

        if tracing_provider == "phoenix" and (
            "project_url" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_url")
        ):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update({"project_url": project_url})
            except Exception:
                new_decrypt_tracing_config.update({"project_url": "https://app.phoenix.arize.com/projects/"})

        if tracing_provider == "langfuse" and (
            "project_key" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_key")
        ):
            try:
                project_key = OpsTraceManager.get_trace_config_project_key(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update(
                    {
                        "project_url": "{host}/project/{key}".format(
                            host=decrypt_tracing_config.get("host"), key=project_key
                        )
                    }
                )
            except Exception:
                new_decrypt_tracing_config.update({"project_url": f"{decrypt_tracing_config.get('host')}/"})

        if tracing_provider == "langsmith" and (
            "project_url" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_url")
        ):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update({"project_url": project_url})
            except Exception:
                new_decrypt_tracing_config.update({"project_url": "https://smith.langchain.com/"})

        if tracing_provider == "opik" and (
            "project_url" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_url")
        ):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update({"project_url": project_url})
            except Exception:
                new_decrypt_tracing_config.update({"project_url": "https://www.comet.com/opik/"})
        if tracing_provider == "weave" and (
            "project_url" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_url")
        ):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update({"project_url": project_url})
            except Exception:
                new_decrypt_tracing_config.update({"project_url": "https://wandb.ai/"})

        if tracing_provider == "aliyun" and (
            "project_url" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_url")
        ):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update({"project_url": project_url})
            except Exception:
                new_decrypt_tracing_config.update({"project_url": "https://arms.console.aliyun.com/"})

        if tracing_provider == "tencent" and (
            "project_url" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_url")
        ):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update({"project_url": project_url})
            except Exception:
                new_decrypt_tracing_config.update({"project_url": "https://console.cloud.tencent.com/apm"})

        if tracing_provider == "mlflow" and (
            "project_url" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_url")
        ):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update({"project_url": project_url})
            except Exception:
                new_decrypt_tracing_config.update({"project_url": "http://localhost:5000/"})

        if tracing_provider == "databricks" and (
            "project_url" not in decrypt_tracing_config or not decrypt_tracing_config.get("project_url")
        ):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(decrypt_tracing_config, tracing_provider)
                new_decrypt_tracing_config.update({"project_url": project_url})
            except Exception:
                new_decrypt_tracing_config.update({"project_url": "https://www.databricks.com/"})

        result: dict[str, Any] = dict(trace_config_data.to_dict())
        result["tracing_config"] = new_decrypt_tracing_config
        return result

    @classmethod
    def create_tracing_app_config(
        cls, app_id: str, tracing_provider: str, tracing_config: dict[str, Any], session: Session
    ):
        """
        Create tracing app config
        :param app_id: app id
        :param tracing_provider: tracing provider
        :param tracing_config: tracing config
        :return:
        """
        try:
            provider_config_map[tracing_provider]
        except KeyError:
            return {"error": f"Invalid tracing provider: {tracing_provider}"}

        provider_config: TracingProviderConfigEntry = provider_config_map[tracing_provider]
        config_class: type[BaseTracingConfig] = provider_config["config_class"]
        other_keys: list[str] = provider_config["other_keys"]

        default_config_instance = config_class.model_validate(tracing_config)
        for key in other_keys:
            if key in tracing_config and tracing_config[key] == "":
                tracing_config[key] = getattr(default_config_instance, key, None)

        # api check
        if not OpsTraceManager.check_trace_config_is_effective(tracing_config, tracing_provider):
            return {"error": "Invalid Credentials"}

        # get project url
        if tracing_provider in ("arize", "phoenix"):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(tracing_config, tracing_provider)
            except Exception:
                project_url = None
        elif tracing_provider == "langfuse":
            try:
                project_key = OpsTraceManager.get_trace_config_project_key(tracing_config, tracing_provider)
                project_url = f"{tracing_config.get('host')}/project/{project_key}"
            except Exception:
                project_url = None
        elif tracing_provider in ("langsmith", "opik", "mlflow", "databricks", "tencent"):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(tracing_config, tracing_provider)
            except Exception:
                project_url = None
        else:
            project_url = None

        # check if trace config already exists
        trace_config_data: TraceAppConfig | None = session.scalar(
            select(TraceAppConfig)
            .where(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
            .order_by(TraceAppConfig.id)
            .limit(1)
        )

        if trace_config_data:
            return None

        # get tenant id
        app = session.get(App, app_id)
        if not app:
            return None
        tenant_id = app.tenant_id
        tracing_config = OpsTraceManager.encrypt_tracing_config(tenant_id, tracing_provider, tracing_config)
        if project_url:
            tracing_config["project_url"] = project_url
        trace_config_data = TraceAppConfig(
            app_id=app_id,
            tracing_provider=tracing_provider,
            tracing_config=tracing_config,
        )
        session.add(trace_config_data)
        session.commit()

        return {"result": "success"}

    @classmethod
    def update_tracing_app_config(
        cls, app_id: str, tracing_provider: str, tracing_config: dict[str, Any], session: Session
    ):
        """
        Update tracing app config
        :param app_id: app id
        :param tracing_provider: tracing provider
        :param tracing_config: tracing config
        :return:
        """
        try:
            provider_config_map[tracing_provider]
        except KeyError:
            raise ValueError(f"Invalid tracing provider: {tracing_provider}")

        # check if trace config already exists
        trace_configs = list(
            session.scalars(
                select(TraceAppConfig)
                .where(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
                .order_by(TraceAppConfig.id)
            ).all()
        )
        current_trace_config = trace_configs[0] if trace_configs else None

        if not current_trace_config:
            return None

        # get tenant id
        app = session.get(App, app_id)
        if not app:
            return None
        tenant_id = app.tenant_id
        tracing_config = OpsTraceManager.encrypt_tracing_config(
            tenant_id, tracing_provider, tracing_config, current_trace_config.tracing_config
        )

        # api check
        # decrypt_token
        decrypt_tracing_config = OpsTraceManager.decrypt_tracing_config(tenant_id, tracing_provider, tracing_config)
        if not OpsTraceManager.check_trace_config_is_effective(decrypt_tracing_config, tracing_provider):
            raise ValueError("Invalid Credentials")

        current_trace_config.tracing_config = tracing_config
        for duplicate_config in trace_configs[1:]:
            session.delete(duplicate_config)
        session.commit()

        return current_trace_config.to_dict()

    @classmethod
    def delete_tracing_app_config(cls, app_id: str, tracing_provider: str, session: Session):
        """
        Delete tracing app config
        :param app_id: app id
        :param tracing_provider: tracing provider
        :return:
        """
        trace_configs = list(
            session.scalars(
                select(TraceAppConfig)
                .where(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
                .order_by(TraceAppConfig.id)
            ).all()
        )

        if not trace_configs:
            return None

        for trace_config in trace_configs:
            session.delete(trace_config)
        session.commit()

        return True
