import json
from typing import Any, cast

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from constants import HIDDEN_VALUE
from controllers.common.fields import SimpleResultResponse
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user_id,
)
from core.agent.entities import AgentToolEntity
from core.helper.encrypter import encrypt_token
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolParameterConfigurationManager
from events.app_event import app_model_config_was_updated
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.login import login_required
from models.model import App, AppMode, AppModelConfig
from services.app_model_config_service import AppModelConfigService


class ModelConfigRequest(BaseModel):
    provider: str | None = Field(default=None, description="Model provider")
    model: str | None = Field(default=None, description="Model name")
    configs: dict[str, Any] | None = Field(
        default=None,
        description="Model configuration parameters",
    )
    opening_statement: str | None = Field(default=None, description="Opening statement")
    suggested_questions: list[str] | None = Field(default=None, description="Suggested questions")
    more_like_this: dict[str, Any] | None = Field(
        default=None,
        description="More like this configuration",
    )
    speech_to_text: dict[str, Any] | None = Field(
        default=None,
        description="Speech to text configuration",
    )
    text_to_speech: dict[str, Any] | None = Field(
        default=None,
        description="Text to speech configuration",
    )
    retrieval_model: dict[str, Any] | None = Field(
        default=None,
        description="Retrieval model configuration",
    )
    tools: list[dict[str, Any]] | None = Field(
        default=None,
        description="Available tools",
    )
    dataset_configs: dict[str, Any] | None = Field(
        default=None,
        description="Dataset configurations",
    )
    agent_mode: dict[str, Any] | None = Field(
        default=None,
        description="Agent mode configuration",
    )
    engram: dict[str, Any] | None = Field(
        default=None,
        description="Weaviate Engram long-term memory configuration (enabled, api_key, endpoint)",
    )


register_schema_models(console_ns, ModelConfigRequest)
register_response_schema_models(console_ns, SimpleResultResponse)


def _encrypt_engram_api_key(*, tenant_id: str, previous_config_id: str | None, new_app_model_config: AppModelConfig):
    """
    Encrypt the per-app Engram API key before persistence.

    The console sends the key as plaintext when edited, the hidden sentinel when left unchanged, or
    empty when cleared. An unchanged key preserves the previously stored (already encrypted) value;
    a new key is encrypted with the tenant key; an empty key is stored empty (the app then inherits
    the deployment-wide credentials).
    """
    engram = new_app_model_config.engram_dict
    api_key = (engram.get("api_key") or "").strip()

    if api_key == HIDDEN_VALUE:
        previous = db.session.get(AppModelConfig, previous_config_id) if previous_config_id else None
        engram["api_key"] = (previous.engram_dict.get("api_key") if previous else "") or ""
    elif api_key:
        engram["api_key"] = encrypt_token(tenant_id, api_key)
    else:
        engram["api_key"] = ""

    new_app_model_config.engram = json.dumps(engram)


