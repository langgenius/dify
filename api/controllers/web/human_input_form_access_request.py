"""Public web Human Input v2 access-request stub."""

from __future__ import annotations

from http import HTTPStatus

from flask import abort
from flask_restx import Resource

from controllers.common.human_input_v2_contracts import FormAccessRequestResponse
from controllers.common.schema import register_response_schema_models
from controllers.web import web_ns

register_response_schema_models(web_ns, FormAccessRequestResponse)


@web_ns.route("/form/human-input/<string:form_token>/access-request")
class FormAccessRequestApi(Resource):
    @web_ns.response(200, "Success", web_ns.models[FormAccessRequestResponse.__name__])
    def post(self, form_token: str):
        abort(HTTPStatus.NOT_IMPLEMENTED, "Human Input v2 access-request stub endpoint is not implemented yet.")
