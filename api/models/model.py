import json
import re
import uuid
from collections.abc import Mapping
from datetime import datetime
from decimal import Decimal
from enum import StrEnum, auto
from typing import TYPE_CHECKING, Any, Literal, Optional, cast

import sqlalchemy as sa
from flask import request
from flask_login import UserMixin
from sqlalchemy import Float, Index, PrimaryKeyConstraint, String, exists, func, select, text
from sqlalchemy.orm import Mapped, Session, mapped_column

from configs import dify_config
from constants import DEFAULT_FILE_NUMBER_LIMITS
from core.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType
from core.file import helpers as file_helpers
from core.tools.signature import sign_tool_file
from core.workflow.enums import WorkflowExecutionStatus
from libs.helper import generate_string  # type: ignore[import-not-found]

from .account import Account, Tenant
from .base import Base
from .engine import db
from .enums import CreatorUserRole
from .provider_ids import GenericProviderID
from .types import StringUUID

if TYPE_CHECKING:
    from models.workflow import Workflow


class DifySetup(Base):
    __tablename__ = "dify_setups"
    __table_args__ = (sa.PrimaryKeyConstraint("version", name="dify_setup_pkey"),)

    version: Mapped[str] = mapped_column(String(255), nullable=False)
    setup_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())


class AppMode(StrEnum):
    COMPLETION = "completion"
    WORKFLOW = "workflow"
    CHAT = "chat"
    ADVANCED_CHAT = "advanced-chat"
    AGENT_CHAT = "agent-chat"
    CHANNEL = "channel"
    RAG_PIPELINE = "rag-pipeline"

    @classmethod
    def value_of(cls, value: str) -> "AppMode":
        """
        Get value of given mode.

        :param value: mode value
        :return: mode
        """
        for mode in cls:
            if mode.value == value:
                return mode
        raise ValueError(f"invalid mode value {value}")


class IconType(StrEnum):
    IMAGE = auto()
    EMOJI = auto()


class App(Base):
    __tablename__ = "apps"
    __table_args__ = (sa.PrimaryKeyConstraint("id", name="app_pkey"), sa.Index("app_tenant_id_idx", "tenant_id"))

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(sa.Text, server_default=sa.text("''::character varying"))
    mode: Mapped[str] = mapped_column(String(255))
    icon_type: Mapped[str | None] = mapped_column(String(255))  # image, emoji
    icon = mapped_column(String(255))
    icon_background: Mapped[str | None] = mapped_column(String(255))
    app_model_config_id = mapped_column(StringUUID, nullable=True)
    workflow_id = mapped_column(StringUUID, nullable=True)
    status: Mapped[str] = mapped_column(String(255), server_default=sa.text("'normal'::character varying"))
    enable_site: Mapped[bool] = mapped_column(sa.Boolean)
    enable_api: Mapped[bool] = mapped_column(sa.Boolean)
    api_rpm: Mapped[int] = mapped_column(sa.Integer, server_default=sa.text("0"))
    api_rph: Mapped[int] = mapped_column(sa.Integer, server_default=sa.text("0"))
    is_demo: Mapped[bool] = mapped_column(sa.Boolean, server_default=sa.text("false"))
    is_public: Mapped[bool] = mapped_column(sa.Boolean, server_default=sa.text("false"))
    is_universal: Mapped[bool] = mapped_column(sa.Boolean, server_default=sa.text("false"))
    tracing = mapped_column(sa.Text, nullable=True)
    max_active_requests: Mapped[int | None]
    created_by = mapped_column(StringUUID, nullable=True)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by = mapped_column(StringUUID, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    use_icon_as_answer_icon: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))

    @property
    def desc_or_prompt(self) -> str:
        if self.description:
            return self.description
        else:
            app_model_config = self.app_model_config
            if app_model_config:
                return app_model_config.pre_prompt
            else:
                return ""

    @property
    def site(self) -> Optional["Site"]:
        site = db.session.query(Site).where(Site.app_id == self.id).first()
        return site

    @property
    def app_model_config(self) -> Optional["AppModelConfig"]:
        if self.app_model_config_id:
            return db.session.query(AppModelConfig).where(AppModelConfig.id == self.app_model_config_id).first()

        return None

    @property
    def workflow(self) -> Optional["Workflow"]:
        if self.workflow_id:
            from .workflow import Workflow

            return db.session.query(Workflow).where(Workflow.id == self.workflow_id).first()

        return None

    @property
    def api_base_url(self) -> str:
        return (dify_config.SERVICE_API_URL or request.host_url.rstrip("/")) + "/v1"

    @property
    def tenant(self) -> Tenant | None:
        tenant = db.session.query(Tenant).where(Tenant.id == self.tenant_id).first()
        return tenant

    @property
    def is_agent(self) -> bool:
        app_model_config = self.app_model_config
        if not app_model_config:
            return False
        if not app_model_config.agent_mode:
            return False

        if app_model_config.agent_mode_dict.get("enabled", False) and app_model_config.agent_mode_dict.get(
            "strategy", ""
        ) in {"function_call", "react"}:
            self.mode = AppMode.AGENT_CHAT
            db.session.commit()
            return True
        return False

    @property
    def mode_compatible_with_agent(self) -> str:
        if self.mode == AppMode.CHAT and self.is_agent:
            return AppMode.AGENT_CHAT

        return str(self.mode)

    @property
    def deleted_tools(self) -> list[dict[str, str]]:
        from core.tools.tool_manager import ToolManager, ToolProviderType
        from services.plugin.plugin_service import PluginService

        # get agent mode tools
        app_model_config = self.app_model_config
        if not app_model_config:
            return []

        if not app_model_config.agent_mode:
            return []

        agent_mode = app_model_config.agent_mode_dict
        tools = agent_mode.get("tools", [])

        api_provider_ids: list[str] = []

        builtin_provider_ids: list[GenericProviderID] = []

        for tool in tools:
            keys = list(tool.keys())
            if len(keys) >= 4:
                provider_type = tool.get("provider_type", "")
                provider_id = tool.get("provider_id", "")
                if provider_type == ToolProviderType.API:
                    try:
                        uuid.UUID(provider_id)
                    except Exception:
                        continue
                    api_provider_ids.append(provider_id)
                if provider_type == ToolProviderType.BUILT_IN:
                    try:
                        # check if it's hardcoded
                        try:
                            ToolManager.get_hardcoded_provider(provider_id)
                            is_hardcoded = True
                        except Exception:
                            is_hardcoded = False

                        provider_id = GenericProviderID(provider_id, is_hardcoded)
                    except Exception:
                        continue

                    builtin_provider_ids.append(provider_id)

        if not api_provider_ids and not builtin_provider_ids:
            return []

        with Session(db.engine) as session:
            if api_provider_ids:
                existing_api_providers = [
                    api_provider.id
                    for api_provider in session.execute(
                        text("SELECT id FROM tool_api_providers WHERE id IN :provider_ids"),
                        {"provider_ids": tuple(api_provider_ids)},
                    ).fetchall()
                ]
            else:
                existing_api_providers = []

        if builtin_provider_ids:
            # get the non-hardcoded builtin providers
            non_hardcoded_builtin_providers = [
                provider_id for provider_id in builtin_provider_ids if not provider_id.is_hardcoded
            ]
            if non_hardcoded_builtin_providers:
                existence = list(PluginService.check_tools_existence(self.tenant_id, non_hardcoded_builtin_providers))
            else:
                existence = []
            # add the hardcoded builtin providers
            existence.extend([True] * (len(builtin_provider_ids) - len(non_hardcoded_builtin_providers)))
            builtin_provider_ids = non_hardcoded_builtin_providers + [
                provider_id for provider_id in builtin_provider_ids if provider_id.is_hardcoded
            ]
        else:
            existence = []

        existing_builtin_providers = {
            provider_id.provider_name: existence[i] for i, provider_id in enumerate(builtin_provider_ids)
        }

        deleted_tools: list[dict[str, str]] = []

        for tool in tools:
            keys = list(tool.keys())
            if len(keys) >= 4:
                provider_type = tool.get("provider_type", "")
                provider_id = tool.get("provider_id", "")

                if provider_type == ToolProviderType.API:
                    if uuid.UUID(provider_id) not in existing_api_providers:
                        deleted_tools.append(
                            {
                                "type": ToolProviderType.API,
                                "tool_name": tool["tool_name"],
                                "provider_id": provider_id,
                            }
                        )

                if provider_type == ToolProviderType.BUILT_IN:
                    generic_provider_id = GenericProviderID(provider_id)

                    if not existing_builtin_providers[generic_provider_id.provider_name]:
                        deleted_tools.append(
                            {
                                "type": ToolProviderType.BUILT_IN,
                                "tool_name": tool["tool_name"],
                                "provider_id": provider_id,  # use the original one
                            }
                        )

        return deleted_tools

    @property
    def tags(self) -> list["Tag"]:
        tags = (
            db.session.query(Tag)
            .join(TagBinding, Tag.id == TagBinding.tag_id)
            .where(
                TagBinding.target_id == self.id,
                TagBinding.tenant_id == self.tenant_id,
                Tag.tenant_id == self.tenant_id,
                Tag.type == "app",
            )
            .all()
        )

        return tags or []

    @property
    def author_name(self) -> str | None:
        if self.created_by:
            account = db.session.query(Account).where(Account.id == self.created_by).first()
            if account:
                return account.name

        return None


