import json
from typing import Union
from uuid import UUID

from core.ops.entities.config_entity import LangfuseConfig, LangSmithConfig, TracingProviderEnum
from core.ops.langfuse_trace.langfuse_trace import LangFuseDataTrace
from core.ops.langsmith_trace.langsmith_trace import LangSmithDataTrace
from extensions.ext_database import db
from models.model import App, AppModelConfig, Conversation, Message, TraceAppConfig


class OpsTraceService:
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
        decrypt_tracing_config = cls.decrypt_tracing_config(tenant_id, tracing_provider, trace_config_data.tracing_config)
        decrypt_tracing_config = cls.obfuscated_decrypt_token(tracing_provider, decrypt_tracing_config)

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
        if tracing_provider not in [TracingProviderEnum.LANGFUSE.value,
                                    TracingProviderEnum.LANGSMITH.value] and tracing_provider != "":
            return {"error": f"Invalid tracing provider: {tracing_provider}"}

        # api check
        if not cls.check_trace_config_is_effective(tracing_config, tracing_provider):
            return {"error": "Invalid Credentials"}

        # check if trace config already exists
        trace_config_data: TraceAppConfig = db.session.query(TraceAppConfig).filter(
            TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider
        ).first()

        if trace_config_data:
            return None

        # get tenant id
        tenant_id = db.session.query(App).filter(App.id == app_id).first().tenant_id
        tracing_config = cls.encrypt_tracing_config(tenant_id, tracing_provider, tracing_config)
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
        if tracing_provider not in [TracingProviderEnum.LANGFUSE.value, TracingProviderEnum.LANGSMITH.value]:
            raise ValueError(f"Invalid tracing provider: {tracing_provider}")

        # api check
        # if not cls.check_trace_config_is_effective(tracing_config, tracing_provider):
        #     raise ValueError("Invalid Credentials")

        # check if trace config already exists
        current_trace_config = db.session.query(TraceAppConfig).filter(
            TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider
        ).first()

        if not current_trace_config:
            return None

        # get tenant id
        tenant_id = db.session.query(App).filter(App.id == app_id).first().tenant_id
        tracing_config = cls.encrypt_tracing_config(
            tenant_id, tracing_provider, tracing_config, current_trace_config.tracing_config
        )
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

    @classmethod
    def encrypt_tracing_config(
        cls, tenant_id: str, tracing_provider: str, tracing_config: dict, current_trace_config=None
    ):
        """
        Encrypt tracing config
        :param tenant_id: tenant id
        :param tracing_provider: tracing provider
        :param tracing_config: tracing config
        :param current_trace_config: current trace config
        :return:
        """
        if tracing_provider == TracingProviderEnum.LANGFUSE.value:
            tracing_config = LangfuseConfig(**tracing_config)
            tracing_config = LangFuseDataTrace.encrypt_config(tenant_id, tracing_config, current_trace_config)
        elif tracing_provider == TracingProviderEnum.LANGSMITH.value:
            tracing_config = LangSmithConfig(**tracing_config)
            tracing_config = LangSmithDataTrace.encrypt_config(tenant_id, tracing_config, current_trace_config)

        return tracing_config.model_dump()

    @classmethod
    def decrypt_tracing_config(cls, tenant_id: str, tracing_provider: str, tracing_config: dict):
        """
        Decrypt tracing config
        :param tenant_id: tenant id
        :param tracing_provider: tracing provider
        :param tracing_config: tracing config
        :return:
        """
        if tracing_provider == TracingProviderEnum.LANGFUSE.value:
            tracing_config = LangfuseConfig(**tracing_config)
            tracing_config = LangFuseDataTrace.decrypt_config(tenant_id, tracing_config)
        elif tracing_provider == TracingProviderEnum.LANGSMITH.value:
            tracing_config = LangSmithConfig(**tracing_config)
            tracing_config = LangSmithDataTrace.decrypt_config(tenant_id, tracing_config)

        return tracing_config.model_dump()

    @classmethod
    def obfuscated_decrypt_token(cls, tracing_provider: str, decrypt_tracing_config:dict):
        """
        Decrypt tracing config
        :param tracing_provider: tracing provider
        :param decrypt_tracing_config: tracing config
        :return:
        """
        obfuscate_config = None
        if tracing_provider == TracingProviderEnum.LANGFUSE.value:
            decrypt_tracing_config = LangfuseConfig(**decrypt_tracing_config)
            obfuscate_config = LangFuseDataTrace.obfuscate_config(decrypt_tracing_config)
        elif tracing_provider == TracingProviderEnum.LANGSMITH.value:
            decrypt_tracing_config = LangSmithConfig(**decrypt_tracing_config)
            obfuscate_config = LangSmithDataTrace.obfuscate_config(decrypt_tracing_config)
        return obfuscate_config.model_dump()

    @classmethod
    def get_decrypted_tracing_config(cls, app_id: str, tracing_provider: str):
        """
        Get decrypted tracing config
        :param app_id: app id
        :param tracing_provider: tracing provider
        :return:
        """
        trace_config_data: TraceAppConfig = db.session.query(TraceAppConfig).filter(
            TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider
        ).first()

        if not trace_config_data:
            return None

        # decrypt_token
        tenant_id = db.session.query(App).filter(App.id == app_id).first().tenant_id
        decrypt_tracing_config = cls.decrypt_tracing_config(
            tenant_id, tracing_provider, trace_config_data.tracing_config
        )

        return decrypt_tracing_config

    @classmethod
    def get_ops_trace_instance(
        cls,
        app_id: Union[UUID, str] = None,
        message_id: str = None,
        conversation_id: str = None
    ):
        """
        Get ops trace through model config
        :param app_id: app_id
        :param message_id: message_id
        :param conversation_id: conversation_id
        :return:
        """
        if conversation_id:
            conversation_data: Conversation = db.session.query(Conversation).filter(
                Conversation.id == conversation_id
            ).first()
            app_id = conversation_data.app_id

        if message_id:
            record: Message = db.session.query(Message).filter(Message.id == message_id).first()
            app_id = record.app_id

        if isinstance(app_id, UUID):
            app_id = str(app_id)

        tracing_instance = None
        app: App = db.session.query(App).filter(
            App.id == app_id
        ).first()
        app_ops_trace_config = json.loads(app.tracing) if app.tracing else None

        if app_ops_trace_config is not None:
            tracing_provider = app_ops_trace_config.get('tracing_provider')
        else:
            return None

        # decrypt_token
        decrypt_trace_config = cls.get_decrypted_tracing_config(app_id, tracing_provider)
        if app_ops_trace_config.get('enabled'):
            if tracing_provider == TracingProviderEnum.LANGFUSE.value:
                langfuse_client_public_key = decrypt_trace_config.get('public_key')
                langfuse_client_secret_key = decrypt_trace_config.get('secret_key')
                langfuse_host = decrypt_trace_config.get('host')
                tracing_instance = LangFuseDataTrace(
                    langfuse_client_public_key,
                    langfuse_client_secret_key,
                    langfuse_host,
                )
            elif tracing_provider == TracingProviderEnum.LANGSMITH.value:
                langsmith_api_key = decrypt_trace_config.get('api_key')
                langsmith_project = decrypt_trace_config.get('project')
                langsmith_endpoint = decrypt_trace_config.get('endpoint')
                tracing_instance = LangSmithDataTrace(
                    langsmith_api_key,
                    langsmith_project,
                    langsmith_endpoint,
                )

            return tracing_instance

        return None

    @classmethod
    def get_app_config_through_message_id(cls, message_id: str):
        app_model_config = None
        message_data = db.session.query(Message).filter(Message.id == message_id).first()
        conversation_id = message_data.conversation_id
        conversation_data = db.session.query(Conversation).filter(Conversation.id == conversation_id).first()

        if conversation_data.app_model_config_id:
            app_model_config = db.session.query(AppModelConfig).filter(
                AppModelConfig.id == conversation_data.app_model_config_id
            ).first()
        elif conversation_data.app_model_config_id is None and conversation_data.override_model_configs:
            app_model_config = conversation_data.override_model_configs

        return app_model_config

    @classmethod
    def update_app_tracing_config(cls, app_id: str, enabled: bool, tracing_provider: str):
        """
        Update app tracing config
        :param app_id: app id
        :param enabled: enabled
        :param tracing_provider: tracing provider
        :return:
        """
        # auth check
        if tracing_provider not in [TracingProviderEnum.LANGFUSE.value, TracingProviderEnum.LANGSMITH.value, None, ""]:
            raise ValueError(f"Invalid tracing provider: {tracing_provider}")
        app_config: App = db.session.query(App).filter(App.id == app_id).first()

        app_config.tracing = json.dumps(
            {
                "enabled": enabled,
                "tracing_provider": tracing_provider,
            }
        )
        db.session.commit()

    @classmethod
    def get_app_tracing_config(cls, app_id: str):
        """
        Get app tracing config
        :param app_id: app id
        :return:
        """
        app: App = db.session.query(App).filter(App.id == app_id).first()
        if not app.tracing:
            return {
                "enabled": False,
                "tracing_provider": None
            }
        app_trace_config = json.loads(app.tracing)
        return app_trace_config

    @staticmethod
    def check_trace_config_is_effective(tracing_config: dict, tracing_provider: str):
        """
        Check trace config is effective
        :param tracing_config: tracing config
        :param tracing_provider: tracing provider
        :return:
        """
        if tracing_provider == TracingProviderEnum.LANGFUSE.value:
            tracing_config = LangfuseConfig(**tracing_config)
            langfuse_trace_instance = LangFuseDataTrace(
                tracing_config.public_key,
                tracing_config.secret_key,
                tracing_config.host,
            )
            return langfuse_trace_instance.api_check()
        elif tracing_provider == TracingProviderEnum.LANGSMITH.value:
            tracing_config = LangSmithConfig(**tracing_config)
            langsmith_trace_instance = LangSmithDataTrace(
                tracing_config.api_key,
                tracing_config.project,
                tracing_config.endpoint,
            )
            return langsmith_trace_instance.api_check()
        else:
            raise ValueError(f"Unsupported tracing provider: {tracing_provider}")
