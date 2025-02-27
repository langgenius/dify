import json
import re
import uuid
from collections.abc import Mapping
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Optional

from core.plugin.entities.plugin import GenericProviderID
from core.tools.entities.tool_entities import ToolProviderType
from services.plugin.plugin_service import PluginService

if TYPE_CHECKING:
    from models.workflow import Workflow

from enum import StrEnum
from typing import TYPE_CHECKING, Any, Literal, cast

import sqlalchemy as sa
from flask import request
from flask_login import UserMixin  # type: ignore
from sqlalchemy import Float, Index, PrimaryKeyConstraint, func, text
from sqlalchemy.orm import Mapped, Session, mapped_column

from configs import dify_config
from core.file import FILE_MODEL_IDENTITY, File, FileTransferMethod, FileType
from core.file import helpers as file_helpers
from core.file.tool_file_parser import ToolFileParser
from libs.helper import generate_string
from models.base import Base
from models.enums import CreatedByRole
from models.workflow import WorkflowRunStatus

from .account import Account, Tenant
from .engine import db
from .types import StringUUID

if TYPE_CHECKING:
    from .workflow import Workflow


class DifySetup(Base):
    __tablename__ = "dify_setups"
    __table_args__ = (db.PrimaryKeyConstraint("version", name="dify_setup_pkey"),)

    version = db.Column(db.String(255), nullable=False)
    setup_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class AppMode(StrEnum):
    COMPLETION = "completion"
    WORKFLOW = "workflow"
    CHAT = "chat"
    ADVANCED_CHAT = "advanced-chat"
    AGENT_CHAT = "agent-chat"
    CHANNEL = "channel"

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


class IconType(Enum):
    IMAGE = "image"
    EMOJI = "emoji"


class App(Base):
    __tablename__ = "apps"
    __table_args__ = (db.PrimaryKeyConstraint("id", name="app_pkey"), db.Index("app_tenant_id_idx", "tenant_id"))

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = db.Column(StringUUID, nullable=False)
    name = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=False, server_default=db.text("''::character varying"))
    mode = db.Column(db.String(255), nullable=False)
    icon_type = db.Column(db.String(255), nullable=True)  # image, emoji
    icon = db.Column(db.String(255))
    icon_background = db.Column(db.String(255))
    app_model_config_id = db.Column(StringUUID, nullable=True)
    workflow_id = db.Column(StringUUID, nullable=True)
    status = db.Column(db.String(255), nullable=False, server_default=db.text("'normal'::character varying"))
    enable_site = db.Column(db.Boolean, nullable=False)
    enable_api = db.Column(db.Boolean, nullable=False)
    api_rpm = db.Column(db.Integer, nullable=False, server_default=db.text("0"))
    api_rph = db.Column(db.Integer, nullable=False, server_default=db.text("0"))
    is_demo = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    is_public = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    is_universal = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    tracing = db.Column(db.Text, nullable=True)
    max_active_requests: Mapped[Optional[int]] = mapped_column(nullable=True)
    created_by = db.Column(StringUUID, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by = db.Column(StringUUID, nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    use_icon_as_answer_icon = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))

    @property
    def desc_or_prompt(self):
        if self.description:
            return self.description
        else:
            app_model_config = self.app_model_config
            if app_model_config:
                return app_model_config.pre_prompt
            else:
                return ""

    @property
    def site(self):
        site = db.session.query(Site).filter(Site.app_id == self.id).first()
        return site

    @property
    def app_model_config(self):
        if self.app_model_config_id:
            return db.session.query(AppModelConfig).filter(AppModelConfig.id == self.app_model_config_id).first()

        return None

    @property
    def workflow(self) -> Optional["Workflow"]:
        if self.workflow_id:
            from .workflow import Workflow

            return db.session.query(Workflow).filter(Workflow.id == self.workflow_id).first()

        return None

    @property
    def api_base_url(self):
        return (dify_config.SERVICE_API_URL or request.host_url.rstrip("/")) + "/v1"

    @property
    def tenant(self):
        tenant = db.session.query(Tenant).filter(Tenant.id == self.tenant_id).first()
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
            self.mode = AppMode.AGENT_CHAT.value
            db.session.commit()
            return True
        return False

    @property
    def mode_compatible_with_agent(self) -> str:
        if self.mode == AppMode.CHAT.value and self.is_agent:
            return AppMode.AGENT_CHAT.value

        return str(self.mode)

    @property
    def deleted_tools(self) -> list:
        from core.tools.tool_manager import ToolManager

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
                if provider_type == ToolProviderType.API.value:
                    try:
                        uuid.UUID(provider_id)
                    except Exception:
                        continue
                    api_provider_ids.append(provider_id)
                if provider_type == ToolProviderType.BUILT_IN.value:
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

        deleted_tools = []

        for tool in tools:
            keys = list(tool.keys())
            if len(keys) >= 4:
                provider_type = tool.get("provider_type", "")
                provider_id = tool.get("provider_id", "")

                if provider_type == ToolProviderType.API.value:
                    if provider_id not in existing_api_providers:
                        deleted_tools.append(
                            {
                                "type": ToolProviderType.API.value,
                                "tool_name": tool["tool_name"],
                                "provider_id": provider_id,
                            }
                        )

                if provider_type == ToolProviderType.BUILT_IN.value:
                    generic_provider_id = GenericProviderID(provider_id)

                    if not existing_builtin_providers[generic_provider_id.provider_name]:
                        deleted_tools.append(
                            {
                                "type": ToolProviderType.BUILT_IN.value,
                                "tool_name": tool["tool_name"],
                                "provider_id": provider_id,  # use the original one
                            }
                        )

        return deleted_tools

    @property
    def tags(self):
        tags = (
            db.session.query(Tag)
            .join(TagBinding, Tag.id == TagBinding.tag_id)
            .filter(
                TagBinding.target_id == self.id,
                TagBinding.tenant_id == self.tenant_id,
                Tag.tenant_id == self.tenant_id,
                Tag.type == "app",
            )
            .all()
        )

        return tags or []