class AppModelConfig(Base):
    __tablename__ = "app_model_configs"
    __table_args__ = (sa.PrimaryKeyConstraint("id", name="app_model_config_pkey"), sa.Index("app_app_id_idx", "app_id"))

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    provider = mapped_column(String(255), nullable=True)
    model_id = mapped_column(String(255), nullable=True)
    configs = mapped_column(sa.JSON, nullable=True)
    created_by = mapped_column(StringUUID, nullable=True)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by = mapped_column(StringUUID, nullable=True)
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    opening_statement = mapped_column(sa.Text)
    suggested_questions = mapped_column(sa.Text)
    suggested_questions_after_answer = mapped_column(sa.Text)
    speech_to_text = mapped_column(sa.Text)
    text_to_speech = mapped_column(sa.Text)
    more_like_this = mapped_column(sa.Text)
    model = mapped_column(sa.Text)
    user_input_form = mapped_column(sa.Text)
    dataset_query_variable = mapped_column(String(255))
    pre_prompt = mapped_column(sa.Text)
    agent_mode = mapped_column(sa.Text)
    sensitive_word_avoidance = mapped_column(sa.Text)
    retriever_resource = mapped_column(sa.Text)
    prompt_type = mapped_column(String(255), nullable=False, server_default=sa.text("'simple'::character varying"))
    chat_prompt_config = mapped_column(sa.Text)
    completion_prompt_config = mapped_column(sa.Text)
    dataset_configs = mapped_column(sa.Text)
    external_data_tools = mapped_column(sa.Text)
    file_upload = mapped_column(sa.Text)

    @property
    def app(self) -> App | None:
        app = db.session.query(App).where(App.id == self.app_id).first()
        return app

    @property
    def model_dict(self) -> dict[str, Any]:
        return json.loads(self.model) if self.model else {}

    @property
    def suggested_questions_list(self) -> list[str]:
        return json.loads(self.suggested_questions) if self.suggested_questions else []

    @property
    def suggested_questions_after_answer_dict(self) -> dict[str, Any]:
        return (
            json.loads(self.suggested_questions_after_answer)
            if self.suggested_questions_after_answer
            else {"enabled": False}
        )

    @property
    def speech_to_text_dict(self) -> dict[str, Any]:
        return json.loads(self.speech_to_text) if self.speech_to_text else {"enabled": False}

    @property
    def text_to_speech_dict(self) -> dict[str, Any]:
        return json.loads(self.text_to_speech) if self.text_to_speech else {"enabled": False}

    @property
    def retriever_resource_dict(self) -> dict[str, Any]:
        return json.loads(self.retriever_resource) if self.retriever_resource else {"enabled": True}

    @property
    def annotation_reply_dict(self) -> dict[str, Any]:
        annotation_setting = (
            db.session.query(AppAnnotationSetting).where(AppAnnotationSetting.app_id == self.app_id).first()
        )
        if annotation_setting:
            collection_binding_detail = annotation_setting.collection_binding_detail
            if not collection_binding_detail:
                raise ValueError("Collection binding detail not found")

            return {
                "id": annotation_setting.id,
                "enabled": True,
                "score_threshold": annotation_setting.score_threshold,
                "embedding_model": {
                    "embedding_provider_name": collection_binding_detail.provider_name,
                    "embedding_model_name": collection_binding_detail.model_name,
                },
            }

        else:
            return {"enabled": False}

    @property
    def more_like_this_dict(self) -> dict[str, Any]:
        return json.loads(self.more_like_this) if self.more_like_this else {"enabled": False}

    @property
    def sensitive_word_avoidance_dict(self) -> dict[str, Any]:
        return (
            json.loads(self.sensitive_word_avoidance)
            if self.sensitive_word_avoidance
            else {"enabled": False, "type": "", "configs": []}
        )

    @property
    def external_data_tools_list(self) -> list[dict[str, Any]]:
        return json.loads(self.external_data_tools) if self.external_data_tools else []

    @property
    def user_input_form_list(self) -> list[dict[str, Any]]:
        return json.loads(self.user_input_form) if self.user_input_form else []

    @property
    def agent_mode_dict(self) -> dict[str, Any]:
        return (
            json.loads(self.agent_mode)
            if self.agent_mode
            else {"enabled": False, "strategy": None, "tools": [], "prompt": None}
        )

    @property
    def chat_prompt_config_dict(self) -> dict[str, Any]:
        return json.loads(self.chat_prompt_config) if self.chat_prompt_config else {}

    @property
    def completion_prompt_config_dict(self) -> dict[str, Any]:
        return json.loads(self.completion_prompt_config) if self.completion_prompt_config else {}

    @property
    def dataset_configs_dict(self) -> dict[str, Any]:
        if self.dataset_configs:
            dataset_configs: dict[str, Any] = json.loads(self.dataset_configs)
            if "retrieval_model" not in dataset_configs:
                return {"retrieval_model": "single"}
            else:
                return dataset_configs
        return {
            "retrieval_model": "multiple",
        }

    @property
    def file_upload_dict(self) -> dict[str, Any]:
        return (
            json.loads(self.file_upload)
            if self.file_upload
            else {
                "image": {
                    "enabled": False,
                    "number_limits": DEFAULT_FILE_NUMBER_LIMITS,
                    "detail": "high",
                    "transfer_methods": ["remote_url", "local_file"],
                }
            }
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "opening_statement": self.opening_statement,
            "suggested_questions": self.suggested_questions_list,
            "suggested_questions_after_answer": self.suggested_questions_after_answer_dict,
            "speech_to_text": self.speech_to_text_dict,
            "text_to_speech": self.text_to_speech_dict,
            "retriever_resource": self.retriever_resource_dict,
            "annotation_reply": self.annotation_reply_dict,
            "more_like_this": self.more_like_this_dict,
            "sensitive_word_avoidance": self.sensitive_word_avoidance_dict,
            "external_data_tools": self.external_data_tools_list,
            "model": self.model_dict,
            "user_input_form": self.user_input_form_list,
            "dataset_query_variable": self.dataset_query_variable,
            "pre_prompt": self.pre_prompt,
            "agent_mode": self.agent_mode_dict,
            "prompt_type": self.prompt_type,
            "chat_prompt_config": self.chat_prompt_config_dict,
            "completion_prompt_config": self.completion_prompt_config_dict,
            "dataset_configs": self.dataset_configs_dict,
            "file_upload": self.file_upload_dict,
        }

    def from_model_config_dict(self, model_config: Mapping[str, Any]):
        self.opening_statement = model_config.get("opening_statement")
        self.suggested_questions = (
            json.dumps(model_config["suggested_questions"]) if model_config.get("suggested_questions") else None
        )
        self.suggested_questions_after_answer = (
            json.dumps(model_config["suggested_questions_after_answer"])
            if model_config.get("suggested_questions_after_answer")
            else None
        )
        self.speech_to_text = json.dumps(model_config["speech_to_text"]) if model_config.get("speech_to_text") else None
        self.text_to_speech = json.dumps(model_config["text_to_speech"]) if model_config.get("text_to_speech") else None
        self.more_like_this = json.dumps(model_config["more_like_this"]) if model_config.get("more_like_this") else None
        self.sensitive_word_avoidance = (
            json.dumps(model_config["sensitive_word_avoidance"])
            if model_config.get("sensitive_word_avoidance")
            else None
        )
        self.external_data_tools = (
            json.dumps(model_config["external_data_tools"]) if model_config.get("external_data_tools") else None
        )
        self.model = json.dumps(model_config["model"]) if model_config.get("model") else None
        self.user_input_form = (
            json.dumps(model_config["user_input_form"]) if model_config.get("user_input_form") else None
        )
        self.dataset_query_variable = model_config.get("dataset_query_variable")
        self.pre_prompt = model_config["pre_prompt"]
        self.agent_mode = json.dumps(model_config["agent_mode"]) if model_config.get("agent_mode") else None
        self.retriever_resource = (
            json.dumps(model_config["retriever_resource"]) if model_config.get("retriever_resource") else None
        )
        self.prompt_type = model_config.get("prompt_type", "simple")
        self.chat_prompt_config = (
            json.dumps(model_config.get("chat_prompt_config")) if model_config.get("chat_prompt_config") else None
        )
        self.completion_prompt_config = (
            json.dumps(model_config.get("completion_prompt_config"))
            if model_config.get("completion_prompt_config")
            else None
        )
        self.dataset_configs = (
            json.dumps(model_config.get("dataset_configs")) if model_config.get("dataset_configs") else None
        )
        self.file_upload = json.dumps(model_config.get("file_upload")) if model_config.get("file_upload") else None
        return self


