from typing import Any

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.ops_trace_manager import OpsTraceManager, provider_config_map
from extensions.ext_database import db
from models.model import App, TraceAppConfig


class OpsService:
    @classmethod
    def get_tracing_app_config(cls, app_id: str, tracing_provider: str):
        """
        Get tracing app config
        :param app_id: app id
        :param tracing_provider: tracing provider
        :return:
        """
        trace_config_data: TraceAppConfig | None = (
            db.session.query(TraceAppConfig)
            .where(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
            .first()
        )

        if not trace_config_data:
            return None

        # decrypt_token and obfuscated_token
        app = db.session.query(App).where(App.id == app_id).first()
        if not app:
            return None
        tenant_id = app.tenant_id
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

        trace_config_data.tracing_config = new_decrypt_tracing_config
        return trace_config_data.to_dict()

    @classmethod
    def create_tracing_app_config(cls, app_id: str, tracing_provider: str, tracing_config: dict):
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

        provider_config: dict[str, Any] = provider_config_map[tracing_provider]
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
        elif tracing_provider in ("langsmith", "opik", "tencent"):
            try:
                project_url = OpsTraceManager.get_trace_config_project_url(tracing_config, tracing_provider)
            except Exception:
                project_url = None
        else:
            project_url = None

        # check if trace config already exists
        trace_config_data: TraceAppConfig | None = (
            db.session.query(TraceAppConfig)
            .where(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
            .first()
        )

        if trace_config_data:
            return None

        # get tenant id
        app = db.session.query(App).where(App.id == app_id).first()
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
        db.session.add(trace_config_data)
        db.session.commit()

        return {"result": "success"}

    @classmethod
    def update_tracing_app_config(cls, app_id: str, tracing_provider: str, tracing_config: dict):
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
        current_trace_config = (
            db.session.query(TraceAppConfig)
            .where(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
            .first()
        )

        if not current_trace_config:
            return None

        # get tenant id
        app = db.session.query(App).where(App.id == app_id).first()
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
        db.session.commit()

        return current_trace_config.to_dict()

    @classmethod
    def delete_tracing_app_config(cls, app_id: str, tracing_provider: str):
        """
        Delete tracing app config
        :param app_id: app id
        :param tracing_provider: tracing provider
        :return:
        """
        trace_config = (
            db.session.query(TraceAppConfig)
            .where(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
            .first()
        )

        if not trace_config:
            return None

        db.session.delete(trace_config)
        db.session.commit()

        return True