class AppModelConfig(Base):
    __tablename__ = "app_model_configs"
    __table_args__ = (db.PrimaryKeyConstraint("id", name="app_model_config_pkey"), db.Index("app_app_id_idx", "app_id"))

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    provider = db.Column(db.String(255), nullable=True)
    model_id = db.Column(db.String(255), nullable=True)
    configs = db.Column(db.JSON, nullable=True)
    created_by = db.Column(StringUUID, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by = db.Column(StringUUID, nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    opening_statement = db.Column(db.Text)
    suggested_questions = db.Column(db.Text)
    suggested_questions_after_answer = db.Column(db.Text)
    speech_to_text = db.Column(db.Text)
    text_to_speech = db.Column(db.Text)
    more_like_this = db.Column(db.Text)
    model = db.Column(db.Text)
    user_input_form = db.Column(db.Text)
    dataset_query_variable = db.Column(db.String(255))
    pre_prompt = db.Column(db.Text)
    agent_mode = db.Column(db.Text)
    sensitive_word_avoidance = db.Column(db.Text)
    retriever_resource = db.Column(db.Text)
    prompt_type = db.Column(db.String(255), nullable=False, server_default=db.text("'simple'::character varying"))
    chat_prompt_config = db.Column(db.Text)
    completion_prompt_config = db.Column(db.Text)
    dataset_configs = db.Column(db.Text)
    external_data_tools = db.Column(db.Text)
    file_upload = db.Column(db.Text)

    @property
    def app(self):
        app = db.session.query(App).filter(App.id == self.app_id).first()
        return app

    @property
    def model_dict(self) -> dict:
        return json.loads(self.model) if self.model else {}

    @property
    def suggested_questions_list(self) -> list:
        return json.loads(self.suggested_questions) if self.suggested_questions else []

    @property
    def suggested_questions_after_answer_dict(self) -> dict:
        return (
            json.loads(self.suggested_questions_after_answer)
            if self.suggested_questions_after_answer
            else {"enabled": False}
        )

    @property
    def speech_to_text_dict(self) -> dict:
        return json.loads(self.speech_to_text) if self.speech_to_text else {"enabled": False}

    @property
    def text_to_speech_dict(self) -> dict:
        return json.loads(self.text_to_speech) if self.text_to_speech else {"enabled": False}

    @property
    def retriever_resource_dict(self) -> dict:
        return json.loads(self.retriever_resource) if self.retriever_resource else {"enabled": True}

    @property
    def annotation_reply_dict(self) -> dict:
        annotation_setting = (
            db.session.query(AppAnnotationSetting).filter(AppAnnotationSetting.app_id == self.app_id).first()
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
    def more_like_this_dict(self) -> dict:
        return json.loads(self.more_like_this) if self.more_like_this else {"enabled": False}

    @property
    def sensitive_word_avoidance_dict(self) -> dict:
        return (
            json.loads(self.sensitive_word_avoidance)
            if self.sensitive_word_avoidance
            else {"enabled": False, "type": "", "configs": []}
        )

    @property
    def external_data_tools_list(self) -> list[dict]:
        return json.loads(self.external_data_tools) if self.external_data_tools else []

    @property
    def user_input_form_list(self):
        return json.loads(self.user_input_form) if self.user_input_form else []

    @property
    def agent_mode_dict(self) -> dict:
        return (
            json.loads(self.agent_mode)
            if self.agent_mode
            else {"enabled": False, "strategy": None, "tools": [], "prompt": None}
        )

    @property
    def chat_prompt_config_dict(self) -> dict:
        return json.loads(self.chat_prompt_config) if self.chat_prompt_config else {}

    @property
    def completion_prompt_config_dict(self) -> dict:
        return json.loads(self.completion_prompt_config) if self.completion_prompt_config else {}

    @property
    def dataset_configs_dict(self) -> dict:
        if self.dataset_configs:
            dataset_configs: dict = json.loads(self.dataset_configs)
            if "retrieval_model" not in dataset_configs:
                return {"retrieval_model": "single"}
            else:
                return dataset_configs
        return {
            "retrieval_model": "multiple",
        }

    @property
    def file_upload_dict(self) -> dict:
        return (
            json.loads(self.file_upload)
            if self.file_upload
            else {
                "image": {
                    "enabled": False,
                    "number_limits": 3,
                    "detail": "high",
                    "transfer_methods": ["remote_url", "local_file"],
                }
            }
        )

    def to_dict(self) -> dict:
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

    def copy(self):
        new_app_model_config = AppModelConfig(
            id=self.id,
            app_id=self.app_id,
            opening_statement=self.opening_statement,
            suggested_questions=self.suggested_questions,
            suggested_questions_after_answer=self.suggested_questions_after_answer,
            speech_to_text=self.speech_to_text,
            text_to_speech=self.text_to_speech,
            more_like_this=self.more_like_this,
            sensitive_word_avoidance=self.sensitive_word_avoidance,
            external_data_tools=self.external_data_tools,
            model=self.model,
            user_input_form=self.user_input_form,
            dataset_query_variable=self.dataset_query_variable,
            pre_prompt=self.pre_prompt,
            agent_mode=self.agent_mode,
            retriever_resource=self.retriever_resource,
            prompt_type=self.prompt_type,
            chat_prompt_config=self.chat_prompt_config,
            completion_prompt_config=self.completion_prompt_config,
            dataset_configs=self.dataset_configs,
            file_upload=self.file_upload,
        )

        return new_app_model_config


class RecommendedApp(Base):
    __tablename__ = "recommended_apps"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="recommended_app_pkey"),
        db.Index("recommended_app_app_id_idx", "app_id"),
        db.Index("recommended_app_is_listed_idx", "is_listed", "language"),
    )

    id = db.Column(StringUUID, primary_key=True, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    description = db.Column(db.JSON, nullable=False)
    copyright = db.Column(db.String(255), nullable=False)
    privacy_policy = db.Column(db.String(255), nullable=False)
    custom_disclaimer: Mapped[str] = mapped_column(sa.TEXT, default="")
    category = db.Column(db.String(255), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    is_listed = db.Column(db.Boolean, nullable=False, default=True)
    install_count = db.Column(db.Integer, nullable=False, default=0)
    language = db.Column(db.String(255), nullable=False, server_default=db.text("'en-US'::character varying"))
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def app(self):
        app = db.session.query(App).filter(App.id == self.app_id).first()
        return app


class InstalledApp(Base):
    __tablename__ = "installed_apps"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="installed_app_pkey"),
        db.Index("installed_app_tenant_id_idx", "tenant_id"),
        db.Index("installed_app_app_id_idx", "app_id"),
        db.UniqueConstraint("tenant_id", "app_id", name="unique_tenant_app"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    app_id = db.Column(StringUUID, nullable=False)
    app_owner_tenant_id = db.Column(StringUUID, nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    is_pinned = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    last_used_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def app(self):
        app = db.session.query(App).filter(App.id == self.app_id).first()
        return app

    @property
    def tenant(self):
        tenant = db.session.query(Tenant).filter(Tenant.id == self.tenant_id).first()
        return tenant


class Conversation(db.Model):  # type: ignore[name-defined]
    __tablename__ = "conversations"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="conversation_pkey"),
        db.Index("conversation_app_from_user_idx", "app_id", "from_source", "from_end_user_id"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    app_model_config_id = db.Column(StringUUID, nullable=True)
    model_provider = db.Column(db.String(255), nullable=True)
    override_model_configs = db.Column(db.Text)
    model_id = db.Column(db.String(255), nullable=True)
    mode: Mapped[str] = mapped_column(db.String(255))
    name = db.Column(db.String(255), nullable=False)
    summary = db.Column(db.Text)
    _inputs: Mapped[dict] = mapped_column("inputs", db.JSON)
    introduction = db.Column(db.Text)
    system_instruction = db.Column(db.Text)
    system_instruction_tokens = db.Column(db.Integer, nullable=False, server_default=db.text("0"))
    status = db.Column(db.String(255), nullable=False)
    invoke_from = db.Column(db.String(255), nullable=True)
    from_source = db.Column(db.String(255), nullable=False)
    from_end_user_id = db.Column(StringUUID)
    from_account_id = db.Column(StringUUID)
    read_at = db.Column(db.DateTime)
    read_account_id = db.Column(StringUUID)
    dialogue_count: Mapped[int] = mapped_column(default=0)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    messages = db.relationship("Message", backref="conversation", lazy="select", passive_deletes="all")
    message_annotations = db.relationship(
        "MessageAnnotation", backref="conversation", lazy="select", passive_deletes="all"
    )

    is_deleted = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))

    @property
    def inputs(self):
        inputs = self._inputs.copy()

        # Convert file mapping to File object
        for key, value in inputs.items():
            # NOTE: It's not the best way to implement this, but it's the only way to avoid circular import for now.
            from factories import file_factory

            if isinstance(value, dict) and value.get("dify_model_identity") == FILE_MODEL_IDENTITY:
                if value["transfer_method"] == FileTransferMethod.TOOL_FILE:
                    value["tool_file_id"] = value["related_id"]
                elif value["transfer_method"] == FileTransferMethod.LOCAL_FILE:
                    value["upload_file_id"] = value["related_id"]
                inputs[key] = file_factory.build_from_mapping(mapping=value, tenant_id=value["tenant_id"])
            elif isinstance(value, list) and all(
                isinstance(item, dict) and item.get("dify_model_identity") == FILE_MODEL_IDENTITY for item in value
            ):
                inputs[key] = []
                for item in value:
                    if item["transfer_method"] == FileTransferMethod.TOOL_FILE:
                        item["tool_file_id"] = item["related_id"]
                    elif item["transfer_method"] == FileTransferMethod.LOCAL_FILE:
                        item["upload_file_id"] = item["related_id"]
                    inputs[key].append(file_factory.build_from_mapping(mapping=item, tenant_id=item["tenant_id"]))

        return inputs

    @inputs.setter
    def inputs(self, value: Mapping[str, Any]):
        inputs = dict(value)
        for k, v in inputs.items():
            if isinstance(v, File):
                inputs[k] = v.model_dump()
            elif isinstance(v, list) and all(isinstance(item, File) for item in v):
                inputs[k] = [item.model_dump() for item in v]
        self._inputs = inputs

    @property
    def model_config(self):
        model_config = {}
        app_model_config: Optional[AppModelConfig] = None

        if self.mode == AppMode.ADVANCED_CHAT.value:
            if self.override_model_configs:
                override_model_configs = json.loads(self.override_model_configs)
                model_config = override_model_configs
        else:
            if self.override_model_configs:
                override_model_configs = json.loads(self.override_model_configs)

                if "model" in override_model_configs:
                    app_model_config = AppModelConfig()
                    app_model_config = app_model_config.from_model_config_dict(override_model_configs)
                    assert app_model_config is not None, "app model config not found"
                    model_config = app_model_config.to_dict()
                else:
                    model_config["configs"] = override_model_configs
            else:
                app_model_config = (
                    db.session.query(AppModelConfig).filter(AppModelConfig.id == self.app_model_config_id).first()
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
        return db.session.query(MessageAnnotation).filter(MessageAnnotation.conversation_id == self.id).count() > 0

    @property
    def annotation(self):
        return db.session.query(MessageAnnotation).filter(MessageAnnotation.conversation_id == self.id).first()

    @property
    def message_count(self):
        return db.session.query(Message).filter(Message.conversation_id == self.id).count()

    @property
    def user_feedback_stats(self):
        like = (
            db.session.query(MessageFeedback)
            .filter(
                MessageFeedback.conversation_id == self.id,
                MessageFeedback.from_source == "user",
                MessageFeedback.rating == "like",
            )
            .count()
        )

        dislike = (
            db.session.query(MessageFeedback)
            .filter(
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
            .filter(
                MessageFeedback.conversation_id == self.id,
                MessageFeedback.from_source == "admin",
                MessageFeedback.rating == "like",
            )
            .count()
        )

        dislike = (
            db.session.query(MessageFeedback)
            .filter(
                MessageFeedback.conversation_id == self.id,
                MessageFeedback.from_source == "admin",
                MessageFeedback.rating == "dislike",
            )
            .count()
        )

        return {"like": like, "dislike": dislike}

    @property
    def status_count(self):
        messages = db.session.query(Message).filter(Message.conversation_id == self.id).all()
        status_counts = {
            WorkflowRunStatus.RUNNING: 0,
            WorkflowRunStatus.SUCCEEDED: 0,
            WorkflowRunStatus.FAILED: 0,
            WorkflowRunStatus.STOPPED: 0,
            WorkflowRunStatus.PARTIAL_SUCCESSED: 0,
        }

        for message in messages:
            if message.workflow_run:
                status_counts[message.workflow_run.status] += 1

        return (
            {
                "success": status_counts[WorkflowRunStatus.SUCCEEDED],
                "failed": status_counts[WorkflowRunStatus.FAILED],
                "partial_success": status_counts[WorkflowRunStatus.PARTIAL_SUCCESSED],
            }
            if messages
            else None
        )

    @property
    def first_message(self):
        return db.session.query(Message).filter(Message.conversation_id == self.id).first()

    @property
    def app(self):
        return db.session.query(App).filter(App.id == self.app_id).first()

    @property
    def from_end_user_session_id(self):
        if self.from_end_user_id:
            end_user = db.session.query(EndUser).filter(EndUser.id == self.from_end_user_id).first()
            if end_user:
                return end_user.session_id

        return None

    @property
    def from_account_name(self):
        if self.from_account_id:
            account = db.session.query(Account).filter(Account.id == self.from_account_id).first()
            if account:
                return account.name

        return None

    @property
    def in_debug_mode(self):
        return self.override_model_configs is not None


class Message(db.Model):  # type: ignore[name-defined]
    __tablename__ = "messages"
    __table_args__ = (
        PrimaryKeyConstraint("id", name="message_pkey"),
        Index("message_app_id_idx", "app_id", "created_at"),
        Index("message_conversation_id_idx", "conversation_id"),
        Index("message_end_user_idx", "app_id", "from_source", "from_end_user_id"),
        Index("message_account_idx", "app_id", "from_source", "from_account_id"),
        Index("message_workflow_run_id_idx", "conversation_id", "workflow_run_id"),
        Index("message_created_at_idx", "created_at"),
    )

    id: Mapped[str] = mapped_column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    model_provider = db.Column(db.String(255), nullable=True)
    model_id = db.Column(db.String(255), nullable=True)
    override_model_configs = db.Column(db.Text)
    conversation_id = db.Column(StringUUID, db.ForeignKey("conversations.id"), nullable=False)
    _inputs: Mapped[dict] = mapped_column("inputs", db.JSON)
    query: Mapped[str] = db.Column(db.Text, nullable=False)
    message = db.Column(db.JSON, nullable=False)
    message_tokens = db.Column(db.Integer, nullable=False, server_default=db.text("0"))
    message_unit_price = db.Column(db.Numeric(10, 4), nullable=False)
    message_price_unit = db.Column(db.Numeric(10, 7), nullable=False, server_default=db.text("0.001"))
    answer: Mapped[str] = db.Column(db.Text, nullable=False)
    answer_tokens = db.Column(db.Integer, nullable=False, server_default=db.text("0"))
    answer_unit_price = db.Column(db.Numeric(10, 4), nullable=False)
    answer_price_unit = db.Column(db.Numeric(10, 7), nullable=False, server_default=db.text("0.001"))
    parent_message_id = db.Column(StringUUID, nullable=True)
    provider_response_latency = db.Column(db.Float, nullable=False, server_default=db.text("0"))
    total_price = db.Column(db.Numeric(10, 7))
    currency = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(255), nullable=False, server_default=db.text("'normal'::character varying"))
    error = db.Column(db.Text)
    message_metadata = db.Column(db.Text)
    invoke_from: Mapped[Optional[str]] = db.Column(db.String(255), nullable=True)
    from_source = db.Column(db.String(255), nullable=False)
    from_end_user_id: Mapped[Optional[str]] = db.Column(StringUUID)
    from_account_id: Mapped[Optional[str]] = db.Column(StringUUID)
    created_at: Mapped[datetime] = mapped_column(db.DateTime, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    agent_based = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    workflow_run_id = db.Column(StringUUID)

    @property
    def inputs(self):
        inputs = self._inputs.copy()
        for key, value in inputs.items():
            # NOTE: It's not the best way to implement this, but it's the only way to avoid circular import for now.
            from factories import file_factory

            if isinstance(value, dict) and value.get("dify_model_identity") == FILE_MODEL_IDENTITY:
                if value["transfer_method"] == FileTransferMethod.TOOL_FILE:
                    value["tool_file_id"] = value["related_id"]
                elif value["transfer_method"] == FileTransferMethod.LOCAL_FILE:
                    value["upload_file_id"] = value["related_id"]
                inputs[key] = file_factory.build_from_mapping(mapping=value, tenant_id=value["tenant_id"])
            elif isinstance(value, list) and all(
                isinstance(item, dict) and item.get("dify_model_identity") == FILE_MODEL_IDENTITY for item in value
            ):
                inputs[key] = []
                for item in value:
                    if item["transfer_method"] == FileTransferMethod.TOOL_FILE:
                        item["tool_file_id"] = item["related_id"]
                    elif item["transfer_method"] == FileTransferMethod.LOCAL_FILE:
                        item["upload_file_id"] = item["related_id"]
                    inputs[key].append(file_factory.build_from_mapping(mapping=item, tenant_id=item["tenant_id"]))
        return inputs

    @inputs.setter
    def inputs(self, value: Mapping[str, Any]):
        inputs = dict(value)
        for k, v in inputs.items():
            if isinstance(v, File):
                inputs[k] = v.model_dump()
            elif isinstance(v, list) and all(isinstance(item, File) for item in v):
                inputs[k] = [item.model_dump() for item in v]
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

                sign_url = ToolFileParser.get_tool_file_manager().sign_file(
                    tool_file_id=tool_file_id, extension=extension
                )
            elif "file-preview" in url:
                # get upload file id
                upload_file_id_pattern = r"\/files\/([\w-]+)\/file-preview?\?timestamp="
                result = re.search(upload_file_id_pattern, url)
                if not result:
                    continue

                upload_file_id = result.group(1)
                if not upload_file_id:
                    continue
                sign_url = file_helpers.get_signed_file_url(upload_file_id)
            elif "image-preview" in url:
                # image-preview is deprecated, use file-preview instead
                upload_file_id_pattern = r"\/files\/([\w-]+)\/image-preview?\?timestamp="
                result = re.search(upload_file_id_pattern, url)
                if not result:
                    continue
                upload_file_id = result.group(1)
                if not upload_file_id:
                    continue
                sign_url = file_helpers.get_signed_file_url(upload_file_id)
            else:
                continue

            re_sign_file_url_answer = re_sign_file_url_answer.replace(url, sign_url)

        return re_sign_file_url_answer

    @property
    def user_feedback(self):
        feedback = (
            db.session.query(MessageFeedback)
            .filter(MessageFeedback.message_id == self.id, MessageFeedback.from_source == "user")
            .first()
        )
        return feedback

    @property
    def admin_feedback(self):
        feedback = (
            db.session.query(MessageFeedback)
            .filter(MessageFeedback.message_id == self.id, MessageFeedback.from_source == "admin")
            .first()
        )
        return feedback

    @property
    def feedbacks(self):
        feedbacks = db.session.query(MessageFeedback).filter(MessageFeedback.message_id == self.id).all()
        return feedbacks

    @property
    def annotation(self):
        annotation = db.session.query(MessageAnnotation).filter(MessageAnnotation.message_id == self.id).first()
        return annotation

    @property
    def annotation_hit_history(self):
        annotation_history = (
            db.session.query(AppAnnotationHitHistory).filter(AppAnnotationHitHistory.message_id == self.id).first()
        )
        if annotation_history:
            annotation = (
                db.session.query(MessageAnnotation)
                .filter(MessageAnnotation.id == annotation_history.annotation_id)
                .first()
            )
            return annotation
        return None

    @property
    def app_model_config(self):
        conversation = db.session.query(Conversation).filter(Conversation.id == self.conversation_id).first()
        if conversation:
            return (
                db.session.query(AppModelConfig).filter(AppModelConfig.id == conversation.app_model_config_id).first()
            )

        return None

    @property
    def in_debug_mode(self):
        return self.override_model_configs is not None

    @property
    def message_metadata_dict(self) -> dict:
        return json.loads(self.message_metadata) if self.message_metadata else {}

    @property
    def agent_thoughts(self):
        return (
            db.session.query(MessageAgentThought)
            .filter(MessageAgentThought.message_id == self.id)
            .order_by(MessageAgentThought.position.asc())
            .all()
        )

    @property
    def retriever_resources(self):
        return (
            db.session.query(DatasetRetrieverResource)
            .filter(DatasetRetrieverResource.message_id == self.id)
            .order_by(DatasetRetrieverResource.position.asc())
            .all()
        )

    @property
    def message_files(self):
        from factories import file_factory

        message_files = db.session.query(MessageFile).filter(MessageFile.message_id == self.id).all()
        current_app = db.session.query(App).filter(App.id == self.app_id).first()
        if not current_app:
            raise ValueError(f"App {self.app_id} not found")

        files = []
        for message_file in message_files:
            if message_file.transfer_method == "local_file":
                if message_file.upload_file_id is None:
                    raise ValueError(f"MessageFile {message_file.id} is a local file but has no upload_file_id")
                file = file_factory.build_from_mapping(
                    mapping={
                        "id": message_file.id,
                        "upload_file_id": message_file.upload_file_id,
                        "transfer_method": message_file.transfer_method,
                        "type": message_file.type,
                    },
                    tenant_id=current_app.tenant_id,
                )
            elif message_file.transfer_method == "remote_url":
                if message_file.url is None:
                    raise ValueError(f"MessageFile {message_file.id} is a remote url but has no url")
                file = file_factory.build_from_mapping(
                    mapping={
                        "id": message_file.id,
                        "type": message_file.type,
                        "transfer_method": message_file.transfer_method,
                        "url": message_file.url,
                    },
                    tenant_id=current_app.tenant_id,
                )
            elif message_file.transfer_method == "tool_file":
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

        result = [
            {"belongs_to": message_file.belongs_to, **file.to_dict()}
            for (file, message_file) in zip(files, message_files)
        ]

        db.session.commit()
        return result

    @property
    def workflow_run(self):
        if self.workflow_run_id:
            from .workflow import WorkflowRun

            return db.session.query(WorkflowRun).filter(WorkflowRun.id == self.workflow_run_id).first()

        return None

    def to_dict(self) -> dict:
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
    def from_dict(cls, data: dict):
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


class MessageFeedback(db.Model):  # type: ignore[name-defined]
    __tablename__ = "message_feedbacks"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="message_feedback_pkey"),
        db.Index("message_feedback_app_idx", "app_id"),
        db.Index("message_feedback_message_idx", "message_id", "from_source"),
        db.Index("message_feedback_conversation_idx", "conversation_id", "from_source", "rating"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    conversation_id = db.Column(StringUUID, nullable=False)
    message_id = db.Column(StringUUID, nullable=False)
    rating = db.Column(db.String(255), nullable=False)
    content = db.Column(db.Text)
    from_source = db.Column(db.String(255), nullable=False)
    from_end_user_id = db.Column(StringUUID)
    from_account_id = db.Column(StringUUID)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def from_account(self):
        account = db.session.query(Account).filter(Account.id == self.from_account_id).first()
        return account


class MessageFile(db.Model):  # type: ignore[name-defined]
    __tablename__ = "message_files"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="message_file_pkey"),
        db.Index("message_file_message_idx", "message_id"),
        db.Index("message_file_created_by_idx", "created_by"),
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
        created_by_role: CreatedByRole,
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

    id: Mapped[str] = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    message_id: Mapped[str] = db.Column(StringUUID, nullable=False)
    type: Mapped[str] = db.Column(db.String(255), nullable=False)
    transfer_method: Mapped[str] = db.Column(db.String(255), nullable=False)
    url: Mapped[Optional[str]] = db.Column(db.Text, nullable=True)
    belongs_to: Mapped[Optional[str]] = db.Column(db.String(255), nullable=True)
    upload_file_id: Mapped[Optional[str]] = db.Column(StringUUID, nullable=True)
    created_by_role: Mapped[str] = db.Column(db.String(255), nullable=False)
    created_by: Mapped[str] = db.Column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class MessageAnnotation(db.Model):  # type: ignore[name-defined]
    __tablename__ = "message_annotations"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="message_annotation_pkey"),
        db.Index("message_annotation_app_idx", "app_id"),
        db.Index("message_annotation_conversation_idx", "conversation_id"),
        db.Index("message_annotation_message_idx", "message_id"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    conversation_id = db.Column(StringUUID, db.ForeignKey("conversations.id"), nullable=True)
    message_id = db.Column(StringUUID, nullable=True)
    question = db.Column(db.Text, nullable=True)
    content = db.Column(db.Text, nullable=False)
    hit_count = db.Column(db.Integer, nullable=False, server_default=db.text("0"))
    account_id = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def account(self):
        account = db.session.query(Account).filter(Account.id == self.account_id).first()
        return account

    @property
    def annotation_create_account(self):
        account = db.session.query(Account).filter(Account.id == self.account_id).first()
        return account


class AppAnnotationHitHistory(db.Model):  # type: ignore[name-defined]
    __tablename__ = "app_annotation_hit_histories"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="app_annotation_hit_histories_pkey"),
        db.Index("app_annotation_hit_histories_app_idx", "app_id"),
        db.Index("app_annotation_hit_histories_account_idx", "account_id"),
        db.Index("app_annotation_hit_histories_annotation_idx", "annotation_id"),
        db.Index("app_annotation_hit_histories_message_idx", "message_id"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    annotation_id = db.Column(StringUUID, nullable=False)
    source = db.Column(db.Text, nullable=False)
    question = db.Column(db.Text, nullable=False)
    account_id = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    score = db.Column(Float, nullable=False, server_default=db.text("0"))
    message_id = db.Column(StringUUID, nullable=False)
    annotation_question = db.Column(db.Text, nullable=False)
    annotation_content = db.Column(db.Text, nullable=False)

    @property
    def account(self):
        account = (
            db.session.query(Account)
            .join(MessageAnnotation, MessageAnnotation.account_id == Account.id)
            .filter(MessageAnnotation.id == self.annotation_id)
            .first()
        )
        return account

    @property
    def annotation_create_account(self):
        account = db.session.query(Account).filter(Account.id == self.account_id).first()
        return account


class AppAnnotationSetting(db.Model):  # type: ignore[name-defined]
    __tablename__ = "app_annotation_settings"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="app_annotation_settings_pkey"),
        db.Index("app_annotation_settings_app_idx", "app_id"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    score_threshold = db.Column(Float, nullable=False, server_default=db.text("0"))
    collection_binding_id = db.Column(StringUUID, nullable=False)
    created_user_id = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_user_id = db.Column(StringUUID, nullable=False)
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @property
    def created_account(self):
        account = (
            db.session.query(Account)
            .join(AppAnnotationSetting, AppAnnotationSetting.created_user_id == Account.id)
            .filter(AppAnnotationSetting.id == self.annotation_id)
            .first()
        )
        return account

    @property
    def updated_account(self):
        account = (
            db.session.query(Account)
            .join(AppAnnotationSetting, AppAnnotationSetting.updated_user_id == Account.id)
            .filter(AppAnnotationSetting.id == self.annotation_id)
            .first()
        )
        return account

    @property
    def collection_binding_detail(self):
        from .dataset import DatasetCollectionBinding

        collection_binding_detail = (
            db.session.query(DatasetCollectionBinding)
            .filter(DatasetCollectionBinding.id == self.collection_binding_id)
            .first()
        )
        return collection_binding_detail


class OperationLog(Base):
    __tablename__ = "operation_logs"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="operation_log_pkey"),
        db.Index("operation_log_account_action_idx", "tenant_id", "account_id", "action"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    account_id = db.Column(StringUUID, nullable=False)
    action = db.Column(db.String(255), nullable=False)
    content = db.Column(db.JSON)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    created_ip = db.Column(db.String(255), nullable=False)
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class EndUser(Base, UserMixin):
    __tablename__ = "end_users"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="end_user_pkey"),
        db.Index("end_user_session_id_idx", "session_id", "type"),
        db.Index("end_user_tenant_session_id_idx", "tenant_id", "session_id", "type"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    app_id = db.Column(StringUUID, nullable=True)
    type = db.Column(db.String(255), nullable=False)
    external_user_id = db.Column(db.String(255), nullable=True)
    name = db.Column(db.String(255))
    is_anonymous = db.Column(db.Boolean, nullable=False, server_default=db.text("true"))
    session_id: Mapped[str] = mapped_column()
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="site_pkey"),
        db.Index("site_app_id_idx", "app_id"),
        db.Index("site_code_idx", "code", "status"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    title = db.Column(db.String(255), nullable=False)
    icon_type = db.Column(db.String(255), nullable=True)
    icon = db.Column(db.String(255))
    icon_background = db.Column(db.String(255))
    description = db.Column(db.Text)
    default_language = db.Column(db.String(255), nullable=False)
    chat_color_theme = db.Column(db.String(255))
    chat_color_theme_inverted = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    copyright = db.Column(db.String(255))
    privacy_policy = db.Column(db.String(255))
    show_workflow_steps = db.Column(db.Boolean, nullable=False, server_default=db.text("true"))
    use_icon_as_answer_icon = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    _custom_disclaimer: Mapped[str] = mapped_column("custom_disclaimer", sa.TEXT, default="")
    customize_domain = db.Column(db.String(255))
    customize_token_strategy = db.Column(db.String(255), nullable=False)
    prompt_public = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    status = db.Column(db.String(255), nullable=False, server_default=db.text("'normal'::character varying"))
    created_by = db.Column(StringUUID, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_by = db.Column(StringUUID, nullable=True)
    updated_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    code = db.Column(db.String(255))

    @property
    def custom_disclaimer(self):
        return self._custom_disclaimer

    @custom_disclaimer.setter
    def custom_disclaimer(self, value: str):
        if len(value) > 512:
            raise ValueError("Custom disclaimer cannot exceed 512 characters.")
        self._custom_disclaimer = value

    @staticmethod
    def generate_code(n):
        while True:
            result = generate_string(n)
            while db.session.query(Site).filter(Site.code == result).count() > 0:
                result = generate_string(n)

            return result

    @property
    def app_base_url(self):
        return dify_config.APP_WEB_URL or request.url_root.rstrip("/")


class ApiToken(Base):
    __tablename__ = "api_tokens"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="api_token_pkey"),
        db.Index("api_token_app_id_type_idx", "app_id", "type"),
        db.Index("api_token_token_idx", "token", "type"),
        db.Index("api_token_tenant_idx", "tenant_id", "type"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=True)
    tenant_id = db.Column(StringUUID, nullable=True)
    type = db.Column(db.String(16), nullable=False)
    token = db.Column(db.String(255), nullable=False)
    last_used_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())

    @staticmethod
    def generate_api_key(prefix, n):
        while True:
            result = prefix + generate_string(n)
            if db.session.query(ApiToken).filter(ApiToken.token == result).count() > 0:
                continue
            return result


class UploadFile(Base):
    __tablename__ = "upload_files"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="upload_file_pkey"),
        db.Index("upload_file_tenant_idx", "tenant_id"),
    )

    id: Mapped[str] = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id: Mapped[str] = db.Column(StringUUID, nullable=False)
    storage_type: Mapped[str] = db.Column(db.String(255), nullable=False)
    key: Mapped[str] = db.Column(db.String(255), nullable=False)
    name: Mapped[str] = db.Column(db.String(255), nullable=False)
    size: Mapped[int] = db.Column(db.Integer, nullable=False)
    extension: Mapped[str] = db.Column(db.String(255), nullable=False)
    mime_type: Mapped[str] = db.Column(db.String(255), nullable=True)
    created_by_role: Mapped[str] = db.Column(
        db.String(255), nullable=False, server_default=db.text("'account'::character varying")
    )
    created_by: Mapped[str] = db.Column(StringUUID, nullable=False)
    created_at: Mapped[datetime] = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    used: Mapped[bool] = db.Column(db.Boolean, nullable=False, server_default=db.text("false"))
    used_by: Mapped[str | None] = db.Column(StringUUID, nullable=True)
    used_at: Mapped[datetime | None] = db.Column(db.DateTime, nullable=True)
    hash: Mapped[str | None] = db.Column(db.String(255), nullable=True)
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
        created_by_role: CreatedByRole,
        created_by: str,
        created_at: datetime,
        used: bool,
        used_by: str | None = None,
        used_at: datetime | None = None,
        hash: str | None = None,
        source_url: str = "",
    ):
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
        db.PrimaryKeyConstraint("id", name="api_request_pkey"),
        db.Index("api_request_token_idx", "tenant_id", "api_token_id"),
    )

    id = db.Column(StringUUID, nullable=False, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=False)
    api_token_id = db.Column(StringUUID, nullable=False)
    path = db.Column(db.String(255), nullable=False)
    request = db.Column(db.Text, nullable=True)
    response = db.Column(db.Text, nullable=True)
    ip = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class MessageChain(Base):
    __tablename__ = "message_chains"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="message_chain_pkey"),
        db.Index("message_chain_message_id_idx", "message_id"),
    )

    id = db.Column(StringUUID, nullable=False, server_default=db.text("uuid_generate_v4()"))
    message_id = db.Column(StringUUID, nullable=False)
    type = db.Column(db.String(255), nullable=False)
    input = db.Column(db.Text, nullable=True)
    output = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.current_timestamp())


