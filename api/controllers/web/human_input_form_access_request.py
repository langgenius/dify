"""Public web Human Input v2 form stubs.

The hyphenated v2 routes are intentionally separate from the legacy underscored
Human Input form routes. Each runtime path must reject tokens owned by the other
version when the service implementation is added.
"""

from __future__ import annotations

from http import HTTPStatus

from flask import abort
from flask_restx import Resource

from controllers.common.human_input_v2_contracts import (
    FormAccessRequestResponse,
    FormDefinitionResponse,
    FormSubmitResponse,
    FormUploadTokenResponse,
    HumanInputV2FormSubmitRequest,
)
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.web import web_ns

register_schema_models(web_ns, HumanInputV2FormSubmitRequest)
register_response_schema_models(
    web_ns,
    FormAccessRequestResponse,
    FormDefinitionResponse,
    FormSubmitResponse,
    FormUploadTokenResponse,
)


def _raise_stub_not_implemented() -> None:
    abort(HTTPStatus.NOT_IMPLEMENTED, "Human Input v2 form stub endpoint is not implemented yet.")


@web_ns.route("/form/human-input/<string:form_token>")
class HumanInputV2FormApi(Resource):
    """Read or submit a Human Input v2 form without sharing v1 submission logic."""

    @web_ns.response(200, "Success", web_ns.models[FormDefinitionResponse.__name__])
    def get(self, form_token: str):
        _raise_stub_not_implemented()

    @web_ns.expect(web_ns.models[HumanInputV2FormSubmitRequest.__name__])
    @web_ns.response(200, "Success", web_ns.models[FormSubmitResponse.__name__])
    def post(self, form_token: str):
        HumanInputV2FormSubmitRequest.model_validate(web_ns.payload or {})
        _raise_stub_not_implemented()


@web_ns.route("/form/human-input/<string:form_token>/upload-token")
class HumanInputV2FormUploadTokenApi(Resource):
    """Issue an upload token for an active Human Input v2 form."""

    @web_ns.response(200, "Success", web_ns.models[FormUploadTokenResponse.__name__])
    def post(self, form_token: str):
        _raise_stub_not_implemented()


@web_ns.route("/form/human-input/<string:form_token>/access-request")
class FormAccessRequestApi(Resource):
    @web_ns.response(200, "Success", web_ns.models[FormAccessRequestResponse.__name__])
    def post(self, form_token: str):
        _raise_stub_not_implemented()
