from flask_restx import Resource, fields, reqparse

from controllers.console import api, console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.advanced_prompt_template_service import AdvancedPromptTemplateService


@console_ns.route("/app/prompt-templates")
class AdvancedPromptTemplateList(Resource):
    @api.doc("get_advanced_prompt_templates")
    @api.doc(description="Get advanced prompt templates based on app mode and model configuration")
    @api.expect(
        api.parser()
        .add_argument("app_mode", type=str, required=True, location="args", help="Application mode")
        .add_argument("model_mode", type=str, required=True, location="args", help="Model mode")
        .add_argument("has_context", type=str, default="true", location="args", help="Whether has context")
        .add_argument("model_name", type=str, required=True, location="args", help="Model name")
    )
    @api.response(
        200, "Prompt templates retrieved successfully", fields.List(fields.Raw(description="Prompt template data"))
    )
    @api.response(400, "Invalid request parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        parser = (
            reqparse.RequestParser()
            .add_argument("app_mode", type=str, required=True, location="args")
            .add_argument("model_mode", type=str, required=True, location="args")
            .add_argument("has_context", type=str, required=False, default="true", location="args")
            .add_argument("model_name", type=str, required=True, location="args")
        )
        args = parser.parse_args()

        return AdvancedPromptTemplateService.get_prompt(args)
