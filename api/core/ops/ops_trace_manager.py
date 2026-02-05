import collections
import json
import logging
import os
import queue
import threading
import time
from datetime import timedelta
from typing import TYPE_CHECKING, Any, Optional, Union
from uuid import UUID, uuid4

from cachetools import LRUCache
from flask import current_app
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.helper.encrypter import batch_decrypt_token, encrypt_token, obfuscated_token
from core.ops.entities.config_entity import (
    OPS_FILE_PATH,
    TracingProviderEnum,
)
from core.ops.entities.trace_entity import (
    DatasetRetrievalTraceInfo,
    DraftNodeExecutionTrace,
    GenerateNameTraceInfo,
    MessageTraceInfo,
    ModerationTraceInfo,
    PromptGenerationTraceInfo,
    SuggestedQuestionTraceInfo,
    TaskData,
    ToolTraceInfo,
    TraceTaskName,
    WorkflowNodeTraceInfo,
    WorkflowTraceInfo,
)
from core.ops.utils import get_message_data
from extensions.ext_database import db
from extensions.ext_storage import storage
from models.account import Tenant
from models.dataset import Dataset
from models.model import App, AppModelConfig, Conversation, Message, MessageFile, TraceAppConfig
from models.tools import ApiToolProvider, BuiltinToolProvider, MCPToolProvider, WorkflowToolProvider
from models.workflow import WorkflowAppLog
from tasks.ops_trace_task import process_trace_tasks

if TYPE_CHECKING:
    from core.workflow.entities import WorkflowExecution

logger = logging.getLogger(__name__)


def _lookup_app_and_workspace_names(app_id: str | None, tenant_id: str | None) -> tuple[str, str]:
    """Return (app_name, workspace_name) for the given IDs. Falls back to empty strings."""
    app_name = ""
    workspace_name = ""
    if not app_id and not tenant_id:
        return app_name, workspace_name
    with Session(db.engine) as session:
        if app_id:
            name = session.scalar(select(App.name).where(App.id == app_id))
            if name:
                app_name = name
        if tenant_id:
            name = session.scalar(select(Tenant.name).where(Tenant.id == tenant_id))
            if name:
                workspace_name = name
    return app_name, workspace_name


_PROVIDER_TYPE_TO_MODEL: dict[str, type] = {
    "builtin": BuiltinToolProvider,
    "plugin": BuiltinToolProvider,
    "api": ApiToolProvider,
    "workflow": WorkflowToolProvider,
    "mcp": MCPToolProvider,
}


def _lookup_credential_name(credential_id: str | None, provider_type: str | None) -> str:
    if not credential_id:
        return ""
    model_cls = _PROVIDER_TYPE_TO_MODEL.get(provider_type or "")
    if not model_cls:
        return ""
    with Session(db.engine) as session:
        name = session.scalar(select(model_cls.name).where(model_cls.id == credential_id))
        return str(name) if name else ""


class OpsTraceProviderConfigMap(collections.UserDict[str, dict[str, Any]]):
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
            case TracingProviderEnum.MLFLOW:
                from core.ops.entities.config_entity import MLflowConfig
                from core.ops.mlflow_trace.mlflow_trace import MLflowDataTrace

                return {
                    "config_class": MLflowConfig,
                    "secret_keys": ["password"],
                    "other_keys": ["tracking_uri", "experiment_id", "username"],
                    "trace_instance": MLflowDataTrace,
                }
            case TracingProviderEnum.DATABRICKS:
                from core.ops.entities.config_entity import DatabricksConfig
                from core.ops.mlflow_trace.mlflow_trace import MLflowDataTrace

                return {
                    "config_class": DatabricksConfig,
                    "secret_keys": ["personal_access_token", "client_secret"],
                    "other_keys": ["host", "client_id", "experiment_id"],
                    "trace_instance": MLflowDataTrace,
                }

            case TracingProviderEnum.TENCENT:
                from core.ops.entities.config_entity import TencentConfig
                from core.ops.tencent_trace.tencent_trace import TencentDataTrace

                return {
                    "config_class": TencentConfig,
                    "secret_keys": ["token"],
                    "other_keys": ["endpoint", "service_name"],
                    "trace_instance": TencentDataTrace,
                }

            case _:
                raise KeyError(f"Unsupported tracing provider: {provider}")


provider_config_map = OpsTraceProviderConfigMap()