class RecommendedApp(Base):
    __tablename__ = "recommended_apps"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="recommended_app_pkey"),
        sa.Index("recommended_app_app_id_idx", "app_id"),
        sa.Index("recommended_app_is_listed_idx", "is_listed", "language"),
    )

    id = mapped_column(StringUUID, primary_key=True, server_default=sa.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    description = mapped_column(sa.JSON, nullable=False)
    copyright: Mapped[str] = mapped_column(String(255), nullable=False)
    privacy_policy: Mapped[str] = mapped_column(String(255), nullable=False)
    custom_disclaimer: Mapped[str] = mapped_column(sa.TEXT, default="")
    category: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    is_listed: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    install_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    language = mapped_column(String(255), nullable=False, server_default=sa.text("'en-US'::character varying"))
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def app(self) -> App | None:
        app = db.session.query(App).where(App.id == self.app_id).first()
        return app


class InstalledApp(Base):
    __tablename__ = "installed_apps"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="installed_app_pkey"),
        sa.Index("installed_app_tenant_id_idx", "tenant_id"),
        sa.Index("installed_app_app_id_idx", "app_id"),
        sa.UniqueConstraint("tenant_id", "app_id", name="unique_tenant_app"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id = mapped_column(StringUUID, nullable=False)
    app_id = mapped_column(StringUUID, nullable=False)
    app_owner_tenant_id = mapped_column(StringUUID, nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    is_pinned: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    last_used_at = mapped_column(sa.DateTime, nullable=True)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def app(self) -> App | None:
        app = db.session.query(App).where(App.id == self.app_id).first()
        return app

    @property
    def tenant(self) -> Tenant | None:
        tenant = db.session.query(Tenant).where(Tenant.id == self.tenant_id).first()
        return tenant


class OAuthProviderApp(Base):
    """
    Globally shared OAuth provider app information.
    Only for Dify Cloud.
    """

    __tablename__ = "oauth_provider_apps"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="oauth_provider_app_pkey"),
        sa.Index("oauth_provider_app_client_id_idx", "client_id"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuidv7()"))
    app_icon = mapped_column(String(255), nullable=False)
    app_label = mapped_column(sa.JSON, nullable=False, server_default="{}")
    client_id = mapped_column(String(255), nullable=False)
    client_secret = mapped_column(String(255), nullable=False)
    redirect_uris = mapped_column(sa.JSON, nullable=False, server_default="[]")
    scope = mapped_column(
        String(255),
        nullable=False,
        server_default=sa.text("'read:name read:email read:avatar read:interface_language read:timezone'"),
    )
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=sa.text("CURRENT_TIMESTAMP(0)"))


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="conversation_pkey"),
        sa.Index("conversation_app_from_user_idx", "app_id", "from_source", "from_end_user_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    app_model_config_id = mapped_column(StringUUID, nullable=True)
    model_provider = mapped_column(String(255), nullable=True)
    override_model_configs = mapped_column(sa.Text)
    model_id = mapped_column(String(255), nullable=True)
    mode: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    summary = mapped_column(sa.Text)
    _inputs: Mapped[dict[str, Any]] = mapped_column("inputs", sa.JSON)
    introduction = mapped_column(sa.Text)
    system_instruction = mapped_column(sa.Text)
    system_instruction_tokens: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))
    status: Mapped[str] = mapped_column(String(255), nullable=False)

    # The `invoke_from` records how the conversation is created.
    #
    # Its value corresponds to the members of `InvokeFrom`.
    # (api/core/app/entities/app_invoke_entities.py)
    invoke_from = mapped_column(String(255), nullable=True)

    # ref: ConversationSource.
    from_source: Mapped[str] = mapped_column(String(255), nullable=False)
    from_end_user_id = mapped_column(StringUUID)
    from_account_id = mapped_column(StringUUID)
    read_at = mapped_column(sa.DateTime)
    read_account_id = mapped_column(StringUUID)
    dialogue_count: Mapped[int] = mapped_column(default=0)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    messages = db.relationship("Message", backref="conversation", lazy="select", passive_deletes="all")
    message_annotations = db.relationship(
        "MessageAnnotation", backref="conversation", lazy="select", passive_deletes="all"
    )

    is_deleted: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))

    @property
    def inputs(self) -> dict[str, Any]:
        inputs = self._inputs.copy()

        # Convert file mapping to File object
        for key, value in inputs.items():
            # NOTE: It's not the best way to implement this, but it's the only way to avoid circular import for now.
            from factories import file_factory

            if (
                isinstance(value, dict)
                and cast(dict[str, Any], value).get("dify_model_identity") == FILE_MODEL_IDENTITY
            ):
                value_dict = cast(dict[str, Any], value)
                if value_dict["transfer_method"] == FileTransferMethod.TOOL_FILE:
                    value_dict["tool_file_id"] = value_dict["related_id"]
                elif value_dict["transfer_method"] in [FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL]:
                    value_dict["upload_file_id"] = value_dict["related_id"]
                tenant_id = cast(str, value_dict.get("tenant_id", ""))
                inputs[key] = file_factory.build_from_mapping(mapping=value_dict, tenant_id=tenant_id)
            elif isinstance(value, list):
                value_list = cast(list[Any], value)
                if all(
                    isinstance(item, dict)
                    and cast(dict[str, Any], item).get("dify_model_identity") == FILE_MODEL_IDENTITY
                    for item in value_list
                ):
                    file_list: list[File] = []
                    for item in value_list:
                        if not isinstance(item, dict):
                            continue
                        item_dict = cast(dict[str, Any], item)
                        if item_dict["transfer_method"] == FileTransferMethod.TOOL_FILE:
                            item_dict["tool_file_id"] = item_dict["related_id"]
                        elif item_dict["transfer_method"] in [
                            FileTransferMethod.LOCAL_FILE,
                            FileTransferMethod.REMOTE_URL,
                        ]:
                            item_dict["upload_file_id"] = item_dict["related_id"]
                        tenant_id = cast(str, item_dict.get("tenant_id", ""))
                        file_list.append(file_factory.build_from_mapping(mapping=item_dict, tenant_id=tenant_id))
                    inputs[key] = file_list

        return inputs

    @inputs.setter
    def inputs(self, value: Mapping[str, Any]):
        inputs = dict(value)
        for k, v in inputs.items():
            if isinstance(v, File):
                inputs[k] = v.model_dump()
            elif isinstance(v, list):
                v_list = cast(list[Any], v)
                if all(isinstance(item, File) for item in v_list):
                    inputs[k] = [item.model_dump() for item in v_list if isinstance(item, File)]
        self._inputs = inputs

    @property
    def model_config(self):
        model_config = {}
        app_model_config: AppModelConfig | None = None

        if self.mode == AppMode.ADVANCED_CHAT:
            if self.override_model_configs:
                override_model_configs = json.loads(self.override_model_configs)
                model_config = override_model_configs
        else:
            if self.override_model_configs:
                override_model_configs = json.loads(self.override_model_configs)

                if "model" in override_model_configs:
                    app_model_config = AppModelConfig()
                    app_model_config = app_model_config.from_model_config_dict(override_model_configs)
                    model_config = app_model_config.to_dict()
                else:
                    model_config["configs"] = override_model_configs
            else:
                app_model_config = (
                    db.session.query(AppModelConfig).where(AppModelConfig.id == self.app_model_config_id).first()
                )
                if app_model_config:
                    model_config = app_model_config.to_dict()

        model_config["model_id"] = self.model_id
        model_config["provider"] = self.model_provider

        return model_config

    @property
    def summary_or_query(self):
        if self.summary:
            return self.summary
        else:
            first_message = self.first_message
            if first_message:
                return first_message.query
            else:
                return ""

    @property
    def annotated(self):
        return db.session.query(MessageAnnotation).where(MessageAnnotation.conversation_id == self.id).count() > 0

    @property
    def annotation(self):
        return db.session.query(MessageAnnotation).where(MessageAnnotation.conversation_id == self.id).first()

    @property
    def message_count(self):
        return db.session.query(Message).where(Message.conversation_id == self.id).count()

    @property
    def user_feedback_stats(self):
        like = (
            db.session.query(MessageFeedback)
            .where(
                MessageFeedback.conversation_id == self.id,
                MessageFeedback.from_source == "user",
                MessageFeedback.rating == "like",
            )
            .count()
        )

        dislike = (
            db.session.query(MessageFeedback)
            .where(
                MessageFeedback.conversation_id == self.id,
                MessageFeedback.from_source == "user",
                MessageFeedback.rating == "dislike",
            )
            .count()
        )

        return {"like": like, "dislike": dislike}

    @property
    def admin_feedback_stats(self):
        like = (
            db.session.query(MessageFeedback)
            .where(
                MessageFeedback.conversation_id == self.id,
                MessageFeedback.from_source == "admin",
                MessageFeedback.rating == "like",
            )
            .count()
        )

        dislike = (
            db.session.query(MessageFeedback)
            .where(
                MessageFeedback.conversation_id == self.id,
                MessageFeedback.from_source == "admin",
                MessageFeedback.rating == "dislike",
            )
            .count()
        )

        return {"like": like, "dislike": dislike}

    @property
    def status_count(self):
        messages = db.session.scalars(select(Message).where(Message.conversation_id == self.id)).all()
        status_counts = {
            WorkflowExecutionStatus.RUNNING: 0,
            WorkflowExecutionStatus.SUCCEEDED: 0,
            WorkflowExecutionStatus.FAILED: 0,
            WorkflowExecutionStatus.STOPPED: 0,
            WorkflowExecutionStatus.PARTIAL_SUCCEEDED: 0,
        }

        for message in messages:
            if message.workflow_run:
                status_counts[WorkflowExecutionStatus(message.workflow_run.status)] += 1

        return (
            {
                "success": status_counts[WorkflowExecutionStatus.SUCCEEDED],
                "failed": status_counts[WorkflowExecutionStatus.FAILED],
                "partial_success": status_counts[WorkflowExecutionStatus.PARTIAL_SUCCEEDED],
            }
            if messages
            else None
        )

    @property
    def first_message(self):
        return (
            db.session.query(Message)
            .where(Message.conversation_id == self.id)
            .order_by(Message.created_at.asc())
            .first()
        )

    @property
    def app(self) -> App | None:
        with Session(db.engine, expire_on_commit=False) as session:
            return session.query(App).where(App.id == self.app_id).first()

    @property
    def from_end_user_session_id(self):
        if self.from_end_user_id:
            end_user = db.session.query(EndUser).where(EndUser.id == self.from_end_user_id).first()
            if end_user:
                return end_user.session_id

        return None

    @property
    def from_account_name(self) -> str | None:
        if self.from_account_id:
            account = db.session.query(Account).where(Account.id == self.from_account_id).first()
            if account:
                return account.name

        return None

    @property
    def in_debug_mode(self) -> bool:
        return self.override_model_configs is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "app_id": self.app_id,
            "app_model_config_id": self.app_model_config_id,
            "model_provider": self.model_provider,
            "override_model_configs": self.override_model_configs,
            "model_id": self.model_id,
            "mode": self.mode,
            "name": self.name,
            "summary": self.summary,
            "inputs": self.inputs,
            "introduction": self.introduction,
            "system_instruction": self.system_instruction,
            "system_instruction_tokens": self.system_instruction_tokens,
            "status": self.status,
            "invoke_from": self.invoke_from,
            "from_source": self.from_source,
            "from_end_user_id": self.from_end_user_id,
            "from_account_id": self.from_account_id,
            "read_at": self.read_at,
            "read_account_id": self.read_account_id,
            "dialogue_count": self.dialogue_count,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="message_pkey"),
        Index("message_app_id_idx", "app_id", "created_at"),
        Index("message_conversation_id_idx", "conversation_id"),
        Index("message_end_user_idx", "app_id", "from_source", "from_end_user_id"),
        Index("message_account_idx", "app_id", "from_source", "from_account_id"),
        Index("message_workflow_run_id_idx", "conversation_id", "workflow_run_id"),
        Index("message_created_at_idx", "created_at"),
        Index("message_app_mode_idx", "app_mode"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    model_provider: Mapped[str | None] = mapped_column(String(255), nullable=True)
    model_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    override_model_configs: Mapped[str | None] = mapped_column(sa.Text)
    conversation_id: Mapped[str] = mapped_column(StringUUID, sa.ForeignKey("conversations.id"), nullable=False)
    _inputs: Mapped[dict[str, Any]] = mapped_column("inputs", sa.JSON)
    query: Mapped[str] = mapped_column(sa.Text, nullable=False)
    message: Mapped[dict[str, Any]] = mapped_column(sa.JSON, nullable=False)
    message_tokens: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))
    message_unit_price: Mapped[Decimal] = mapped_column(sa.Numeric(10, 4), nullable=False)
    message_price_unit: Mapped[Decimal] = mapped_column(
        sa.Numeric(10, 7), nullable=False, server_default=sa.text("0.001")
    )
    answer: Mapped[str] = mapped_column(sa.Text, nullable=False)
    answer_tokens: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))
    answer_unit_price: Mapped[Decimal] = mapped_column(sa.Numeric(10, 4), nullable=False)
    answer_price_unit: Mapped[Decimal] = mapped_column(
        sa.Numeric(10, 7), nullable=False, server_default=sa.text("0.001")
    )
    parent_message_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    provider_response_latency: Mapped[float] = mapped_column(sa.Float, nullable=False, server_default=sa.text("0"))
    total_price: Mapped[Decimal | None] = mapped_column(sa.Numeric(10, 7))
    currency: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        String(255), nullable=False, server_default=sa.text("'normal'::character varying")
    )
    error: Mapped[str | None] = mapped_column(sa.Text)
    message_metadata: Mapped[str | None] = mapped_column(sa.Text)
    invoke_from: Mapped[str | None] = mapped_column(String(255), nullable=True)
    from_source: Mapped[str] = mapped_column(String(255), nullable=False)
    from_end_user_id: Mapped[str | None] = mapped_column(StringUUID)
    from_account_id: Mapped[str | None] = mapped_column(StringUUID)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, server_default=func.current_timestamp())
    updated_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    agent_based: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    workflow_run_id: Mapped[str | None] = mapped_column(StringUUID)
    app_mode: Mapped[str | None] = mapped_column(String(255), nullable=True)

    @property
    def inputs(self) -> dict[str, Any]:
        inputs = self._inputs.copy()
        for key, value in inputs.items():
            # NOTE: It's not the best way to implement this, but it's the only way to avoid circular import for now.
            from factories import file_factory

            if (
                isinstance(value, dict)
                and cast(dict[str, Any], value).get("dify_model_identity") == FILE_MODEL_IDENTITY
            ):
                value_dict = cast(dict[str, Any], value)
                if value_dict["transfer_method"] == FileTransferMethod.TOOL_FILE:
                    value_dict["tool_file_id"] = value_dict["related_id"]
                elif value_dict["transfer_method"] in [FileTransferMethod.LOCAL_FILE, FileTransferMethod.REMOTE_URL]:
                    value_dict["upload_file_id"] = value_dict["related_id"]
                tenant_id = cast(str, value_dict.get("tenant_id", ""))
                inputs[key] = file_factory.build_from_mapping(mapping=value_dict, tenant_id=tenant_id)
            elif isinstance(value, list):
                value_list = cast(list[Any], value)
                if all(
                    isinstance(item, dict)
                    and cast(dict[str, Any], item).get("dify_model_identity") == FILE_MODEL_IDENTITY
                    for item in value_list
                ):
                    file_list: list[File] = []
                    for item in value_list:
                        if not isinstance(item, dict):
                            continue
                        item_dict = cast(dict[str, Any], item)
                        if item_dict["transfer_method"] == FileTransferMethod.TOOL_FILE:
                            item_dict["tool_file_id"] = item_dict["related_id"]
                        elif item_dict["transfer_method"] in [
                            FileTransferMethod.LOCAL_FILE,
                            FileTransferMethod.REMOTE_URL,
                        ]:
                            item_dict["upload_file_id"] = item_dict["related_id"]
                        tenant_id = cast(str, item_dict.get("tenant_id", ""))
                        file_list.append(file_factory.build_from_mapping(mapping=item_dict, tenant_id=tenant_id))
                    inputs[key] = file_list
        return inputs

    @inputs.setter
    def inputs(self, value: Mapping[str, Any]):
        inputs = dict(value)
        for k, v in inputs.items():
            if isinstance(v, File):
                inputs[k] = v.model_dump()
            elif isinstance(v, list):
                v_list = cast(list[Any], v)
                if all(isinstance(item, File) for item in v_list):
                    inputs[k] = [item.model_dump() for item in v_list if isinstance(item, File)]
        self._inputs = inputs

    @property
    def re_sign_file_url_answer(self) -> str:
        if not self.answer:
            return self.answer

        pattern = r"\[!?.*?\]\((((http|https):\/\/.+)?\/files\/(tools\/)?[\w-]+.*?timestamp=.*&nonce=.*&sign=.*)\)"
        matches = re.findall(pattern, self.answer)

        if not matches:
            return self.answer

        urls = [match[0] for match in matches]

        # remove duplicate urls
        urls = list(set(urls))

        if not urls:
            return self.answer

        re_sign_file_url_answer = self.answer
        for url in urls:
            if "files/tools" in url:
                # get tool file id
                tool_file_id_pattern = r"\/files\/tools\/([\.\w-]+)?\?timestamp="
                result = re.search(tool_file_id_pattern, url)
                if not result:
                    continue

                tool_file_id = result.group(1)

                # get extension
                if "." in tool_file_id:
                    split_result = tool_file_id.split(".")
                    extension = f".{split_result[-1]}"
                    if len(extension) > 10:
                        extension = ".bin"
                    tool_file_id = split_result[0]
                else:
                    extension = ".bin"

                if not tool_file_id:
                    continue

                sign_url = sign_tool_file(tool_file_id=tool_file_id, extension=extension)
            elif "file-preview" in url:
                # get upload file id
                upload_file_id_pattern = r"\/files\/([\w-]+)\/file-preview\?timestamp="
                result = re.search(upload_file_id_pattern, url)
                if not result:
                    continue

                upload_file_id = result.group(1)
                if not upload_file_id:
                    continue
                sign_url = file_helpers.get_signed_file_url(upload_file_id)
            elif "image-preview" in url:
                # image-preview is deprecated, use file-preview instead
                upload_file_id_pattern = r"\/files\/([\w-]+)\/image-preview\?timestamp="
                result = re.search(upload_file_id_pattern, url)
                if not result:
                    continue
                upload_file_id = result.group(1)
                if not upload_file_id:
                    continue
                sign_url = file_helpers.get_signed_file_url(upload_file_id)
            else:
                continue
            # if as_attachment is in the url, add it to the sign_url.
            if "as_attachment" in url:
                sign_url += "&as_attachment=true"
            re_sign_file_url_answer = re_sign_file_url_answer.replace(url, sign_url)

        return re_sign_file_url_answer

    @property
    def user_feedback(self):
        feedback = (
            db.session.query(MessageFeedback)
            .where(MessageFeedback.message_id == self.id, MessageFeedback.from_source == "user")
            .first()
        )
        return feedback

    @property
    def admin_feedback(self):
        feedback = (
            db.session.query(MessageFeedback)
            .where(MessageFeedback.message_id == self.id, MessageFeedback.from_source == "admin")
            .first()
        )
        return feedback

    @property
    def feedbacks(self):
        feedbacks = db.session.scalars(select(MessageFeedback).where(MessageFeedback.message_id == self.id)).all()
        return feedbacks

    @property
    def annotation(self):
        annotation = db.session.query(MessageAnnotation).where(MessageAnnotation.message_id == self.id).first()
        return annotation

    @property
    def annotation_hit_history(self):
        annotation_history = (
            db.session.query(AppAnnotationHitHistory).where(AppAnnotationHitHistory.message_id == self.id).first()
        )
        if annotation_history:
            annotation = (
                db.session.query(MessageAnnotation)
                .where(MessageAnnotation.id == annotation_history.annotation_id)
                .first()
            )
            return annotation
        return None

    @property
    def app_model_config(self):
        conversation = db.session.query(Conversation).where(Conversation.id == self.conversation_id).first()
        if conversation:
            return db.session.query(AppModelConfig).where(AppModelConfig.id == conversation.app_model_config_id).first()

        return None

    @property
    def in_debug_mode(self) -> bool:
        return self.override_model_configs is not None

    @property
    def message_metadata_dict(self) -> dict[str, Any]:
        return json.loads(self.message_metadata) if self.message_metadata else {}

    @property
    def agent_thoughts(self) -> list["MessageAgentThought"]:
        return (
            db.session.query(MessageAgentThought)
            .where(MessageAgentThought.message_id == self.id)
            .order_by(MessageAgentThought.position.asc())
            .all()
        )

    @property
    def retriever_resources(self) -> Any:
        return self.message_metadata_dict.get("retriever_resources") if self.message_metadata else []

    @property
    def message_files(self) -> list[dict[str, Any]]:
        from factories import file_factory

        message_files = db.session.scalars(select(MessageFile).where(MessageFile.message_id == self.id)).all()
        current_app = db.session.query(App).where(App.id == self.app_id).first()
        if not current_app:
            raise ValueError(f"App {self.app_id} not found")

        files: list[File] = []
        for message_file in message_files:
            if message_file.transfer_method == FileTransferMethod.LOCAL_FILE:
                if message_file.upload_file_id is None:
                    raise ValueError(f"MessageFile {message_file.id} is a local file but has no upload_file_id")
                file = file_factory.build_from_mapping(
                    mapping={
                        "id": message_file.id,
                        "type": message_file.type,
                        "transfer_method": message_file.transfer_method,
                        "upload_file_id": message_file.upload_file_id,
                    },
                    tenant_id=current_app.tenant_id,
                )
            elif message_file.transfer_method == FileTransferMethod.REMOTE_URL:
                if message_file.url is None:
                    raise ValueError(f"MessageFile {message_file.id} is a remote url but has no url")
                file = file_factory.build_from_mapping(
                    mapping={
                        "id": message_file.id,
                        "type": message_file.type,
                        "transfer_method": message_file.transfer_method,
                        "upload_file_id": message_file.upload_file_id,
                        "url": message_file.url,
                    },
                    tenant_id=current_app.tenant_id,
                )
            elif message_file.transfer_method == FileTransferMethod.TOOL_FILE:
                if message_file.upload_file_id is None:
                    assert message_file.url is not None
                    message_file.upload_file_id = message_file.url.split("/")[-1].split(".")[0]
                mapping = {
                    "id": message_file.id,
                    "type": message_file.type,
                    "transfer_method": message_file.transfer_method,
                    "tool_file_id": message_file.upload_file_id,
                }
                file = file_factory.build_from_mapping(
                    mapping=mapping,
                    tenant_id=current_app.tenant_id,
                )
            else:
                raise ValueError(
                    f"MessageFile {message_file.id} has an invalid transfer_method {message_file.transfer_method}"
                )
            files.append(file)

        result: list[dict[str, Any]] = [
            {"belongs_to": message_file.belongs_to, "upload_file_id": message_file.upload_file_id, **file.to_dict()}
            for (file, message_file) in zip(files, message_files)
        ]

        db.session.commit()
        return result

    @property
    def workflow_run(self):
        if self.workflow_run_id:
            from .workflow import WorkflowRun

            return db.session.query(WorkflowRun).where(WorkflowRun.id == self.workflow_run_id).first()

        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "app_id": self.app_id,
            "conversation_id": self.conversation_id,
            "model_id": self.model_id,
            "inputs": self.inputs,
            "query": self.query,
            "total_price": self.total_price,
            "message": self.message,
            "answer": self.answer,
            "status": self.status,
            "error": self.error,
            "message_metadata": self.message_metadata_dict,
            "from_source": self.from_source,
            "from_end_user_id": self.from_end_user_id,
            "from_account_id": self.from_account_id,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "agent_based": self.agent_based,
            "workflow_run_id": self.workflow_run_id,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Message":
        return cls(
            id=data["id"],
            app_id=data["app_id"],
            conversation_id=data["conversation_id"],
            model_id=data["model_id"],
            inputs=data["inputs"],
            total_price=data["total_price"],
            query=data["query"],
            message=data["message"],
            answer=data["answer"],
            status=data["status"],
            error=data["error"],
            message_metadata=json.dumps(data["message_metadata"]),
            from_source=data["from_source"],
            from_end_user_id=data["from_end_user_id"],
            from_account_id=data["from_account_id"],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            agent_based=data["agent_based"],
            workflow_run_id=data["workflow_run_id"],
        )


