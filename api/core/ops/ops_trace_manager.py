import json
import logging
import os
import queue
import threading
import time
from datetime import timedelta
from typing import Any, Optional, Union
from uuid import UUID, uuid4

from cachetools import LRUCache
from flask import current_app
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.helper.encrypter import decrypt_token, encrypt_token, obfuscated_token
from core.ops.entities.config_entity import (
    OPS_FILE_PATH,
    TracingProviderEnum,
)
from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    SuggestedQuestionTraceInfo,
    TaskData,
    ToolTraceInfo,
    TraceTaskName,
    WorkflowTraceInfo,
)
from core.ops.utils import get_message_data
from core.workflow.entities.workflow_execution import WorkflowExecution
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.model import App, AppModelConfig, Conversation, Message, MessageFile, TraceAppConfig
from models.workflow import WorkflowAppLog, WorkflowRun
from tasks.ops_trace_task import process_trace_tasks


class OpsTraceProviderConfigMap(dict[str, dict[str, Any]]):
    def __getitem__(self, provider: str) -> dict[str, Any]:
        match provider:
            case TracingProviderEnum.LANGFUSE:
                from core.ops.entities.config_entity import LangfuseConfig
                from core.ops.langfuse_trace.langfuse_trace import LangFuseDataTrace

                return {
                    "config_class": LangfuseConfig,
                    "secret_keys": ["public_key", "secret_key"],
                    "other_keys": ["host", "project_key"],
                    "trace_instance": LangFuseDataTrace,
                }

            case TracingProviderEnum.LANGSMITH:
                from core.ops.entities.config_entity import LangSmithConfig
                from core.ops.langsmith_trace.langsmith_trace import LangSmithDataTrace

                return {
                    "config_class": LangSmithConfig,
                    "secret_keys": ["api_key"],
                    "other_keys": ["project", "endpoint"],
                    "trace_instance": LangSmithDataTrace,
                }

            case TracingProviderEnum.OPIK:
                from core.ops.entities.config_entity import OpikConfig
                from core.ops.opik_trace.opik_trace import OpikDataTrace

                return {
                    "config_class": OpikConfig,
                    "secret_keys": ["api_key"],
                    "other_keys": ["project", "url", "workspace"],
                    "trace_instance": OpikDataTrace,
                }

            case TracingProviderEnum.WEAVE:
                from core.ops.entities.config_entity import WeaveConfig
                from core.ops.weave_trace.weave_trace import WeaveDataTrace

                return {
                    "config_class": WeaveConfig,
                    "secret_keys": ["api_key"],
                    "other_keys": ["project", "entity", "endpoint", "host"],
                    "trace_instance": WeaveDataTrace,
                }
            case TracingProviderEnum.ARIZE:
                from core.ops.arize_phoenix_trace.arize_phoenix_trace import ArizePhoenixDataTrace
                from core.ops.entities.config_entity import ArizeConfig

                return {
                    "config_class": ArizeConfig,
                    "secret_keys": ["api_key", "space_id"],
                    "other_keys": ["project", "endpoint"],
                    "trace_instance": ArizePhoenixDataTrace,
                }
            case TracingProviderEnum.PHOENIX:
                from core.ops.arize_phoenix_trace.arize_phoenix_trace import ArizePhoenixDataTrace
                from core.ops.entities.config_entity import PhoenixConfig

                return {
                    "config_class": PhoenixConfig,
                    "secret_keys": ["api_key"],
                    "other_keys": ["project", "endpoint"],
                    "trace_instance": ArizePhoenixDataTrace,
                }
            case TracingProviderEnum.ALIYUN:
                from core.ops.aliyun_trace.aliyun_trace import AliyunDataTrace
                from core.ops.entities.config_entity import AliyunConfig

                return {
                    "config_class": AliyunConfig,
                    "secret_keys": ["license_key"],
                    "other_keys": ["endpoint", "app_name"],
                    "trace_instance": AliyunDataTrace,
                }

            case _:
                raise KeyError(f"Unsupported tracing provider: {provider}")


provider_config_map: dict[str, dict[str, Any]] = OpsTraceProviderConfigMap()


