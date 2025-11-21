"""
Web App Human Input Form APIs.
"""

import logging

from flask import Response
from flask_restx import reqparse

from controllers.web import web_ns
from controllers.web.error import NotFoundError
from controllers.web.wraps import WebApiResource
from extensions.ext_database import db
from models.human_input import RecipientType
from models.model import App, EndUser
from services.human_input_service import Form, FormNotFoundError, HumanInputService

logger = logging.getLogger(__name__)


def _jsonify_form_definition(form: Form) -> Response:
    """Return the Pydantic definition as a JSON response."""
    return Response(form.get_definition().model_dump_json(), mimetype="application/json")


@web_ns.route("/form/human_input/<string:web_app_form_token>")
class HumanInputFormApi(WebApiResource):
    """API for getting and submitting human input forms via the web app."""

    def get(self, _app_model: App, _end_user: EndUser, web_app_form_token: str):
        """
        Get human input form definition by token.

        GET /api/form/human_input/<web_app_form_token>
        """
        service = HumanInputService(db.engine)
        try:
            form = service.get_form_definition_by_token(RecipientType.WEBAPP, web_app_form_token)
        except FormNotFoundError:
            raise NotFoundError("Form not found")

        if form is None:
            raise NotFoundError("Form not found")

        return _jsonify_form_definition(form)

    def post(self, _app_model: App, _end_user: EndUser, web_app_form_token: str):
        """
        Submit human input form by token.

        POST /api/form/human_input/<web_app_form_token>

        Request body:
        {
            "inputs": {
                "content": "User input content"
            },
            "action": "Approve"
        }
        """
        parser = reqparse.RequestParser()
        parser.add_argument("inputs", type=dict, required=True, location="json")
        parser.add_argument("action", type=str, required=True, location="json")
        args = parser.parse_args()

        service = HumanInputService(db.engine)
        try:
            service.submit_form_by_token(
                recipient_type=RecipientType.WEBAPP,
                form_token=web_app_form_token,
                selected_action_id=args["action"],
                form_data=args["inputs"],
                submission_end_user_id=_end_user.id,
            )
        except FormNotFoundError:
            raise NotFoundError("Form not found")

        return {}, 200
