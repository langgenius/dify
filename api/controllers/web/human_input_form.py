"""
Web App Human Input Form APIs.
"""

import logging

from flask import jsonify
from flask_restful import reqparse

from controllers.web import api
from controllers.web.error import (
    NotFoundError,
)
from controllers.web.wraps import WebApiResource
from extensions.ext_database import db
from models.human_input import HumanInputSubmissionType

logger = logging.getLogger(__name__)


class HumanInputFormApi(WebApiResource):
    """API for getting human input form definition."""

    def get(self, web_app_form_token: str):
        """
        Get human input form definition by token.

        GET /api/form/human_input/<web_app_form_token>
        """
        try:
            service = HumanInputFormService(db.session())
            form_definition = service.get_form_definition(
                identifier=web_app_form_token, is_token=True, include_site_info=True
            )
            return form_definition, 200

        except HumanInputFormNotFoundError:
            raise NotFoundError("Form not found")
        except HumanInputFormExpiredError:
            return jsonify(
                {"error_code": "human_input_form_expired", "description": "Human input form has expired"}
            ), 400
        except HumanInputFormAlreadySubmittedError:
            return jsonify(
                {
                    "error_code": "human_input_form_submitted",
                    "description": "Human input form has already been submitted",
                }
            ), 400


class HumanInputFormSubmissionApi(WebApiResource):
    """API for submitting human input forms."""

    def post(self, web_app_form_token: str):
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

        try:
            # Submit the form
            service = HumanInputFormService(db.session())
            service.submit_form(
                identifier=web_app_form_token,
                form_data=args["inputs"],
                action=args["action"],
                is_token=True,
                submission_type=HumanInputSubmissionType.web_app,
            )

            return {}, 200

        except HumanInputFormNotFoundError:
            raise NotFoundError("Form not found")
        except HumanInputFormExpiredError:
            return jsonify(
                {"error_code": "human_input_form_expired", "description": "Human input form has expired"}
            ), 400
        except HumanInputFormAlreadySubmittedError:
            return jsonify(
                {
                    "error_code": "human_input_form_submitted",
                    "description": "Human input form has already been submitted",
                }
            ), 400
        except InvalidFormDataError as e:
            return jsonify({"error_code": "invalid_form_data", "description": e.message}), 400


# Register the APIs
api.add_resource(HumanInputFormApi, "/form/human_input/<string:web_app_form_token>")
api.add_resource(HumanInputFormSubmissionApi, "/form/human_input/<string:web_app_form_token>", methods=["POST"])