class OpsTraceManager:
    ops_trace_instances_cache: LRUCache = LRUCache(maxsize=128)
    decrypted_configs_cache: LRUCache = LRUCache(maxsize=128)
    _decryption_cache_lock = threading.RLock()

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

        new_config: dict[str, Any] = {}
        # Encrypt necessary keys
        for key in secret_keys:
            if key in tracing_config:
                if "*" in tracing_config[key]:
                    # If the key contains '*', retain the original value from the current config
                    if current_trace_config:
                        new_config[key] = current_trace_config.get(key, tracing_config[key])
                    else:
                        new_config[key] = tracing_config[key]
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
        config_json = json.dumps(tracing_config, sort_keys=True)
        decrypted_config_key = (
            tenant_id,
            tracing_provider,
            config_json,
        )

        # First check without lock for performance
        cached_config = cls.decrypted_configs_cache.get(decrypted_config_key)
        if cached_config is not None:
            return dict(cached_config)

        with cls._decryption_cache_lock:
            # Second check (double-checked locking) to prevent race conditions
            cached_config = cls.decrypted_configs_cache.get(decrypted_config_key)
            if cached_config is not None:
                return dict(cached_config)

            config_class, secret_keys, other_keys = (
                provider_config_map[tracing_provider]["config_class"],
                provider_config_map[tracing_provider]["secret_keys"],
                provider_config_map[tracing_provider]["other_keys"],
            )
            new_config: dict[str, Any] = {}
            keys_to_decrypt = [key for key in secret_keys if key in tracing_config]
            if keys_to_decrypt:
                decrypted_values = batch_decrypt_token(tenant_id, [tracing_config[key] for key in keys_to_decrypt])
                new_config.update(zip(keys_to_decrypt, decrypted_values))

            for key in other_keys:
                new_config[key] = tracing_config.get(key, "")

            decrypted_config = config_class(**new_config).model_dump()
            cls.decrypted_configs_cache[decrypted_config_key] = decrypted_config
            return dict(decrypted_config)

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
        new_config: dict[str, Any] = {}
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
        trace_config_data: TraceAppConfig | None = (
            db.session.query(TraceAppConfig)
            .where(TraceAppConfig.app_id == app_id, TraceAppConfig.tracing_provider == tracing_provider)
            .first()
        )

        if not trace_config_data:
            return None
        # decrypt_token
        stmt = select(App).where(App.id == app_id)
        app = db.session.scalar(stmt)
        if not app:
            raise ValueError("App not found")

        tenant_id = app.tenant_id
        if trace_config_data.tracing_config is None:
            raise ValueError("Tracing config cannot be None.")
        decrypt_tracing_config = cls.decrypt_tracing_config(
            tenant_id, tracing_provider, trace_config_data.tracing_config
        )

        return decrypt_tracing_config

    @classmethod
    def get_ops_trace_instance(
        cls,
        app_id: Union[UUID, str] | None = None,
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

        app: App | None = db.session.query(App).where(App.id == app_id).first()

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
            logger.info("new tracing_instance for app_id: %s", app_id)
        return tracing_instance

    @classmethod
    def get_app_config_through_message_id(cls, message_id: str):
        app_model_config = None
        message_stmt = select(Message).where(Message.id == message_id)
        message_data = db.session.scalar(message_stmt)
        if not message_data:
            return None
        conversation_id = message_data.conversation_id
        conversation_stmt = select(Conversation).where(Conversation.id == conversation_id)
        conversation_data = db.session.scalar(conversation_stmt)
        if not conversation_data:
            return None

        if conversation_data.app_model_config_id:
            config_stmt = select(AppModelConfig).where(AppModelConfig.id == conversation_data.app_model_config_id)
            app_model_config = db.session.scalar(config_stmt)
        elif conversation_data.app_model_config_id is None and conversation_data.override_model_configs:
            app_model_config = conversation_data.override_model_configs

        return app_model_config

    @classmethod
    def update_app_tracing_config(cls, app_id: str, enabled: bool, tracing_provider: str | None):
        """
        Update app tracing config
        :param app_id: app id
        :param enabled: enabled
        :param tracing_provider: tracing provider (None when disabling)
        :return:
        """
        # auth check
        if tracing_provider is not None:
            try:
                provider_config_map[tracing_provider]
            except KeyError:
                raise ValueError(f"Invalid tracing provider: {tracing_provider}")

        app_config: App | None = db.session.query(App).where(App.id == app_id).first()
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
        app: App | None = db.session.query(App).where(App.id == app_id).first()
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
    _workflow_run_repo = None
    _repo_lock = threading.Lock()

    @classmethod
    def _get_workflow_run_repo(cls):
        if cls._workflow_run_repo is None:
            with cls._repo_lock:
                if cls._workflow_run_repo is None:
                    # Lazy import to avoid circular import during module initialization
                    from repositories.factory import DifyAPIRepositoryFactory

                    session_maker = sessionmaker(bind=db.engine, expire_on_commit=False)
                    cls._workflow_run_repo = DifyAPIRepositoryFactory.create_api_workflow_run_repository(session_maker)
        return cls._workflow_run_repo

    @classmethod
    def _get_user_id_from_metadata(cls, metadata: dict[str, Any]) -> str:
        """Extract user ID from metadata, prioritizing end_user over account.

        Returns the actual user ID (end_user or account) who invoked the workflow,
        regardless of invoke_from context.
        """
        # Priority 1: End user (external users via API/WebApp)
        if user_id := metadata.get("from_end_user_id"):
            return f"end_user:{user_id}"

        # Priority 2: Account user (internal users via console/debugger)
        if user_id := metadata.get("from_account_id"):
            return f"account:{user_id}"

        # Priority 3: User (internal users via console/debugger)
        if user_id := metadata.get("user_id"):
            return f"user:{user_id}"

        return "anonymous"

    @classmethod
    def _calculate_workflow_token_split(cls, workflow_run_id: str, tenant_id: str) -> tuple[int, int]:
        from core.workflow.enums import WorkflowNodeExecutionMetadataKey
        from models.workflow import WorkflowNodeExecutionModel

        with Session(db.engine) as session:
            node_executions = session.scalars(
                select(WorkflowNodeExecutionModel).where(
                    WorkflowNodeExecutionModel.tenant_id == tenant_id,
                    WorkflowNodeExecutionModel.workflow_run_id == workflow_run_id,
                )
            ).all()

            total_prompt = 0
            total_completion = 0

            for node_exec in node_executions:
                metadata = node_exec.execution_metadata_dict

                prompt = metadata.get(WorkflowNodeExecutionMetadataKey.PROMPT_TOKENS)
                if prompt is not None:
                    total_prompt += prompt

                completion = metadata.get(WorkflowNodeExecutionMetadataKey.COMPLETION_TOKENS)
                if completion is not None:
                    total_completion += completion

            return (total_prompt, total_completion)

    def __init__(
        self,
        trace_type: Any,
        message_id: str | None = None,
        workflow_execution: Optional["WorkflowExecution"] = None,
        conversation_id: str | None = None,
        user_id: str | None = None,
        timer: Any | None = None,
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
        self.trace_id = None
        self.kwargs = kwargs
        if user_id is not None and "user_id" not in self.kwargs:
            self.kwargs["user_id"] = user_id
        external_trace_id = kwargs.get("external_trace_id")
        if external_trace_id:
            self.trace_id = external_trace_id

    def execute(self):
        return self.preprocess()

    def preprocess(self):
        preprocess_map = {
            TraceTaskName.CONVERSATION_TRACE: lambda: self.conversation_trace(**self.kwargs),
            TraceTaskName.WORKFLOW_TRACE: lambda: self.workflow_trace(
                workflow_run_id=self.workflow_run_id, conversation_id=self.conversation_id, user_id=self.user_id
            ),
            TraceTaskName.MESSAGE_TRACE: lambda: self.message_trace(message_id=self.message_id, **self.kwargs),
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
            TraceTaskName.PROMPT_GENERATION_TRACE: lambda: self.prompt_generation_trace(**self.kwargs),
            TraceTaskName.NODE_EXECUTION_TRACE: lambda: self.node_execution_trace(**self.kwargs),
            TraceTaskName.DRAFT_NODE_EXECUTION_TRACE: lambda: self.draft_node_execution_trace(**self.kwargs),
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

        workflow_run_repo = self._get_workflow_run_repo()
        workflow_run = workflow_run_repo.get_workflow_run_by_id_without_tenant(run_id=workflow_run_id)
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

        prompt_tokens, completion_tokens = self._calculate_workflow_token_split(
            workflow_run_id=workflow_run_id, tenant_id=tenant_id
        )

        file_list = workflow_run_inputs.get("sys.file") or []
        query = workflow_run_inputs.get("query") or workflow_run_inputs.get("sys.query") or ""

        with Session(db.engine) as session:
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

        app_name, workspace_name = _lookup_app_and_workspace_names(workflow_run.app_id, tenant_id)

        metadata: dict[str, Any] = {
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
            "app_name": app_name,
            "workspace_name": workspace_name,
        }

        parent_trace_context = self.kwargs.get("parent_trace_context")
        if parent_trace_context:
            metadata["parent_trace_context"] = parent_trace_context

        workflow_trace_info = WorkflowTraceInfo(
            trace_id=self.trace_id,
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
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            file_list=file_list,
            query=query,
            metadata=metadata,
            workflow_app_log_id=workflow_app_log_id,
            message_id=message_id,
            start_time=workflow_run.created_at,
            end_time=workflow_run.finished_at,
            invoked_by=self._get_user_id_from_metadata(metadata),
        )
        return workflow_trace_info

    def message_trace(self, message_id: str | None, **kwargs):
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

        streaming_metrics = self._extract_streaming_metrics(message_data)

        tenant_id = ""
        with Session(db.engine) as session:
            tid = session.scalar(select(App.tenant_id).where(App.id == message_data.app_id))
            if tid:
                tenant_id = str(tid)

        app_name, workspace_name = _lookup_app_and_workspace_names(message_data.app_id, tenant_id)

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
            "tenant_id": tenant_id,
            "app_id": message_data.app_id,
            "user_id": message_data.from_end_user_id or message_data.from_account_id,
            "app_name": app_name,
            "workspace_name": workspace_name,
        }
        if node_execution_id := kwargs.get("node_execution_id"):
            metadata["node_execution_id"] = node_execution_id

        message_tokens = message_data.message_tokens

        message_trace_info = MessageTraceInfo(
            trace_id=self.trace_id,
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
            gen_ai_server_time_to_first_token=streaming_metrics.get("gen_ai_server_time_to_first_token"),
            llm_streaming_time_to_generate=streaming_metrics.get("llm_streaming_time_to_generate"),
            is_streaming_request=streaming_metrics.get("is_streaming_request", False),
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
        if node_execution_id := kwargs.get("node_execution_id"):
            metadata["node_execution_id"] = node_execution_id

        # get workflow_app_log_id
        workflow_app_log_id = None
        if message_data.workflow_run_id:
            workflow_app_log_data = (
                db.session.query(WorkflowAppLog).filter_by(workflow_run_id=message_data.workflow_run_id).first()
            )
            workflow_app_log_id = str(workflow_app_log_data.id) if workflow_app_log_data else None

        moderation_trace_info = ModerationTraceInfo(
            trace_id=self.trace_id,
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
        if node_execution_id := kwargs.get("node_execution_id"):
            metadata["node_execution_id"] = node_execution_id

        # get workflow_app_log_id
        workflow_app_log_id = None
        if message_data.workflow_run_id:
            workflow_app_log_data = (
                db.session.query(WorkflowAppLog).filter_by(workflow_run_id=message_data.workflow_run_id).first()
            )
            workflow_app_log_id = str(workflow_app_log_data.id) if workflow_app_log_data else None

        suggested_question_trace_info = SuggestedQuestionTraceInfo(
            trace_id=self.trace_id,
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

        tenant_id = ""
        with Session(db.engine) as session:
            tid = session.scalar(select(App.tenant_id).where(App.id == message_data.app_id))
            if tid:
                tenant_id = str(tid)

        app_name, workspace_name = _lookup_app_and_workspace_names(message_data.app_id, tenant_id)

        doc_list = [doc.model_dump() for doc in documents] if documents else []
        dataset_ids: set[str] = set()
        for doc in doc_list:
            doc_meta = doc.get("metadata") or {}
            did = doc_meta.get("dataset_id")
            if did:
                dataset_ids.add(did)

        embedding_models: dict[str, dict[str, str]] = {}
        if dataset_ids:
            with Session(db.engine) as session:
                rows = session.execute(
                    select(Dataset.id, Dataset.embedding_model, Dataset.embedding_model_provider).where(
                        Dataset.id.in_(list(dataset_ids))
                    )
                ).all()
                for row in rows:
                    embedding_models[str(row[0])] = {
                        "embedding_model": row[1] or "",
                        "embedding_model_provider": row[2] or "",
                    }

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
            "tenant_id": tenant_id,
            "app_id": message_data.app_id,
            "user_id": message_data.from_end_user_id or message_data.from_account_id,
            "app_name": app_name,
            "workspace_name": workspace_name,
            "embedding_models": embedding_models,
        }
        if node_execution_id := kwargs.get("node_execution_id"):
            metadata["node_execution_id"] = node_execution_id

        dataset_retrieval_trace_info = DatasetRetrievalTraceInfo(
            trace_id=self.trace_id,
            message_id=message_id,
            inputs=message_data.query or message_data.inputs,
            documents=doc_list,
            start_time=timer.get("start"),
            end_time=timer.get("end"),
            metadata=metadata,
            message_data=message_data.to_dict(),
            error=kwargs.get("error"),
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
        if message_data.workflow_run_id:
            metadata["workflow_run_id"] = message_data.workflow_run_id
        if node_execution_id := kwargs.get("node_execution_id"):
            metadata["node_execution_id"] = node_execution_id

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
            trace_id=self.trace_id,
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
        if node_execution_id := kwargs.get("node_execution_id"):
            metadata["node_execution_id"] = node_execution_id

        generate_name_trace_info = GenerateNameTraceInfo(
            trace_id=self.trace_id,
            conversation_id=conversation_id,
            inputs=inputs,
            outputs=generate_conversation_name,
            start_time=start_time,
            end_time=end_time,
            metadata=metadata,
            tenant_id=tenant_id,
        )

        return generate_name_trace_info

    def prompt_generation_trace(self, **kwargs) -> PromptGenerationTraceInfo | dict:
        tenant_id = kwargs.get("tenant_id", "")
        user_id = kwargs.get("user_id", "")
        app_id = kwargs.get("app_id")
        operation_type = kwargs.get("operation_type", "")
        instruction = kwargs.get("instruction", "")
        generated_output = kwargs.get("generated_output", "")

        prompt_tokens = kwargs.get("prompt_tokens", 0)
        completion_tokens = kwargs.get("completion_tokens", 0)
        total_tokens = kwargs.get("total_tokens", 0)

        model_provider = kwargs.get("model_provider", "")
        model_name = kwargs.get("model_name", "")

        latency = kwargs.get("latency", 0.0)

        timer = kwargs.get("timer")
        start_time = timer.get("start") if timer else None
        end_time = timer.get("end") if timer else None

        total_price = kwargs.get("total_price")
        currency = kwargs.get("currency")

        error = kwargs.get("error")

        app_name = None
        workspace_name = None
        if app_id:
            app_name, workspace_name = _lookup_app_and_workspace_names(app_id, tenant_id)

        metadata = {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "app_id": app_id or "",
            "app_name": app_name,
            "workspace_name": workspace_name,
            "operation_type": operation_type,
            "model_provider": model_provider,
            "model_name": model_name,
        }
        if node_execution_id := kwargs.get("node_execution_id"):
            metadata["node_execution_id"] = node_execution_id

        return PromptGenerationTraceInfo(
            trace_id=self.trace_id,
            inputs=instruction,
            outputs=generated_output,
            start_time=start_time,
            end_time=end_time,
            metadata=metadata,
            tenant_id=tenant_id,
            user_id=user_id,
            app_id=app_id,
            operation_type=operation_type,
            instruction=instruction,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            model_provider=model_provider,
            model_name=model_name,
            latency=latency,
            total_price=total_price,
            currency=currency,
            error=error,
        )

    def node_execution_trace(self, **kwargs) -> WorkflowNodeTraceInfo | dict:
        node_data: dict = kwargs.get("node_execution_data", {})
        if not node_data:
            return {}

        app_name, workspace_name = _lookup_app_and_workspace_names(node_data.get("app_id"), node_data.get("tenant_id"))

        credential_name = _lookup_credential_name(
            node_data.get("credential_id"), node_data.get("credential_provider_type")
        )

        metadata: dict[str, Any] = {
            "tenant_id": node_data.get("tenant_id"),
            "app_id": node_data.get("app_id"),
            "app_name": app_name,
            "workspace_name": workspace_name,
            "user_id": node_data.get("user_id"),
            "dataset_ids": node_data.get("dataset_ids"),
            "dataset_names": node_data.get("dataset_names"),
            "plugin_name": node_data.get("plugin_name"),
            "credential_name": credential_name,
        }

        parent_trace_context = node_data.get("parent_trace_context")
        if parent_trace_context:
            metadata["parent_trace_context"] = parent_trace_context

        message_id: str | None = None
        conversation_id = node_data.get("conversation_id")
        workflow_execution_id = node_data.get("workflow_execution_id")
        if conversation_id and workflow_execution_id and not parent_trace_context:
            with Session(db.engine) as session:
                msg_id = session.scalar(
                    select(Message.id).where(
                        Message.conversation_id == conversation_id,
                        Message.workflow_run_id == workflow_execution_id,
                    )
                )
                if msg_id:
                    message_id = str(msg_id)
                    metadata["message_id"] = message_id

        return WorkflowNodeTraceInfo(
            trace_id=self.trace_id,
            message_id=message_id,
            start_time=node_data.get("created_at"),
            end_time=node_data.get("finished_at"),
            metadata=metadata,
            workflow_id=node_data.get("workflow_id", ""),
            workflow_run_id=node_data.get("workflow_execution_id", ""),
            tenant_id=node_data.get("tenant_id", ""),
            node_execution_id=node_data.get("node_execution_id", ""),
            node_id=node_data.get("node_id", ""),
            node_type=node_data.get("node_type", ""),
            title=node_data.get("title", ""),
            status=node_data.get("status", ""),
            error=node_data.get("error"),
            elapsed_time=node_data.get("elapsed_time", 0.0),
            index=node_data.get("index", 0),
            predecessor_node_id=node_data.get("predecessor_node_id"),
            total_tokens=node_data.get("total_tokens", 0),
            total_price=node_data.get("total_price", 0.0),
            currency=node_data.get("currency"),
            model_provider=node_data.get("model_provider"),
            model_name=node_data.get("model_name"),
            prompt_tokens=node_data.get("prompt_tokens"),
            completion_tokens=node_data.get("completion_tokens"),
            tool_name=node_data.get("tool_name"),
            iteration_id=node_data.get("iteration_id"),
            iteration_index=node_data.get("iteration_index"),
            loop_id=node_data.get("loop_id"),
            loop_index=node_data.get("loop_index"),
            parallel_id=node_data.get("parallel_id"),
            node_inputs=node_data.get("node_inputs"),
            node_outputs=node_data.get("node_outputs"),
            process_data=node_data.get("process_data"),
            invoked_by=self._get_user_id_from_metadata(metadata),
        )

    def draft_node_execution_trace(self, **kwargs) -> DraftNodeExecutionTrace | dict:
        node_trace = self.node_execution_trace(**kwargs)
        if not node_trace or not isinstance(node_trace, WorkflowNodeTraceInfo):
            return node_trace
        return DraftNodeExecutionTrace(**node_trace.model_dump())

    def _extract_streaming_metrics(self, message_data) -> dict:
        if not message_data.message_metadata:
            return {}

        try:
            metadata = json.loads(message_data.message_metadata)
            usage = metadata.get("usage", {})
            time_to_first_token = usage.get("time_to_first_token")
            time_to_generate = usage.get("time_to_generate")

            return {
                "gen_ai_server_time_to_first_token": time_to_first_token,
                "llm_streaming_time_to_generate": time_to_generate,
                "is_streaming_request": time_to_first_token is not None,
            }
        except (json.JSONDecodeError, AttributeError):
            return {}


trace_manager_timer: threading.Timer | None = None
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

        from enterprise.telemetry.exporter import is_enterprise_telemetry_enabled

        self._enterprise_telemetry_enabled = is_enterprise_telemetry_enabled()
        if trace_manager_timer is None:
            self.start_timer()

    def add_trace_task(self, trace_task: TraceTask):
        global trace_manager_timer, trace_manager_queue
        try:
            if self._enterprise_telemetry_enabled or self.trace_instance:
                trace_task.app_id = self.app_id
                trace_manager_queue.put(trace_task)
        except Exception:
            logger.exception("Error adding trace task, trace_type %s", trace_task.trace_type)
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
        except Exception:
            logger.exception("Error processing trace tasks")

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
                storage_id = task.app_id
                if storage_id is None:
                    tenant_id = task.kwargs.get("tenant_id")
                    if tenant_id:
                        storage_id = f"tenant-{tenant_id}"
                    else:
                        logger.warning("Skipping trace without app_id or tenant_id, trace_type: %s", task.trace_type)
                        continue

                file_id = uuid4().hex
                trace_info = task.execute()

                task_data = TaskData(
                    app_id=storage_id,
                    trace_info_type=type(trace_info).__name__,
                    trace_info=trace_info.model_dump() if trace_info else None,
                )
                file_path = f"{OPS_FILE_PATH}{storage_id}/{file_id}.json"
                storage.save(file_path, task_data.model_dump_json().encode("utf-8"))
                file_info = {
                    "file_id": file_id,
                    "app_id": storage_id,
                }
                process_trace_tasks.delay(file_info)  # type: ignore
