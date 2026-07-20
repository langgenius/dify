from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field

from controllers.common.schema import (
    DEFAULT_REF_TEMPLATE_OPENAPI_3_0,
    query_params_from_model,
    register_response_schema_models,
)
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from fields.base import ResponseModel
from libs.login import login_required
from services.advanced_prompt_template_service import AdvancedPromptTemplateArgs, AdvancedPromptTemplateService


class AdvancedPromptTemplateQuery(BaseModel):
    app_mode: str = Field(..., description="Application mode")
    model_mode: str = Field(..., description="Model mode")
    has_context: str = Field(default="true", description="Whether has context")
    model_name: str = Field(..., description="Model name")


class AdvancedPromptTemplateResponse(ResponseModel):
    chat_prompt_config: dict[str, Any] | None = Field(default=None)
    completion_prompt_config: dict[str, Any] | None = Field(default=None)


console_ns.schema_model(
    AdvancedPromptTemplateQuery.__name__,
    AdvancedPromptTemplateQuery.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_OPENAPI_3_0),
)
register_response_schema_models(console_ns, AdvancedPromptTemplateResponse)


@console_ns.route("/app/prompt-templates")
class AdvancedPromptTemplateList(Resource):
    @console_ns.doc("get_advanced_prompt_templates")
    @console_ns.doc(description="Get advanced prompt templates based on app mode and model configuration")
    @console_ns.doc(params=query_params_from_model(AdvancedPromptTemplateQuery))
    @console_ns.response(
        200,
        "Prompt templates retrieved successfully",
        console_ns.models[AdvancedPromptTemplateResponse.__name__],
    )
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        args = AdvancedPromptTemplateQuery.model_validate(request.args.to_dict(flat=True))
        prompt_args: AdvancedPromptTemplateArgs = {
            "app_mode": args.app_mode,
            "model_mode": args.model_mode,
            "model_name": args.model_name,
            "has_context": args.has_context,
        }
        return AdvancedPromptTemplateService.get_prompt(prompt_args)