class MessageAgentThought(Base):
    __tablename__ = "message_agent_thoughts"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="message_agent_thought_pkey"),
        db.Index("message_agent_thought_message_id_idx", "message_id"),
        db.Index("message_agent_thought_message_chain_id_idx", "message_chain_id"),
    )

    id = db.Column(StringUUID, nullable=False, server_default=db.text("uuid_generate_v4()"))
    message_id = db.Column(StringUUID, nullable=False)
    message_chain_id = db.Column(StringUUID, nullable=True)
    position = db.Column(db.Integer, nullable=False)
    thought = db.Column(db.Text, nullable=True)
    tool = db.Column(db.Text, nullable=True)
    tool_labels_str = db.Column(db.Text, nullable=False, server_default=db.text("'{}'::text"))
    tool_meta_str = db.Column(db.Text, nullable=False, server_default=db.text("'{}'::text"))
    tool_input = db.Column(db.Text, nullable=True)
    observation = db.Column(db.Text, nullable=True)
    # plugin_id = db.Column(StringUUID, nullable=True)  ## for future design
    tool_process_data = db.Column(db.Text, nullable=True)
    message = db.Column(db.Text, nullable=True)
    message_token = db.Column(db.Integer, nullable=True)
    message_unit_price = db.Column(db.Numeric, nullable=True)
    message_price_unit = db.Column(db.Numeric(10, 7), nullable=False, server_default=db.text("0.001"))
    message_files = db.Column(db.Text, nullable=True)
    answer = db.Column(db.Text, nullable=True)
    answer_token = db.Column(db.Integer, nullable=True)
    answer_unit_price = db.Column(db.Numeric, nullable=True)
    answer_price_unit = db.Column(db.Numeric(10, 7), nullable=False, server_default=db.text("0.001"))
    tokens = db.Column(db.Integer, nullable=True)
    total_price = db.Column(db.Numeric, nullable=True)
    currency = db.Column(db.String, nullable=True)
    latency = db.Column(db.Float, nullable=True)
    created_by_role = db.Column(db.String, nullable=False)
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.current_timestamp())

    @property
    def files(self) -> list:
        if self.message_files:
            return cast(list[Any], json.loads(self.message_files))
        else:
            return []

    @property
    def tools(self) -> list[str]:
        return self.tool.split(";") if self.tool else []

    @property
    def tool_labels(self) -> dict:
        try:
            if self.tool_labels_str:
                return cast(dict, json.loads(self.tool_labels_str))
            else:
                return {}
        except Exception:
            return {}

    @property
    def tool_meta(self) -> dict:
        try:
            if self.tool_meta_str:
                return cast(dict, json.loads(self.tool_meta_str))
            else:
                return {}
        except Exception:
            return {}

    @property
    def tool_inputs_dict(self) -> dict:
        tools = self.tools
        try:
            if self.tool_input:
                data = json.loads(self.tool_input)
                result = {}
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
    def tool_outputs_dict(self):
        tools = self.tools
        try:
            if self.observation:
                data = json.loads(self.observation)
                result = {}
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
        db.PrimaryKeyConstraint("id", name="dataset_retriever_resource_pkey"),
        db.Index("dataset_retriever_resource_message_id_idx", "message_id"),
    )

    id = db.Column(StringUUID, nullable=False, server_default=db.text("uuid_generate_v4()"))
    message_id = db.Column(StringUUID, nullable=False)
    position = db.Column(db.Integer, nullable=False)
    dataset_id = db.Column(StringUUID, nullable=False)
    dataset_name = db.Column(db.Text, nullable=False)
    document_id = db.Column(StringUUID, nullable=True)
    document_name = db.Column(db.Text, nullable=False)
    data_source_type = db.Column(db.Text, nullable=True)
    segment_id = db.Column(StringUUID, nullable=True)
    score = db.Column(db.Float, nullable=True)
    content = db.Column(db.Text, nullable=False)
    hit_count = db.Column(db.Integer, nullable=True)
    word_count = db.Column(db.Integer, nullable=True)
    segment_position = db.Column(db.Integer, nullable=True)
    index_node_hash = db.Column(db.Text, nullable=True)
    retriever_from = db.Column(db.Text, nullable=False)
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=db.func.current_timestamp())


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tag_pkey"),
        db.Index("tag_type_idx", "type"),
        db.Index("tag_name_idx", "name"),
    )

    TAG_TYPE_LIST = ["knowledge", "app"]

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=True)
    type = db.Column(db.String(16), nullable=False)
    name = db.Column(db.String(255), nullable=False)
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class TagBinding(Base):
    __tablename__ = "tag_bindings"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tag_binding_pkey"),
        db.Index("tag_bind_target_id_idx", "target_id"),
        db.Index("tag_bind_tag_id_idx", "tag_id"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    tenant_id = db.Column(StringUUID, nullable=True)
    tag_id = db.Column(StringUUID, nullable=True)
    target_id = db.Column(StringUUID, nullable=True)
    created_by = db.Column(StringUUID, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())


class TraceAppConfig(Base):
    __tablename__ = "trace_app_config"
    __table_args__ = (
        db.PrimaryKeyConstraint("id", name="tracing_app_config_pkey"),
        db.Index("trace_app_config_app_id_idx", "app_id"),
    )

    id = db.Column(StringUUID, server_default=db.text("uuid_generate_v4()"))
    app_id = db.Column(StringUUID, nullable=False)
    tracing_provider = db.Column(db.String(255), nullable=True)
    tracing_config = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, server_default=func.current_timestamp())
    updated_at = db.Column(
        db.DateTime, nullable=False, server_default=func.current_timestamp(), onupdate=func.current_timestamp()
    )
    is_active = db.Column(db.Boolean, nullable=False, server_default=db.text("true"))

    @property
    def tracing_config_dict(self):
        return self.tracing_config or {}

    @property
    def tracing_config_str(self):
        return json.dumps(self.tracing_config_dict)

    def to_dict(self):
        return {
            "id": self.id,
            "app_id": self.app_id,
            "tracing_provider": self.tracing_provider,
            "tracing_config": self.tracing_config_dict,
            "is_active": self.is_active,
            "created_at": str(self.created_at) if self.created_at else None,
            "updated_at": str(self.updated_at) if self.updated_at else None,
        }