class OpsTraceManager:
    ops_trace_instances_cache: LRUCache = LRUCache(maxsize=128)

    @classmethod
    def encrypt_tracing_config(
        cls, tenant_id: str, tracing_provider: str, tracing_config: dict, current_trace_config=None
    ):
        """
        Encrypt tracing config.
        :param tenant_id: tenant id
        :param tracing_provider: tracing provider
        :param tracing_config: tracing config dictionary to be encrypted
        :param current_trace_config: current tracing configuration for keeping existing values
        :return: encrypted tracing configuration
        """
        # Get the configuration class and the keys that require encryption
        config_class, secret_keys, other_keys = (
            provider_config_map[tracing_provider]["config_class"],
            provider_config_map[tracing_provider]["secret_keys"],
            provider_config_map[tracing_provider]["other_keys"],
        )

        new_config = {}
        # Encrypt necessary keys
        for key in secret_keys:
            if key in tracing_config:
                if "*" in tracing_config[key]:
                    # If the key contains '*', retain the original value from the current config
                    new_config[key] = current_trace_config.get(key, tracing_config[key])
                else:
                    # Otherwise, encrypt the key
                    new_config[key] = encrypt_token(tenant_id, tracing_config[key])

        for key in other_keys:
            new_config[key] = tracing_config.get(key, "")

        # Create a new instance of the config class with the new configuration
        encrypted_config = config_class(**new_config)
        return encrypted_config.model_dump()

    @classmethod
    def decrypt_tracing_config(cls, tenant_id: str, tracing_provider: str, tracing_config: dict):
        """
        Decrypt tracing config
        :param tenant_id: tenant id
        :param tracing_provider: tracing provider
        :param tracing_config: tracing config
        :return:
        """
        config_class, secret_keys, other_keys = (
            provider_config_map[tracing_provider]["config_class"],
            provider_config_map[tracing_provider]["secret_keys"],
            provider_config_map[tracing_provider]["other_keys"],
        )
        new_config = {}
        for key in secret_keys:
            if key in tracing_config:
                new_config[key] = decrypt_token(tenant_id, tracing_config[key])

        for key in other_keys:
            new_config[key] = tracing_config.get(key, "")

        return config_class(**new_config).model_dump()

    @classmethod
    def obfuscated_decrypt_token(cls, tracing_provider: str, decrypt_tracing_config: dict):
        """
        Decrypt tracing config
        :param tracing_provider: tracing provider
        :param decrypt_tracing_config: tracing config
        :return:
        """
        config_class, secret_keys, other_keys = (
            provider_config_map[tracing_provider]["config_class"],
            provider_config_map[tracing_provider]["secret_keys"],
            provider_config_map[tracing_provider]["other_keys"],
        )
        new_config = {}
        for key in secret_keys:
            if key in decrypt_tracing_config:
                new_config[key] = obfuscated_token(decrypt_tracing_config[key])

        for key in other_keys:
            new_config[key] = decrypt_tracing_config.get(key, "")
        return config_class(**new_config).model_dump()

    @classmethod
    def get_decrypted_tracing_config(cls, app_id: str, tracing_provider: str):
        """
        Get decrypted tracing config
        :param app_id: app id
        :param tracing_provider: tracing provider
        :return:
        """
        trace_config_data: Optional[TraceAppConfig] = (
            db.session.query(TraceAppConfig)
            .filter(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
            .first()
        )

        if not trace_config_data:
            return None

        # decrypt_token
        app = db.session.query(App).filter(App.id == app_id).first()
        if not app:
            raise ValueError("App not found")

        tenant_id = app.tenant_id
        decrypt_tracing_config = cls.decrypt_tracing_config(
            tenant_id, tracing_provider, trace_config_data.tracing_config
        )

        return decrypt_tracing_config

    @classmethod
    def get_ops_trace_instance(
        cls,
        app_id: Optional[Union[UUID, str]] = None,
    ):
        """
        Get ops trace through model config
        :param app_id: app_id
        :return:
        """
        if isinstance(app_id, UUID):
            app_id = str(app_id)

        if app_id is None:
            return None

        app: Optional[App] = db.session.query(App).filter(App.id == app_id).first()

        if app is None:
            return None

        app_ops_trace_config = json.loads(app.tracing) if app.tracing else None
        if app_ops_trace_config is None:
            return None
        if not app_ops_trace_config.get("enabled"):
            return None

        tracing_provider = app_ops_trace_config.get("tracing_provider")
        if tracing_provider is None:
            return None
        try:
            provider_config_map[tracing_provider]
        except KeyError:
            return None

        # decrypt_token
        decrypt_trace_config = cls.get_decrypted_tracing_config(app_id, tracing_provider)
        if not decrypt_trace_config:
            return None

        trace_instance, config_class = (
            provider_config_map[tracing_provider]["trace_instance"],
            provider_config_map[tracing_provider]["config_class"],
        )
        decrypt_trace_config_key = json.dumps(decrypt_trace_config, sort_keys=True)
        tracing_instance = cls.ops_trace_instances_cache.get(decrypt_trace_config_key)
        if tracing_instance is None:
            # create new tracing_instance and update the cache if it absent
            tracing_instance = trace_instance(config_class(**decrypt_trace_config))
            cls.ops_trace_instances_cache[decrypt_trace_config_key] = tracing_instance
            logging.info(f"new tracing_instance for app_id: {app_id}")
        return tracing_instance

    @classmethod
    def get_app_config_through_message_id(cls, message_id: str):
        app_model_config = None
        message_data = db.session.query(Message).filter(Message.id == message_id).first()
        if not message_data:
            return None
        conversation_id = message_data.conversation_id
        conversation_data = db.session.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not conversation_data:
            return None

        if conversation_data.app_model_config_id:
            app_model_config = (
                db.session.query(AppModelConfig)
                .filter(AppModelConfig.id == conversation_data.app_model_config_id)
                .first()
            )
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
        if enabled == True:
            try:
                provider_config_map[tracing_provider]
            except KeyError:
                raise ValueError(f"Invalid tracing provider: {tracing_provider}")
        else:
            if tracing_provider is not None:
                raise ValueError(f"Invalid tracing provider: {tracing_provider}")

        app_config: Optional[App] = db.session.query(App).filter(App.id == app_id).first()
        if not app_config:
            raise ValueError("App not found")
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
        app: Optional[App] = db.session.query(App).filter(App.id == app_id).first()
        if not app:
            raise ValueError("App not found")
        if not app.tracing:
            return {"enabled": False, "tracing_provider": None}
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
        config_type, trace_instance = (
            provider_config_map[tracing_provider]["config_class"],
            provider_config_map[tracing_provider]["trace_instance"],
        )
        tracing_config = config_type(**tracing_config)
        return trace_instance(tracing_config).api_check()

    @staticmethod
    def get_trace_config_project_key(tracing_config: dict, tracing_provider: str):
        """
        get trace config is project key
        :param tracing_config: tracing config
        :param tracing_provider: tracing provider
        :return:
        """
        config_type, trace_instance = (
            provider_config_map[tracing_provider]["config_class"],
            provider_config_map[tracing_provider]["trace_instance"],
        )
        tracing_config = config_type(**tracing_config)
        return trace_instance(tracing_config).get_project_key()

    @staticmethod
    def get_trace_config_project_url(tracing_config: dict, tracing_provider: str):
        """
        get trace config is project key
        :param tracing_config: tracing config
        :param tracing_provider: tracing provider
        :return:
        """
        config_type, trace_instance = (
            provider_config_map[tracing_provider]["config_class"],
            provider_config_map[tracing_provider]["trace_instance"],
        )
        tracing_config = config_type(**tracing_config)
        return trace_instance(tracing_config).get_project_url()


class TraceTask:
    def __init__(
        self,
        trace_type: Any,
        message_id: Optional[str] = None,
        workflow_execution: Optional[WorkflowExecution] = None,
        conversation_id: Optional[str] = None,
        user_id: Optional[str] = None,
        timer: Optional[Any] = None,
        **kwargs,
    ):
        self.trace_type = trace_type
        self.message_id = message_id
        self.workflow_run_id = workflow_execution.id_ if workflow_execution else None
        self.conversation_id = conversation_id
        self.user_id = user_id
        self.timer = timer
        self.file_base_url = os.getenv("FILES_URL", "http://127.0.0.1:5001")
        self.app_id = None

        self.kwargs = kwargs

    def execute(self):
        return self.preprocess()

    def preprocess(self):
        preprocess_map = {
            TraceTaskName.CONVERSATION_TRACE: lambda: self.conversation_trace(**self.kwargs),
            TraceTaskName.WORKFLOW_TRACE: lambda: self.workflow_trace(
                workflow_run_id=self.workflow_run_id, conversation_id=self.conversation_id, user_id=self.user_id
            ),
            TraceTaskName.MESSAGE_TRACE: lambda: self.message_trace(message_id=self.message_id),
            TraceTaskName.MODERATION_TRACE: lambda: self.moderation_trace(
                message_id=self.message_id, timer=self.timer, **self.kwargs
            ),
            TraceTaskName.SUGGESTED_QUESTION_TRACE: lambda: self.suggested_question_trace(
                message_id=self.message_id, timer=self.timer, **self.kwargs
            ),
            TraceTaskName.DATASET_RETRIEVAL_TRACE: lambda: self.dataset_retrieval_trace(
                message_id=self.message_id, timer=self.timer, **self.kwargs
            ),
            TraceTaskName.TOOL_TRACE: lambda: self.tool_trace(
                message_id=self.message_id, timer=self.timer, **self.kwargs
            ),
            TraceTaskName.GENERATE_NAME_TRACE: lambda: self.generate_name_trace(
                conversation_id=self.conversation_id, timer=self.timer, **self.kwargs
            ),
        }

        return preprocess_map.get(self.trace_type, lambda: None)()

    # process methods for different trace types
    def conversation_trace(self, **kwargs):
        return kwargs

    def workflow_trace(
        self,
        *,
        workflow_run_id: str | None,
        conversation_id: str | None,
        user_id: str | None,
    ):
        if not workflow_run_id:
            return {}

        with Session(db.engine) as session:
            workflow_run_stmt = select(WorkflowRun).where(WorkflowRun.id == workflow_run_id)
            workflow_run = session.scalars(workflow_run_stmt).first()
            if not workflow_run:
                raise ValueError("Workflow run not found")

            workflow_id = workflow_run.workflow_id
            tenant_id = workflow_run.tenant_id
            workflow_run_id = workflow_run.id
            workflow_run_elapsed_time = workflow_run.elapsed_time
            workflow_run_status = workflow_run.status
            workflow_run_inputs = workflow_run.inputs_dict
            workflow_run_outputs = workflow_run.outputs_dict
            workflow_run_version = workflow_run.version
            error = workflow_run.error or ""

            total_tokens = workflow_run.total_tokens

            file_list = workflow_run_inputs.get("sys.file") or []
            query = workflow_run_inputs.get("query") or workflow_run_inputs.get("sys.query") or ""

            # get workflow_app_log_id
            workflow_app_log_data_stmt = select(WorkflowAppLog.id).where(
                WorkflowAppLog.tenant_id == tenant_id,
                WorkflowAppLog.app_id == workflow_run.app_id,
                WorkflowAppLog.workflow_run_id == workflow_run.id,
            )
            workflow_app_log_id = session.scalar(workflow_app_log_data_stmt)
            # get message_id
            message_id = None
            if conversation_id:
                message_data_stmt = select(Message.id).where(
                    Message.conversation_id == conversation_id,
                    Message.workflow_run_id == workflow_run_id,
                )
                message_id = session.scalar(message_data_stmt)

            metadata = {
                "workflow_id": workflow_id,
                "conversation_id": conversation_id,
                "workflow_run_id": workflow_run_id,
                "tenant_id": tenant_id,
                "elapsed_time": workflow_run_elapsed_time,
                "status": workflow_run_status,
                "version": workflow_run_version,
                "total_tokens": total_tokens,
                "file_list": file_list,
                "triggered_from": workflow_run.triggered_from,
                "user_id": user_id,
                "app_id": workflow_run.app_id,
            }

            workflow_trace_info = WorkflowTraceInfo(
                workflow_data=workflow_run.to_dict(),
                conversation_id=conversation_id,
                workflow_id=workflow_id,
                tenant_id=tenant_id,
                workflow_run_id=workflow_run_id,
                workflow_run_elapsed_time=workflow_run_elapsed_time,
                workflow_run_status=workflow_run_status,
                workflow_run_inputs=workflow_run_inputs,
                workflow_run_outputs=workflow_run_outputs,
                workflow_run_version=workflow_run_version,
                error=error,
                total_tokens=total_tokens,
                file_list=file_list,
                query=query,
                metadata=metadata,
                workflow_app_log_id=workflow_app_log_id,
                message_id=message_id,
                start_time=workflow_run.created_at,
                end_time=workflow_run.finished_at,
            )
        return workflow_trace_info

    def message_trace(self, message_id: str | None):
        if not message_id:
            return {}
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        conversation_mode_stmt = select(Conversation.mode).where(Conversation.id == message_data.conversation_id)
        conversation_mode = db.session.scalars(conversation_mode_stmt).all()
        if not conversation_mode or len(conversation_mode) == 0:
            return {}
        conversation_mode = conversation_mode[0]
        created_at = message_data.created_at
        inputs = message_data.message

        # get message file data
        message_file_data = db.session.query(MessageFile).filter_by(message_id=message_id).first()
        file_list = []
        if message_file_data and message_file_data.url is not None:
            file_url = f"{self.file_base_url}/{message_file_data.url}" if message_file_data else ""
            file_list.append(file_url)

        metadata = {
            "conversation_id": message_data.conversation_id,
            "ls_provider": message_data.model_provider,
            "ls_model_name": message_data.model_id,
            "status": message_data.status,
            "from_end_user_id": message_data.from_end_user_id,
            "from_account_id": message_data.from_account_id,
            "agent_based": message_data.agent_based,
            "workflow_run_id": message_data.workflow_run_id,
            "from_source": message_data.from_source,
            "message_id": message_id,
        }

        message_tokens = message_data.message_tokens

        message_trace_info = MessageTraceInfo(
            message_id=message_id,
            message_data=message_data.to_dict(),
            conversation_model=conversation_mode,
            message_tokens=message_tokens,
            answer_tokens=message_data.answer_tokens,
            total_tokens=message_tokens + message_data.answer_tokens,
            error=message_data.error or "",
            inputs=inputs,
            outputs=message_data.answer,
            file_list=file_list,
            start_time=created_at,
            end_time=created_at + timedelta(seconds=message_data.provider_response_latency),
            metadata=metadata,
            message_file_data=message_file_data,
            conversation_mode=conversation_mode,
        )

        return message_trace_info

    def moderation_trace(self, message_id, timer, **kwargs):
        moderation_result = kwargs.get("moderation_result")
        if not moderation_result:
            return {}
        inputs = kwargs.get("inputs")
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        metadata = {
            "message_id": message_id,
            "action": moderation_result.action,
            "preset_response": moderation_result.preset_response,
            "query": moderation_result.query,
        }

        # get workflow_app_log_id
        workflow_app_log_id = None
        if message_data.workflow_run_id:
            workflow_app_log_data = (
                db.session.query(WorkflowAppLog).filter_by(workflow_run_id=message_data.workflow_run_id).first()
            )
            workflow_app_log_id = str(workflow_app_log_data.id) if workflow_app_log_data else None

        moderation_trace_info = ModerationTraceInfo(
            message_id=workflow_app_log_id or message_id,
            inputs=inputs,
            message_data=message_data.to_dict(),
            flagged=moderation_result.flagged,
            action=moderation_result.action,
            preset_response=moderation_result.preset_response,
            query=moderation_result.query,
            start_time=timer.get("start"),
            end_time=timer.get("end"),
            metadata=metadata,
        )

        return moderation_trace_info

    def suggested_question_trace(self, message_id, timer, **kwargs):
        suggested_question = kwargs.get("suggested_question", [])
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        metadata = {
            "message_id": message_id,
            "ls_provider": message_data.model_provider,
            "ls_model_name": message_data.model_id,
            "status": message_data.status,
            "from_end_user_id": message_data.from_end_user_id,
            "from_account_id": message_data.from_account_id,
            "agent_based": message_data.agent_based,
            "workflow_run_id": message_data.workflow_run_id,
            "from_source": message_data.from_source,
        }

        # get workflow_app_log_id
        workflow_app_log_id = None
        if message_data.workflow_run_id:
            workflow_app_log_data = (
                db.session.query(WorkflowAppLog).filter_by(workflow_run_id=message_data.workflow_run_id).first()
            )
            workflow_app_log_id = str(workflow_app_log_data.id) if workflow_app_log_data else None

        suggested_question_trace_info = SuggestedQuestionTraceInfo(
            message_id=workflow_app_log_id or message_id,
            message_data=message_data.to_dict(),
            inputs=message_data.message,
            outputs=message_data.answer,
            start_time=timer.get("start"),
            end_time=timer.get("end"),
            metadata=metadata,
            total_tokens=message_data.message_tokens + message_data.answer_tokens,
            status=message_data.status,
            error=message_data.error,
            from_account_id=message_data.from_account_id,
            agent_based=message_data.agent_based,
            from_source=message_data.from_source,
            model_provider=message_data.model_provider,
            model_id=message_data.model_id,
            suggested_question=suggested_question,
            level=message_data.status,
            status_message=message_data.error,
        )

        return suggested_question_trace_info

    def dataset_retrieval_trace(self, message_id, timer, **kwargs):
        documents = kwargs.get("documents")
        message_data = get_message_data(message_id)
        if not message_data:
            return {}

        metadata = {
            "message_id": message_id,
            "ls_provider": message_data.model_provider,
            "ls_model_name": message_data.model_id,
            "status": message_data.status,
            "from_end_user_id": message_data.from_end_user_id,
            "from_account_id": message_data.from_account_id,
            "agent_based": message_data.agent_based,
            "workflow_run_id": message_data.workflow_run_id,
            "from_source": message_data.from_source,
        }

        dataset_retrieval_trace_info = DatasetRetrievalTraceInfo(
            message_id=message_id,
            inputs=message_data.query or message_data.inputs,
            documents=[doc.model_dump() for doc in documents] if documents else [],
            start_time=timer.get("start"),
            end_time=timer.get("end"),
            metadata=metadata,
            message_data=message_data.to_dict(),
        )

        return dataset_retrieval_trace_info

    def tool_trace(self, message_id, timer, **kwargs):
        tool_name = kwargs.get("tool_name", "")
        tool_inputs = kwargs.get("tool_inputs", {})
        tool_outputs = kwargs.get("tool_outputs", {})
        message_data = get_message_data(message_id)
        if not message_data:
            return {}
        tool_config = {}
        time_cost = 0
        error = None
        tool_parameters = {}
        created_time = message_data.created_at
        end_time = message_data.updated_at
        agent_thoughts = message_data.agent_thoughts
        for agent_thought in agent_thoughts:
            if tool_name in agent_thought.tools:
                created_time = agent_thought.created_at
                tool_meta_data = agent_thought.tool_meta.get(tool_name, {})
                tool_config = tool_meta_data.get("tool_config", {})
                time_cost = tool_meta_data.get("time_cost", 0)
                end_time = created_time + timedelta(seconds=time_cost)
                error = tool_meta_data.get("error", "")
                tool_parameters = tool_meta_data.get("tool_parameters", {})
        metadata = {
            "message_id": message_id,
            "tool_name": tool_name,
            "tool_inputs": tool_inputs,
            "tool_outputs": tool_outputs,
            "tool_config": tool_config,
            "time_cost": time_cost,
            "error": error,
            "tool_parameters": tool_parameters,
        }

        file_url = ""
        message_file_data = db.session.query(MessageFile).filter_by(message_id=message_id).first()
        if message_file_data:
            message_file_id = message_file_data.id if message_file_data else None
            type = message_file_data.type
            created_by_role = message_file_data.created_by_role
            created_user_id = message_file_data.created_by
            file_url = f"{self.file_base_url}/{message_file_data.url}"

            metadata.update(
                {
                    "message_file_id": message_file_id,
                    "created_by_role": created_by_role,
                    "created_user_id": created_user_id,
                    "type": type,
                }
            )

        tool_trace_info = ToolTraceInfo(
            message_id=message_id,
            message_data=message_data.to_dict(),
            tool_name=tool_name,
            start_time=timer.get("start") if timer else created_time,
            end_time=timer.get("end") if timer else end_time,
            tool_inputs=tool_inputs,
            tool_outputs=tool_outputs,
            metadata=metadata,
            message_file_data=message_file_data,
            error=error,
            inputs=message_data.message,
            outputs=message_data.answer,
            tool_config=tool_config,
            time_cost=time_cost,
            tool_parameters=tool_parameters,
            file_url=file_url,
        )

        return tool_trace_info

    def generate_name_trace(self, conversation_id, timer, **kwargs):
        generate_conversation_name = kwargs.get("generate_conversation_name")
        inputs = kwargs.get("inputs")
        tenant_id = kwargs.get("tenant_id")
        if not tenant_id:
            return {}
        start_time = timer.get("start")
        end_time = timer.get("end")

        metadata = {
            "conversation_id": conversation_id,
            "tenant_id": tenant_id,
        }

        generate_name_trace_info = GenerateNameTraceInfo(
            conversation_id=conversation_id,
            inputs=inputs,
            outputs=generate_conversation_name,
            start_time=start_time,
            end_time=end_time,
            metadata=metadata,
            tenant_id=tenant_id,
        )

        return generate_name_trace_info


trace_manager_timer: Optional[threading.Timer] = None
trace_manager_queue: queue.Queue = queue.Queue()
trace_manager_interval = int(os.getenv("TRACE_QUEUE_MANAGER_INTERVAL", 5))
trace_manager_batch_size = int(os.getenv("TRACE_QUEUE_MANAGER_BATCH_SIZE", 100))


class TraceQueueManager:
    def __init__(self, app_id=None, user_id=None):
        global trace_manager_timer

        self.app_id = app_id
        self.user_id = user_id
        self.trace_instance = OpsTraceManager.get_ops_trace_instance(app_id)
        self.flask_app = current_app._get_current_object()  # type: ignore
        if trace_manager_timer is None:
            self.start_timer()

    def add_trace_task(self, trace_task: TraceTask):
        global trace_manager_timer, trace_manager_queue
        try:
            if self.trace_instance:
                trace_task.app_id = self.app_id
                trace_manager_queue.put(trace_task)
        except Exception as e:
            logging.exception(f"Error adding trace task, trace_type {trace_task.trace_type}")
        finally:
            self.start_timer()

    def collect_tasks(self):
        global trace_manager_queue
        tasks: list[TraceTask] = []
        while len(tasks) < trace_manager_batch_size and not trace_manager_queue.empty():
            task = trace_manager_queue.get_nowait()
            tasks.append(task)
            trace_manager_queue.task_done()
        return tasks

    def run(self):
        try:
            tasks = self.collect_tasks()
            if tasks:
                self.send_to_celery(tasks)
        except Exception as e:
            logging.exception("Error processing trace tasks")

    def start_timer(self):
        global trace_manager_timer
        if trace_manager_timer is None or not trace_manager_timer.is_alive():
            trace_manager_timer = threading.Timer(trace_manager_interval, self.run)
            trace_manager_timer.name = f"trace_manager_timer_{time.strftime('%Y-%m-%d %H:%M:%S', time.localtime())}"
            trace_manager_timer.daemon = False
            trace_manager_timer.start()

    def send_to_celery(self, tasks: list[TraceTask]):
        with self.flask_app.app_context():
            for task in tasks:
                if task.app_id is None:
                    continue
                file_id = uuid4().hex
                trace_info = task.execute()
                task_data = TaskData(
                    app_id=task.app_id,
                    trace_info_type=type(trace_info).__name__,
                    trace_info=trace_info.model_dump() if trace_info else None,
                )
                file_path = f"{OPS_FILE_PATH}{task.app_id}/{file_id}.json"
                storage.save(file_path, task_data.model_dump_json().encode("utf-8"))
                file_info = {
                    "file_id": file_id,
                    "app_id": task.app_id,
                }
                process_trace_tasks.delay(file_info)