@console_ns.route("/apps/<uuid:app_id>/model-config")
class ModelConfigResource(Resource):
    @console_ns.doc("update_app_model_config")
    @console_ns.doc(description="Update application model configuration")
    @console_ns.doc(params={"app_id": "Application ID"})
    @console_ns.expect(console_ns.models[ModelConfigRequest.__name__])
    @console_ns.response(
        200,
        "Model configuration updated successfully",
        console_ns.models[SimpleResultResponse.__name__],
    )
    @console_ns.response(400, "Invalid configuration")
    @console_ns.response(404, "App not found")
    @setup_required
    @login_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.APP, RBACPermission.APP_VIEW_LAYOUT)
    @account_initialization_required
    @with_current_user_id
    @with_current_tenant_id
    @get_app_model(mode=[AppMode.AGENT_CHAT, AppMode.CHAT, AppMode.COMPLETION])
    def post(self, current_tenant_id: str, current_user_id: str, app_model: App):
        """Modify app model config"""
        # validate config
        model_configuration = AppModelConfigService.validate_configuration(
            tenant_id=current_tenant_id,
            config=cast(dict, request.json),
            app_mode=AppMode.value_of(app_model.mode),
        )

        new_app_model_config = AppModelConfig(
            app_id=app_model.id,
            created_by=current_user_id,
            updated_by=current_user_id,
        )
        new_app_model_config = new_app_model_config.from_model_config_dict(model_configuration)

        # Encrypt the per-app Engram API key (secret). Preserve the previously stored key when the
        # client sends the hidden sentinel (i.e. the key was not edited).
        _encrypt_engram_api_key(
            tenant_id=current_tenant_id,
            previous_config_id=app_model.app_model_config_id,
            new_app_model_config=new_app_model_config,
        )

        if app_model.mode == AppMode.AGENT_CHAT or app_model.is_agent:
            # get original app model config
            original_app_model_config = db.session.get(AppModelConfig, app_model.app_model_config_id)
            if original_app_model_config is None:
                raise ValueError("Original app model config not found")
            agent_mode = original_app_model_config.agent_mode_dict
            # decrypt agent tool parameters if it's secret-input
            parameter_map = {}
            masked_parameter_map = {}
            tool_map = {}
            for tool in agent_mode.get("tools") or []:
                if not isinstance(tool, dict) or len(tool.keys()) <= 3:
                    continue

                agent_tool_entity = AgentToolEntity.model_validate(tool)
                # get tool
                try:
                    tool_runtime = ToolManager.get_agent_tool_runtime(
                        tenant_id=current_tenant_id,
                        app_id=app_model.id,
                        agent_tool=agent_tool_entity,
                        user_id=current_user_id,
                    )
                    manager = ToolParameterConfigurationManager(
                        tenant_id=current_tenant_id,
                        tool_runtime=tool_runtime,
                        provider_name=agent_tool_entity.provider_id,
                        provider_type=agent_tool_entity.provider_type,
                        identity_id=f"AGENT.{app_model.id}",
                    )
                except Exception:
                    continue

                # get decrypted parameters
                if agent_tool_entity.tool_parameters:
                    parameters = manager.decrypt_tool_parameters(agent_tool_entity.tool_parameters or {})
                    masked_parameter = manager.mask_tool_parameters(parameters or {})
                else:
                    parameters = {}
                    masked_parameter = {}

                key = f"{agent_tool_entity.provider_id}.{agent_tool_entity.provider_type}.{agent_tool_entity.tool_name}"
                masked_parameter_map[key] = masked_parameter
                parameter_map[key] = parameters
                tool_map[key] = tool_runtime

            # encrypt agent tool parameters if it's secret-input
            agent_mode = new_app_model_config.agent_mode_dict
            for tool in agent_mode.get("tools") or []:
                agent_tool_entity = AgentToolEntity.model_validate(tool)

                # get tool
                key = f"{agent_tool_entity.provider_id}.{agent_tool_entity.provider_type}.{agent_tool_entity.tool_name}"
                if key in tool_map:
                    tool_runtime = tool_map[key]
                else:
                    try:
                        tool_runtime = ToolManager.get_agent_tool_runtime(
                            tenant_id=current_tenant_id,
                            app_id=app_model.id,
                            agent_tool=agent_tool_entity,
                            user_id=current_user_id,
                        )
                    except Exception:
                        continue

                manager = ToolParameterConfigurationManager(
                    tenant_id=current_tenant_id,
                    tool_runtime=tool_runtime,
                    provider_name=agent_tool_entity.provider_id,
                    provider_type=agent_tool_entity.provider_type,
                    identity_id=f"AGENT.{app_model.id}",
                )
                manager.delete_tool_parameters_cache()

                # override parameters if it equals to masked parameters
                if agent_tool_entity.tool_parameters:
                    if key not in masked_parameter_map:
                        continue

                    for masked_key, masked_value in masked_parameter_map[key].items():
                        if (
                            masked_key in agent_tool_entity.tool_parameters
                            and agent_tool_entity.tool_parameters[masked_key] == masked_value
                        ):
                            agent_tool_entity.tool_parameters[masked_key] = parameter_map[key].get(masked_key)

                # encrypt parameters
                if agent_tool_entity.tool_parameters:
                    tool["tool_parameters"] = manager.encrypt_tool_parameters(agent_tool_entity.tool_parameters or {})

            # update app model config
            new_app_model_config.agent_mode = json.dumps(agent_mode)

        db.session.add(new_app_model_config)
        db.session.flush()

        app_model.app_model_config_id = new_app_model_config.id
        app_model.updated_by = current_user_id
        app_model.updated_at = naive_utc_now()
        db.session.commit()

        app_model_config_was_updated.send(app_model, app_model_config=new_app_model_config)

        return {"result": "success"}