class MessageFeedback(Base):
    __tablename__ = "message_feedbacks"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="message_feedback_pkey"),
        sa.Index("message_feedback_app_idx", "app_id"),
        sa.Index("message_feedback_message_idx", "message_id", "from_source"),
        sa.Index("message_feedback_conversation_idx", "conversation_id", "from_source", "rating"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    conversation_id = mapped_column(StringUUID, nullable=False)
    message_id = mapped_column(StringUUID, nullable=False)
    rating: Mapped[str] = mapped_column(String(255), nullable=False)
    content = mapped_column(sa.Text)
    from_source: Mapped[str] = mapped_column(String(255), nullable=False)
    from_end_user_id = mapped_column(StringUUID)
    from_account_id = mapped_column(StringUUID)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def from_account(self):
        account = db.session.query(Account).where(Account.id == self.from_account_id).first()
        return account

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": str(self.id),
            "app_id": str(self.app_id),
            "conversation_id": str(self.conversation_id),
            "message_id": str(self.message_id),
            "rating": self.rating,
            "content": self.content,
            "from_source": self.from_source,
            "from_end_user_id": str(self.from_end_user_id) if self.from_end_user_id else None,
            "from_account_id": str(self.from_account_id) if self.from_account_id else None,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
        }


class MessageFile(Base):
    __tablename__ = "message_files"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="message_file_pkey"),
        sa.Index("message_file_message_idx", "message_id"),
        sa.Index("message_file_created_by_idx", "created_by"),
    )

    def __init__(
        self,
        *,
        message_id: str,
        type: FileType,
        transfer_method: FileTransferMethod,
        url: str | None = None,
        belongs_to: Literal["user", "assistant"] | None = None,
        upload_file_id: str | None = None,
        created_by_role: CreatorUserRole,
        created_by: str,
    ):
        self.message_id = message_id
        self.type = type
        self.transfer_method = transfer_method
        self.url = url
        self.belongs_to = belongs_to
        self.upload_file_id = upload_file_id
        self.created_by_role = created_by_role.value
        self.created_by = created_by

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    message_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    type: Mapped[str] = mapped_column(String(255), nullable=False)
    transfer_method: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str | None] = mapped_column(sa.Text, nullable=True)
    belongs_to: Mapped[str | None] = mapped_column(String(255), nullable=True)
    upload_file_id: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    created_by_role: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())


