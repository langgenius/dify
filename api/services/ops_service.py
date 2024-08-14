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
        trace_config_data: TraceAppConfig = db.session.query(TraceAppConfig).filter(
            TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider
        ).first()

        if not trace_config_data:
            return None

        # decrypt_token and obfuscated_token
        tenant_id = db.session.query(App).filter(App.id == app_id).first().tenant_id
        decrypt_tracing_config = OpsTraceManager.decrypt_tracing_config(tenant_id, tracing_provider, trace_config_data.tracing_config)
        decrypt_tracing_config = OpsTraceManager.obfuscated_decrypt_token(tracing_provider, decrypt_tracing_config)

        trace_config_data.tracing_config = decrypt_tracing_config

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
        if tracing_provider not in provider_config_map.keys() and tracing_provider != None:
            return {"error": f"Invalid tracing provider: {tracing_provider}"}

        config_class, other_keys = provider_config_map[tracing_provider]['config_class'], \
            provider_config_map[tracing_provider]['other_keys']
        default_config_instance = config_class(**tracing_config)
        for key in other_keys:
            if key in tracing_config and tracing_config[key] == "":
                tracing_config[key] = getattr(default_config_instance, key, None)

        # api check
        if not OpsTraceManager.check_trace_config_is_effective(tracing_config, tracing_provider):
            return {"error": "Invalid Credentials"}

        # check if trace config already exists
        trace_config_data: TraceAppConfig = db.session.query(TraceAppConfig).filter(
            TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider
        ).first()

        if trace_config_data:
            return None

        # get tenant id
        tenant_id = db.session.query(App).filter(App.id == app_id).first().tenant_id
        tracing_config = OpsTraceManager.encrypt_tracing_config(tenant_id, tracing_provider, tracing_config)
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
        if tracing_provider not in provider_config_map.keys():
            raise ValueError(f"Invalid tracing provider: {tracing_provider}")

        # check if trace config already exists
        current_trace_config = db.session.query(TraceAppConfig).filter(
            TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider
        ).first()

        if not current_trace_config:
            return None

        # get tenant id
        tenant_id = db.session.query(App).filter(App.id == app_id).first().tenant_id
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
        trace_config = db.session.query(TraceAppConfig).filter(
            TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider
        ).first()

        if not trace_config:
            return None

        db.session.delete(trace_config)
        db.session.commit()

        return True
