from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import NotFound, Unauthorized

from constants import HEADER_NAME_APP_CODE
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.web import web_ns
from controllers.web.error import WebAppAuthRequiredError
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.token import extract_webapp_access_token
from services.entities.passport_entities import WebPassportRequest
from services.web_passport_service import (
    WebPassportAuthenticationRequiredError,
    WebPassportNotFoundError,
    WebPassportUnauthorizedError,
)


class PassportQuery(BaseModel):
    user_id: str | None = Field(default=None, description="End user session ID")


register_schema_models(web_ns, PassportQuery)


class PassportAccessTokenResponse(ResponseModel):
    access_token: str


register_response_schema_models(web_ns, PassportAccessTokenResponse)


@web_ns.route("/passport")
class PassportResource(Resource):
    """Issue an authentication passport for a deployed web application."""

    @web_ns.doc("get_passport")
    @web_ns.doc(description="Get authentication passport for web application access")
    @web_ns.doc(params=query_params_from_model(PassportQuery))
    @web_ns.doc(
        responses={
            200: "Passport retrieved successfully",
            401: "Unauthorized - missing app code or invalid authentication",
            404: "Application or user not found",
        }
    )
    @web_ns.response(200, "Passport retrieved successfully", web_ns.models[PassportAccessTokenResponse.__name__])
    def get(self):
        app_code = request.headers.get(HEADER_NAME_APP_CODE)
        if app_code is None:
            raise Unauthorized("X-App-Code header is missing.")

        query = PassportQuery.model_validate(request.args.to_dict(flat=True))
        passport_request = WebPassportRequest(
            app_code=app_code,
            user_session_id=query.user_id,
            access_token=extract_webapp_access_token(request),
        )
        try:
            result = application_services().web_passport.issue(passport_request)
        except WebPassportAuthenticationRequiredError as exc:
            raise WebAppAuthRequiredError(str(exc)) from exc
        except WebPassportUnauthorizedError as exc:
            raise Unauthorized(str(exc)) from exc
        except WebPassportNotFoundError as exc:
            raise NotFound(str(exc) or None) from exc

        return dump_response(PassportAccessTokenResponse, {"access_token": result.access_token})