class MessageAnnotation(Base):
    __tablename__ = "message_annotations"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="message_annotation_pkey"),
        sa.Index("message_annotation_app_idx", "app_id"),
        sa.Index("message_annotation_conversation_idx", "conversation_id"),
        sa.Index("message_annotation_message_idx", "message_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id: Mapped[str] = mapped_column(StringUUID)
    conversation_id: Mapped[str | None] = mapped_column(StringUUID, sa.ForeignKey("conversations.id"))
    message_id: Mapped[str | None] = mapped_column(StringUUID)
    question = mapped_column(sa.Text, nullable=True)
    content = mapped_column(sa.Text, nullable=False)
    hit_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, server_default=sa.text("0"))
    account_id = mapped_column(StringUUID, nullable=False)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def account(self):
        account = db.session.query(Account).where(Account.id == self.account_id).first()
        return account

    @property
    def annotation_create_account(self):
        account = db.session.query(Account).where(Account.id == self.account_id).first()
        return account


class AppAnnotationHitHistory(Base):
    __tablename__ = "app_annotation_hit_histories"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="app_annotation_hit_histories_pkey"),
        sa.Index("app_annotation_hit_histories_app_idx", "app_id"),
        sa.Index("app_annotation_hit_histories_account_idx", "account_id"),
        sa.Index("app_annotation_hit_histories_annotation_idx", "annotation_id"),
        sa.Index("app_annotation_hit_histories_message_idx", "message_id"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    annotation_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    source = mapped_column(sa.Text, nullable=False)
    question = mapped_column(sa.Text, nullable=False)
    account_id = mapped_column(StringUUID, nullable=False)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    score = mapped_column(Float, nullable=False, server_default=sa.text("0"))
    message_id = mapped_column(StringUUID, nullable=False)
    annotation_question = mapped_column(sa.Text, nullable=False)
    annotation_content = mapped_column(sa.Text, nullable=False)

    @property
    def account(self):
        account = (
            db.session.query(Account)
            .join(MessageAnnotation, MessageAnnotation.account_id == Account.id)
            .where(MessageAnnotation.id == self.annotation_id)
            .first()
        )
        return account

    @property
    def annotation_create_account(self):
        account = db.session.query(Account).where(Account.id == self.account_id).first()
        return account


class AppAnnotationSetting(Base):
    __tablename__ = "app_annotation_settings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="app_annotation_settings_pkey"),
        sa.Index("app_annotation_settings_app_idx", "app_id"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    score_threshold = mapped_column(Float, nullable=False, server_default=sa.text("0"))
    collection_binding_id = mapped_column(StringUUID, nullable=False)
    created_user_id = mapped_column(StringUUID, nullable=False)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_user_id = mapped_column(StringUUID, nullable=False)
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def collection_binding_detail(self):
        from .dataset import DatasetCollectionBinding

        collection_binding_detail = (
            db.session.query(DatasetCollectionBinding)
            .where(DatasetCollectionBinding.id == self.collection_binding_id)
            .first()
        )
        return collection_binding_detail


class OperationLog(Base):
    __tablename__ = "operation_logs"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="operation_log_pkey"),
        sa.Index("operation_log_account_action_idx", "tenant_id", "account_id", "action"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id = mapped_column(StringUUID, nullable=False)
    account_id = mapped_column(StringUUID, nullable=False)
    action: Mapped[str] = mapped_column(String(255), nullable=False)
    content = mapped_column(sa.JSON)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    created_ip: Mapped[str] = mapped_column(String(255), nullable=False)
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())


class DefaultEndUserSessionID(StrEnum):
    """
    End User Session ID enum.
    """

    DEFAULT_SESSION_ID = "DEFAULT-USER"


class EndUser(Base, UserMixin):
    __tablename__ = "end_users"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="end_user_pkey"),
        sa.Index("end_user_session_id_idx", "session_id", "type"),
        sa.Index("end_user_tenant_session_id_idx", "tenant_id", "session_id", "type"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    app_id = mapped_column(StringUUID, nullable=True)
    type: Mapped[str] = mapped_column(String(255), nullable=False)
    external_user_id = mapped_column(String(255), nullable=True)
    name = mapped_column(String(255))
    _is_anonymous: Mapped[bool] = mapped_column(
        "is_anonymous", sa.Boolean, nullable=False, server_default=sa.text("true")
    )

    @property
    def is_anonymous(self) -> Literal[False]:
        return False

    @is_anonymous.setter
    def is_anonymous(self, value: bool) -> None:
        self._is_anonymous = value

    session_id: Mapped[str] = mapped_column()
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())


