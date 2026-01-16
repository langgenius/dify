"""
Web App Human Input Form APIs.
"""

import json
import logging
from datetime import datetime

from flask import Response
from flask_restx import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.web import web_ns
from controllers.web.error import NotFoundError
from controllers.web.site import serialize_app_site_payload
from extensions.ext_database import db
from models.account import TenantStatus
from models.model import App, Site
from services.human_input_service import Form, FormNotFoundError, HumanInputService

logger = logging.getLogger(__name__)


def _stringify_placeholder_values(values: dict[str, object]) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in values.items():
        if value is None:
            result[key] = ""
        elif isinstance(value, (dict, list)):
            result[key] = json.dumps(value, ensure_ascii=False)
        else:
            result[key] = str(value)
    return result


def _to_timestamp(value: datetime) -> int:
    return int(value.timestamp())


def _jsonify_form_definition(form: Form, site_payload: dict | None = None) -> Response:
    """Return the form payload (optionally with site) as a JSON response."""
    definition_payload = form.get_definition().model_dump()
    payload = {
        "form_content": definition_payload["rendered_content"],
        "inputs": definition_payload["inputs"],
        "resolved_placeholder_values": _stringify_placeholder_values(definition_payload["placeholder_values"]),
        "user_actions": definition_payload["user_actions"],
        "expiration_time": _to_timestamp(form.expiration_time),
    }
    if site_payload is not None:
        payload["site"] = site_payload
    return Response(json.dumps(payload, ensure_ascii=False), mimetype="application/json")


# TODO(QuantumGhost): disable authorization for web app
# form api temporarily


@web_ns.route("/form/human_input/<string:form_token>")
# class HumanInputFormApi(WebApiResource):
class HumanInputFormApi(Resource):
    """API for getting and submitting human input forms via the web app."""

    # def get(self, _app_model: App, _end_user: EndUser, form_token: str):
    def get(self, form_token: str):
        """
        Get human input form definition by token.

        GET /api/form/human_input/<form_token>
        """
        service = HumanInputService(db.engine)
        # TODO(QuantumGhost): forbid submision for form tokens
        # that are only for console.
        form = service.get_form_by_token(form_token)

        if form is None:
            raise NotFoundError("Form not found")

        service._ensure_not_submitted(form)
        app_model, site = _get_app_site_from_form(form)

        return _jsonify_form_definition(form, site_payload=serialize_app_site_payload(app_model, site, None))

    # def post(self, _app_model: App, _end_user: EndUser, form_token: str):
    def post(self, form_token: str):
        """
        Submit human input form by token.

        POST /api/form/human_input/<form_token>

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
        form = service.get_form_by_token(form_token)
        if form is None:
            raise NotFoundError("Form not found")

        try:
            service.submit_form_by_token(
                recipient_type=form.recipient_type,
                form_token=form_token,
                selected_action_id=args["action"],
                form_data=args["inputs"],
                submission_end_user_id=None,
                # submission_end_user_id=_end_user.id,
            )
        except FormNotFoundError:
            raise NotFoundError("Form not found")

        return {}, 200


def _get_app_site_from_form(form: Form) -> tuple[App, Site]:
    """Resolve App/Site for the form's app and validate tenant status."""
    app_model = db.session.query(App).where(App.id == form.app_id).first()
    if app_model is None or app_model.tenant_id != form.tenant_id:
        raise NotFoundError("Form not found")

    site = db.session.query(Site).where(Site.app_id == app_model.id).first()
    if site is None:
        raise Forbidden()

    if app_model.tenant and app_model.tenant.status == TenantStatus.ARCHIVE:
        raise Forbidden()

    return app_model, site
