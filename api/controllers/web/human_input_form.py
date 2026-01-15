"""
Web App Human Input Form APIs.
"""

import json
import logging

from flask import Response
from flask_restx import Resource, reqparse
from werkzeug.exceptions import Forbidden

from controllers.web import web_ns
from controllers.web.error import NotFoundError
from controllers.web.site import serialize_site
from extensions.ext_database import db
from models.account import TenantStatus
from models.human_input import RecipientType
from models.model import App, Site
from services.human_input_service import Form, FormNotFoundError, HumanInputService

logger = logging.getLogger(__name__)


def _jsonify_form_definition(form: Form, site_payload: dict | None = None) -> Response:
    """Return the Pydantic definition (optionally with site) as a JSON response."""
    payload = form.get_definition().model_dump()
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
        try:
            form = service.get_form_definition_by_token(RecipientType.STANDALONE_WEB_APP, form_token)
            if form is None:
                form = service.get_form_definition_by_token(RecipientType.BACKSTAGE, form_token)
        except FormNotFoundError:
            raise NotFoundError("Form not found")

        if form is None:
            raise NotFoundError("Form not found")

        site = _get_site_from_form(form)

        return _jsonify_form_definition(form, site_payload=serialize_site(site))

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
        if form is None or form.recipient_type not in {RecipientType.STANDALONE_WEB_APP, RecipientType.BACKSTAGE}:
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


def _get_site_from_form(form: Form) -> Site:
    """Resolve Site for the form's app and validate tenant status."""
    app_model = db.session.query(App).where(App.id == form.app_id).first()
    if app_model is None or app_model.tenant_id != form.tenant_id:
        raise NotFoundError("Form not found")

    site = db.session.query(Site).where(Site.app_id == app_model.id).first()
    if site is None:
        raise Forbidden()

    if app_model.tenant and app_model.tenant.status == TenantStatus.ARCHIVE:
        raise Forbidden()

    return site