class AppMCPServer(Base):
    __tablename__ = "app_mcp_servers"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="app_mcp_server_pkey"),
        sa.UniqueConstraint("tenant_id", "app_id", name="unique_app_mcp_server_tenant_app_id"),
        sa.UniqueConstraint("server_code", name="unique_app_mcp_server_server_code"),
    )
    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id = mapped_column(StringUUID, nullable=False)
    app_id = mapped_column(StringUUID, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    server_code: Mapped[str] = mapped_column(String(255), nullable=False)
    status = mapped_column(String(255), nullable=False, server_default=sa.text("'normal'::character varying"))
    parameters = mapped_column(sa.Text, nullable=False)

    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    @staticmethod
    def generate_server_code(n: int) -> str:
        while True:
            result = generate_string(n)
            while db.session.query(AppMCPServer).where(AppMCPServer.server_code == result).count() > 0:
                result = generate_string(n)

            return result

    @property
    def parameters_dict(self) -> dict[str, Any]:
        return cast(dict[str, Any], json.loads(self.parameters))


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="site_pkey"),
        sa.Index("site_app_id_idx", "app_id"),
        sa.Index("site_code_idx", "code", "status"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    icon_type = mapped_column(String(255), nullable=True)
    icon = mapped_column(String(255))
    icon_background = mapped_column(String(255))
    description = mapped_column(sa.Text)
    default_language: Mapped[str] = mapped_column(String(255), nullable=False)
    chat_color_theme = mapped_column(String(255))
    chat_color_theme_inverted: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    copyright = mapped_column(String(255))
    privacy_policy = mapped_column(String(255))
    show_workflow_steps: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"))
    use_icon_as_answer_icon: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    _custom_disclaimer: Mapped[str] = mapped_column("custom_disclaimer", sa.TEXT, default="")
    customize_domain = mapped_column(String(255))
    customize_token_strategy: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt_public: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))
    status = mapped_column(String(255), nullable=False, server_default=sa.text("'normal'::character varying"))
    created_by = mapped_column(StringUUID, nullable=True)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by = mapped_column(StringUUID, nullable=True)
    updated_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    code = mapped_column(String(255))

    @property
    def custom_disclaimer(self):
        return self._custom_disclaimer

    @custom_disclaimer.setter
    def custom_disclaimer(self, value: str):
        if len(value) > 512:
            raise ValueError("Custom disclaimer cannot exceed 512 characters.")
        self._custom_disclaimer = value

    @staticmethod
    def generate_code(n: int) -> str:
        while True:
            result = generate_string(n)
            while db.session.query(Site).where(Site.code == result).count() > 0:
                result = generate_string(n)

            return result

    @property
    def app_base_url(self):
        return dify_config.APP_WEB_URL or request.url_root.rstrip("/")


