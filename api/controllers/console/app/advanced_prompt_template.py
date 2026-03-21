from flask import request
from flask_restx import Resource, fields
from pydantic import BaseModel, Field

from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.advanced_prompt_template_service import AdvancedPromptTemplateService


class AdvancedPromptTemplateQuery(BaseModel):
    app_mode: str = Field(..., description="Application mode")
    model_mode: str = Field(..., description="Model mode")
    has_context: str = Field(default="true", description="Whether has context")
    model_name: str = Field(..., description="Model name")


console_ns.schema_model(
    AdvancedPromptTemplateQuery.__name__,
    AdvancedPromptTemplateQuery.model_json_schema(ref_template="#/definitions/{model}"),
)


@console_ns.route("/app/prompt-templates")
class AdvancedPromptTemplateList(Resource):
    @console_ns.doc("get_advanced_prompt_templates")
    @console_ns.doc(description="Get advanced prompt templates based on app mode and model configuration")
    @console_ns.expect(console_ns.models[AdvancedPromptTemplateQuery.__name__])
    @console_ns.response(
        200, "Prompt templates retrieved successfully", fields.List(fields.Raw(description="Prompt template data"))
    )
    @console_ns.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        args = AdvancedPromptTemplateQuery.model_validate(request.args.to_dict(flat=True))  # type: ignore

        return AdvancedPromptTemplateService.get_prompt(args.model_dump())
