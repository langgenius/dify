from flask_restful import Resource, reqparse
from werkzeug.exceptions import NotFound

from controllers.console import api
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.prompt_template_service import PromptTemplateService


class PromptTemplateListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        templates = PromptTemplateService.get_prompt_templates()
        return {"data": [template.to_dict() for template in templates]}

    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, help="Name is required")
        parser.add_argument("mode", type=str, required=True, help="Mode is required")
        parser.add_argument("prompt_content", type=str, required=True, help="Prompt content is required.")
        parser.add_argument("description", type=str, required=False)
        parser.add_argument("tags", type=list, location="json")
        parser.add_argument("model_name", type=str, required=False, location="json")
        parser.add_argument("model_parameters", type=dict, required=False, location="json")
        args = parser.parse_args()

        template = PromptTemplateService.create_prompt_template(**args)
        return template.to_dict(), 201


api.add_resource(PromptTemplateListApi, "/prompt-templates")


class PromptTemplateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, template_id: str):
        """
        Get a single prompt template.
        """
        template = PromptTemplateService.get_prompt_template(template_id)
        return template.to_dict()

    @setup_required
    @login_required
    @account_initialization_required
    def put(self, template_id: str):
        """
        Update a prompt template.
        """
        parser = reqparse.RequestParser()
        parser.add_argument("name", type=str, required=True, help="Name is required")
        parser.add_argument("mode", type=str, required=True, help="Mode is required")
        parser.add_argument("prompt_content", type=str, required=True, help="Prompt content is required")
        parser.add_argument("description", type=str, required=False)
        parser.add_argument("tags", type=list, location="json")
        parser.add_argument("model_name", type=str, required=False, location="json")
        parser.add_argument("model_parameters", type=dict, required=False, location="json")
        args = parser.parse_args()

        template = PromptTemplateService.update_prompt_template(template_id=template_id, **args)
        return template.to_dict()

    @setup_required
    @login_required
    @account_initialization_required
    def delete(self, template_id: str):
        """
        Delete a prompt template.
        """
        try:
            PromptTemplateService.delete_prompt_template(template_id)
        except NotFound:
            # According to REST principles, DELETE should be idempotent.
            # If the resource is already gone, we can consider the operation successful.
            pass
        return "", 204


api.add_resource(PromptTemplateApi, "/prompt-templates/<uuid:template_id>")