class ApiToken(Base):
    __tablename__ = "api_tokens"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="api_token_pkey"),
        sa.Index("api_token_app_id_type_idx", "app_id", "type"),
        sa.Index("api_token_token_idx", "token", "type"),
        sa.Index("api_token_tenant_idx", "tenant_id", "type"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=True)
    tenant_id = mapped_column(StringUUID, nullable=True)
    type = mapped_column(String(16), nullable=False)
    token: Mapped[str] = mapped_column(String(255), nullable=False)
    last_used_at = mapped_column(sa.DateTime, nullable=True)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    @staticmethod
    def generate_api_key(prefix: str, n: int) -> str:
        while True:
            result = prefix + generate_string(n)
            if db.session.scalar(select(exists().where(ApiToken.token == result))):
                continue
            return result


class UploadFile(Base):
    __tablename__ = "upload_files"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="upload_file_pkey"),
        sa.Index("upload_file_tenant_idx", "tenant_id"),
    )

    # NOTE: The `id` field is generated within the application to minimize extra roundtrips
    # (especially when generating `source_url`).
    # The `server_default` serves as a fallback mechanism.
    id: Mapped[str] = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = mapped_column(StringUUID, nullable=False)
    storage_type: Mapped[str] = mapped_column(String(255), nullable=False)
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    extension: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), nullable=True)

    # The `created_by_role` field indicates whether the file was created by an `Account` or an `EndUser`.
    # Its value is derived from the `CreatorUserRole` enumeration.
    created_by_role: Mapped[str] = mapped_column(
        String(255), nullable=False, server_default=sa.text("'account'::character varying")
    )

    # The `created_by` field stores the ID of the entity that created this upload file.
    #
    # If `created_by_role` is `ACCOUNT`, it corresponds to `Account.id`.
    # Otherwise, it corresponds to `EndUser.id`.
    created_by: Mapped[str] = mapped_column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())

    # The fields `used` and `used_by` are not consistently maintained.
    #
    # When using this model in new code, ensure the following:
    #
    # 1. Set `used` to `true` when the file is utilized.
    # 2. Assign `used_by` to the corresponding `Account.id` or `EndUser.id` based on the `created_by_role`.
    # 3. Avoid relying on these fields for logic, as their values may not always be accurate.
    #
    # `used` may indicate whether the file has been utilized by another service.
    used: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("false"))

    # `used_by` may indicate the ID of the user who utilized this file.
    used_by: Mapped[str | None] = mapped_column(StringUUID, nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(sa.DateTime, nullable=True)
    hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_url: Mapped[str] = mapped_column(sa.TEXT, default="")

    def __init__(
        self,
        *,
        tenant_id: str,
        storage_type: str,
        key: str,
        name: str,
        size: int,
        extension: str,
        mime_type: str,
        created_by_role: CreatorUserRole,
        created_by: str,
        created_at: datetime,
        used: bool,
        used_by: str | None = None,
        used_at: datetime | None = None,
        hash: str | None = None,
        source_url: str = "",
    ):
        self.id = str(uuid.uuid4())
        self.tenant_id = tenant_id
        self.storage_type = storage_type
        self.key = key
        self.name = name
        self.size = size
        self.extension = extension
        self.mime_type = mime_type
        self.created_by_role = created_by_role.value
        self.created_by = created_by
        self.created_at = created_at
        self.used = used
        self.used_by = used_by
        self.used_at = used_at
        self.hash = hash
        self.source_url = source_url


class ApiRequest(Base):
    __tablename__ = "api_requests"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="api_request_pkey"),
        sa.Index("api_request_token_idx", "tenant_id", "api_token_id"),
    )

    id = mapped_column(StringUUID, nullable=False, server_default=sa.text("uuid_generate_v4()"))
    tenant_id = mapped_column(StringUUID, nullable=False)
    api_token_id = mapped_column(StringUUID, nullable=False)
    path: Mapped[str] = mapped_column(String(255), nullable=False)
    request = mapped_column(sa.Text, nullable=True)
    response = mapped_column(sa.Text, nullable=True)
    ip: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())


