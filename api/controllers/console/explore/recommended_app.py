from typing import Any
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, computed_field, field_validator

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.explore.error import RecommendedAppNotFoundError
from controllers.console.wraps import account_initialization_required, model_validate, with_current_user
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import build_icon_url, dump_response
from libs.login import login_required
from models import Account
from services.recommended_app_query_service import RecommendedAppNotFoundError as RecommendedAppQueryNotFoundError


class RecommendedAppsQuery(BaseModel):
    language: str | None = Field(default=None, description="Language code for recommended app localization")


class RecommendedAppInfoResponse(ResponseModel):
    id: str
    name: str | None = None
    mode: str | None = None
    icon: str | None = None
    icon_type: str | None = None
    icon_background: str | None = None

    @staticmethod
    def _normalize_enum_like(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(getattr(value, "value", value))

    @field_validator("mode", "icon_type", mode="before")
    @classmethod
    def _normalize_enum_fields(cls, value: Any) -> str | None:
        return cls._normalize_enum_like(value)

    @computed_field(return_type=str | None)  # type: ignore[prop-decorator]
    @property
    def icon_url(self) -> str | None:
        return build_icon_url(self.icon_type, self.icon)


class RecommendedAppResponse(ResponseModel):
    app: RecommendedAppInfoResponse | None = None
    app_id: str
    description: str | None = None
    copyright: str | None = None
    privacy_policy: str | None = None
    custom_disclaimer: str | None = None
    categories: list[str] = Field(default_factory=list)
    position: int | None = None
    is_listed: bool | None = None
    can_trial: bool


class RecommendedAppListResponse(ResponseModel):
    recommended_apps: list[RecommendedAppResponse]
    categories: list[str]


class LearnDifyAppListResponse(ResponseModel):
    recommended_apps: list[RecommendedAppResponse]


class RecommendedAppDetailResponse(ResponseModel):
    id: str
    name: str
    icon: str | None = None
    icon_background: str | None = None
    mode: str
    export_data: str
    can_trial: bool


register_schema_models(
    console_ns,
    RecommendedAppsQuery,
)
register_response_schema_models(
    console_ns,
    RecommendedAppInfoResponse,
    RecommendedAppResponse,
    RecommendedAppListResponse,
    LearnDifyAppListResponse,
    RecommendedAppDetailResponse,
)


@console_ns.route("/explore/apps")
class RecommendedAppListApi(Resource):
    @console_ns.doc(params=query_params_from_model(RecommendedAppsQuery))
    @console_ns.response(200, "Success", console_ns.models[RecommendedAppListResponse.__name__])
    @login_required
    @account_initialization_required
    @with_current_user
    @model_validate(RecommendedAppsQuery)
    def get(self, req_data: RecommendedAppsQuery, current_user: Account):
        return dump_response(
            RecommendedAppListResponse,
            application_services().recommended_app_queries.list_recommended(
                requested_language=req_data.language,
                interface_language=current_user.interface_language,
            ),
        )


@console_ns.route("/explore/apps/learn-dify")
class LearnDifyAppListApi(Resource):
    @console_ns.doc(params=query_params_from_model(RecommendedAppsQuery))
    @console_ns.response(200, "Success", console_ns.models[LearnDifyAppListResponse.__name__])
    @login_required
    @account_initialization_required
    @with_current_user
    @model_validate(RecommendedAppsQuery)
    def get(self, req_data: RecommendedAppsQuery, current_user: Account):
        return dump_response(
            LearnDifyAppListResponse,
            application_services().recommended_app_queries.list_learn_dify(
                requested_language=req_data.language,
                interface_language=current_user.interface_language,
            ),
        )


@console_ns.route("/explore/apps/<uuid:app_id>")
class RecommendedAppApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[RecommendedAppDetailResponse.__name__])
    @console_ns.response(404, "Recommended app not found")
    @login_required
    @account_initialization_required
    def get(self, app_id: UUID):
        try:
            result = application_services().recommended_app_queries.get_detail(str(app_id))
        except RecommendedAppQueryNotFoundError:
            raise RecommendedAppNotFoundError() from None
        return dump_response(RecommendedAppDetailResponse, result)
