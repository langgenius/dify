from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field, computed_field, field_validator

from constants.languages import languages
from controllers.common.schema import query_params_from_model, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required
from fields.base import ResponseModel
from libs.helper import build_icon_url
from libs.login import current_user, login_required
from services.recommended_app_service import RecommendedAppService


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
    can_trial: bool | None = None


class RecommendedAppListResponse(ResponseModel):
    recommended_apps: list[RecommendedAppResponse]
    categories: list[str]


register_schema_models(
    console_ns,
    RecommendedAppsQuery,
    RecommendedAppInfoResponse,
    RecommendedAppResponse,
    RecommendedAppListResponse,
)


@console_ns.route("/explore/apps")
class RecommendedAppListApi(Resource):
    @console_ns.doc(params=query_params_from_model(RecommendedAppsQuery))
    @console_ns.response(200, "Success", console_ns.models[RecommendedAppListResponse.__name__])
    @login_required
    @account_initialization_required
    def get(self):
        # language args
        args = RecommendedAppsQuery.model_validate(request.args.to_dict(flat=True))
        language = args.language
        if language and language in languages:
            language_prefix = language
        elif current_user and current_user.interface_language:
            language_prefix = current_user.interface_language
        else:
            language_prefix = languages[0]

        return RecommendedAppListResponse.model_validate(
            RecommendedAppService.get_recommended_apps_and_categories(language_prefix),
            from_attributes=True,
        ).model_dump(mode="json")


@console_ns.route("/explore/apps/<uuid:app_id>")
class RecommendedAppApi(Resource):
    @login_required
    @account_initialization_required
    def get(self, app_id):
        app_id = str(app_id)
        return RecommendedAppService.get_recommend_app_detail(app_id)