class MessageChain(Base):
    __tablename__ = "message_chains"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="message_chain_pkey"),
        sa.Index("message_chain_message_id_idx", "message_id"),
    )

    id = mapped_column(StringUUID, nullable=False, server_default=sa.text("uuid_generate_v4()"))
    message_id = mapped_column(StringUUID, nullable=False)
    type: Mapped[str] = mapped_column(String(255), nullable=False)
    input = mapped_column(sa.Text, nullable=True)
    output = mapped_column(sa.Text, nullable=True)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=sa.func.current_timestamp())


class MessageAgentThought(Base):
    __tablename__ = "message_agent_thoughts"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="message_agent_thought_pkey"),
        sa.Index("message_agent_thought_message_id_idx", "message_id"),
        sa.Index("message_agent_thought_message_chain_id_idx", "message_chain_id"),
    )

    id = mapped_column(StringUUID, nullable=False, server_default=sa.text("uuid_generate_v4()"))
    message_id = mapped_column(StringUUID, nullable=False)
    message_chain_id = mapped_column(StringUUID, nullable=True)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    thought = mapped_column(sa.Text, nullable=True)
    tool = mapped_column(sa.Text, nullable=True)
    tool_labels_str = mapped_column(sa.Text, nullable=False, server_default=sa.text("'{}'::text"))
    tool_meta_str = mapped_column(sa.Text, nullable=False, server_default=sa.text("'{}'::text"))
    tool_input = mapped_column(sa.Text, nullable=True)
    observation = mapped_column(sa.Text, nullable=True)
    # plugin_id = mapped_column(StringUUID, nullable=True)  ## for future design
    tool_process_data = mapped_column(sa.Text, nullable=True)
    message = mapped_column(sa.Text, nullable=True)
    message_token: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    message_unit_price = mapped_column(sa.Numeric, nullable=True)
    message_price_unit = mapped_column(sa.Numeric(10, 7), nullable=False, server_default=sa.text("0.001"))
    message_files = mapped_column(sa.Text, nullable=True)
    answer = mapped_column(sa.Text, nullable=True)
    answer_token: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    answer_unit_price = mapped_column(sa.Numeric, nullable=True)
    answer_price_unit = mapped_column(sa.Numeric(10, 7), nullable=False, server_default=sa.text("0.001"))
    tokens: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    total_price = mapped_column(sa.Numeric, nullable=True)
    currency = mapped_column(String, nullable=True)
    latency: Mapped[float | None] = mapped_column(sa.Float, nullable=True)
    created_by_role = mapped_column(String, nullable=False)
    created_by = mapped_column(StringUUID, nullable=False)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=sa.func.current_timestamp())

    @property
    def files(self) -> list[Any]:
        if self.message_files:
            return cast(list[Any], json.loads(self.message_files))
        else:
            return []

    @property
    def tools(self) -> list[str]:
        return self.tool.split(";") if self.tool else []

    @property
    def tool_labels(self) -> dict[str, Any]:
        try:
            if self.tool_labels_str:
                return cast(dict[str, Any], json.loads(self.tool_labels_str))
            else:
                return {}
        except Exception:
            return {}

    @property
    def tool_meta(self) -> dict[str, Any]:
        try:
            if self.tool_meta_str:
                return cast(dict[str, Any], json.loads(self.tool_meta_str))
            else:
                return {}
        except Exception:
            return {}

    @property
    def tool_inputs_dict(self) -> dict[str, Any]:
        tools = self.tools
        try:
            if self.tool_input:
                data = json.loads(self.tool_input)
                result: dict[str, Any] = {}
                for tool in tools:
                    if tool in data:
                        result[tool] = data[tool]
                    else:
                        if len(tools) == 1:
                            result[tool] = data
                        else:
                            result[tool] = {}
                return result
            else:
                return {tool: {} for tool in tools}
        except Exception:
            return {}

    @property
    def tool_outputs_dict(self) -> dict[str, Any]:
        tools = self.tools
        try:
            if self.observation:
                data = json.loads(self.observation)
                result: dict[str, Any] = {}
                for tool in tools:
                    if tool in data:
                        result[tool] = data[tool]
                    else:
                        if len(tools) == 1:
                            result[tool] = data
                        else:
                            result[tool] = {}
                return result
            else:
                return {tool: {} for tool in tools}
        except Exception:
            if self.observation:
                return dict.fromkeys(tools, self.observation)
            else:
                return {}


class DatasetRetrieverResource(Base):
    __tablename__ = "dataset_retriever_resources"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="dataset_retriever_resource_pkey"),
        sa.Index("dataset_retriever_resource_message_id_idx", "message_id"),
    )

    id = mapped_column(StringUUID, nullable=False, server_default=sa.text("uuid_generate_v4()"))
    message_id = mapped_column(StringUUID, nullable=False)
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    dataset_id = mapped_column(StringUUID, nullable=False)
    dataset_name = mapped_column(sa.Text, nullable=False)
    document_id = mapped_column(StringUUID, nullable=True)
    document_name = mapped_column(sa.Text, nullable=False)
    data_source_type = mapped_column(sa.Text, nullable=True)
    segment_id = mapped_column(StringUUID, nullable=True)
    score: Mapped[float | None] = mapped_column(sa.Float, nullable=True)
    content = mapped_column(sa.Text, nullable=False)
    hit_count: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    word_count: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    segment_position: Mapped[int | None] = mapped_column(sa.Integer, nullable=True)
    index_node_hash = mapped_column(sa.Text, nullable=True)
    retriever_from = mapped_column(sa.Text, nullable=False)
    created_by = mapped_column(StringUUID, nullable=False)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=sa.func.current_timestamp())


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tag_pkey"),
        sa.Index("tag_type_idx", "type"),
        sa.Index("tag_name_idx", "name"),
    )

    TAG_TYPE_LIST = ["knowledge", "app"]

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id = mapped_column(StringUUID, nullable=True)
    type = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by = mapped_column(StringUUID, nullable=False)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())


class TagBinding(Base):
    __tablename__ = "tag_bindings"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tag_binding_pkey"),
        sa.Index("tag_bind_target_id_idx", "target_id"),
        sa.Index("tag_bind_tag_id_idx", "tag_id"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    tenant_id = mapped_column(StringUUID, nullable=True)
    tag_id = mapped_column(StringUUID, nullable=True)
    target_id = mapped_column(StringUUID, nullable=True)
    created_by = mapped_column(StringUUID, nullable=False)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())


class TraceAppConfig(Base):
    __tablename__ = "trace_app_config"
    __table_args__ = (
        sa.PrimaryKeyConstraint("id", name="tracing_app_config_pkey"),
        sa.Index("trace_app_config_app_id_idx", "app_id"),
    )

    id = mapped_column(StringUUID, server_default=sa.text("uuid_generate_v4()"))
    app_id = mapped_column(StringUUID, nullable=False)
    tracing_provider = mapped_column(String(255), nullable=True)
    tracing_config = mapped_column(sa.JSON, nullable=True)
    created_at = mapped_column(sa.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = mapped_column(
        sa.DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )
    is_active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, server_default=sa.text("true"))

    @property
    def tracing_config_dict(self) -> dict[str, Any]:
        return self.tracing_config or {}

    @property
    def tracing_config_str(self) -> str:
        return json.dumps(self.tracing_config_dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "app_id": self.app_id,
            "tracing_provider": self.tracing_provider,
            "tracing_config": self.tracing_config_dict,
            "is_active": self.is_active,
            "created_at": str(self.created_at) if self.created_at else None,
            "updated_at": str(self.updated_at) if self.updated_at else None,
        }
