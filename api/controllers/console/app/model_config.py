import json
from typing import cast

from flask import request
from flask_restx import Resource, fields
from werkzeug.exceptions import Forbidden

from controllers.console import api, console_ns
from controllers.console.app.wraps import get_app_model
from controllers.console.wraps import account_initialization_required, setup_required
from core.agent.entities import AgentToolEntity
from core.tools.tool_manager import ToolManager
from core.tools.utils.configuration import ToolParameterConfigurationManager
from events.app_event import app_model_config_was_updated
from extensions.ext_database import db
from libs.datetime_utils import naive_utc_now
from libs.login import current_account_with_tenant, login_required
from models.model import AppMode, AppModelConfig
from services.app_model_config_service import AppModelConfigService


@console_ns.route("/apps/<uuid:app_id>/model-config")
class ModelConfigResource(Resource):
    @api.doc("update_app_model_config")
    @api.doc(description="Update application model configuration")
    @api.doc(params={"app_id": "Application ID"})
    @api.expect(
        api.model(
            "ModelConfigRequest",
            {
                "provider": fields.String(description="Model provider"),
                "model": fields.String(description="Model name"),
                "configs": fields.Raw(description="Model configuration parameters"),
                "opening_statement": fields.String(description="Opening statement"),
                "suggested_questions": fields.List(fields.String(), description="Suggested questions"),
                "more_like_this": fields.Raw(description="More like this configuration"),
                "speech_to_text": fields.Raw(description="Speech to text configuration"),
                "text_to_speech": fields.Raw(description="Text to speech configuration"),
                "retrieval_model": fields.Raw(description="Retrieval model configuration"),
                "tools": fields.List(fields.Raw(), description="Available tools"),
                "dataset_configs": fields.Raw(description="Dataset configurations"),
                "agent_mode": fields.Raw(description="Agent mode configuration"),
            },
        )
    )
    @api.response(200, "Model configuration updated successfully")
    @api.response(400, "Invalid configuration")
    @api.response(404, "App not found")
    @setup_required
    @login_required
    @account_initialization_required
    @get_app_model(mode=[AppMode.AGENT_CHAT, AppMode.CHAT, AppMode.COMPLETION])
    def post(self, app_model):
        """Modify app model config"""
        current_user, current_tenant_id = current_account_with_tenant()

        if not current_user.has_edit_permission:
            raise Forbidden()

        # validate config
        model_configuration = AppModelConfigService.validate_configuration(
            tenant_id=current_tenant_id,
            config=cast(dict, request.json),
            app_mode=AppMode.value_of(app_model.mode),
        )

        new_app_model_config = AppModelConfig(
            app_id=app_model.id,
            created_by=current_user.id,
            updated_by=current_user.id,
        )
        new_app_model_config = new_app_model_config.from_model_config_dict(model_configuration)

        if app_model.mode == AppMode.AGENT_CHAT or app_model.is_agent:
            # get original app model config
            original_app_model_config = (
                db.session.query(AppModelConfig).where(AppModelConfig.id == app_model.app_model_config_id).first()
            )
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
        app_model.updated_by = current_user.id
        app_model.updated_at = naive_utc_now()
        db.session.commit()

        app_model_config_was_updated.send(app_model, app_model_config=new_app_model_config)

        return {"result": "success"}
