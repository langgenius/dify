from typing import Any
from uuid import UUID

from flask import send_file
from flask_restx import Resource
from pydantic import BaseModel, Field, computed_field, field_validator

from controllers.common.fields import BinaryFileResponse
from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.explore.error import RecommendedAppNotFoundError
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import model_validate
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.flask_restx_compat import BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY
from libs.helper import build_icon_url, dump_response
from machinery.context import RequestContext
from services.recommended_app_query_service import RecommendedAppNotFoundError as RecommendedAppQueryNotFoundError


class RecommendedAppsQuery(BaseModel):
    language: str = Field(default="en-US", description="Language code for recommended app localization")


class RecommendedAgentPackageQuery(BaseModel):
    version_id: UUID = Field(description="Published snapshot from the template download link")


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
    package_url: str | None = Field(default=None, description="Download URL for a New Agent .ifpkg template")
    version_id: str | None = Field(default=None, description="Published version for direct local template creation")


register_schema_models(
    console_ns,
    RecommendedAppsQuery,
    RecommendedAgentPackageQuery,
)
register_response_schema_models(
    console_ns,
    RecommendedAppInfoResponse,
    RecommendedAppResponse,
    RecommendedAppListResponse,
    LearnDifyAppListResponse,
    RecommendedAppDetailResponse,
    BinaryFileResponse,
)


@console_ns.route("/explore/apps")
class RecommendedAppListApi(Resource):
    @console_ns.doc(params=query_params_from_model(RecommendedAppsQuery))
    @console_ns.response(200, "Success", console_ns.models[RecommendedAppListResponse.__name__])
    @console_account_admission()
    @model_validate(RecommendedAppsQuery)
    def get(self, req_data: RecommendedAppsQuery, _request_context: RequestContext):
        return dump_response(
            RecommendedAppListResponse,
            application_services().recommended_app_queries.list_recommended(
                language=req_data.language,
            ),
        )


@console_ns.route("/explore/apps/learn-dify")
class LearnDifyAppListApi(Resource):
    @console_ns.doc(params=query_params_from_model(RecommendedAppsQuery))
    @console_ns.response(200, "Success", console_ns.models[LearnDifyAppListResponse.__name__])
    @console_account_admission()
    @model_validate(RecommendedAppsQuery)
    def get(self, req_data: RecommendedAppsQuery, _request_context: RequestContext):
        return dump_response(
            LearnDifyAppListResponse,
            application_services().recommended_app_queries.list_learn_dify(
                language=req_data.language,
            ),
        )


@console_ns.route("/explore/apps/<uuid:app_id>")
class RecommendedAppApi(Resource):
    @console_ns.response(200, "Success", console_ns.models[RecommendedAppDetailResponse.__name__])
    @console_ns.response(404, "Recommended app not found")
    @console_account_admission()
    def get(self, _request_context: RequestContext, app_id: UUID):
        try:
            result = application_services().recommended_app_queries.get_detail(str(app_id))
        except RecommendedAppQueryNotFoundError:
            raise RecommendedAppNotFoundError() from None
        return dump_response(RecommendedAppDetailResponse, result)


@console_ns.route("/trial-apps/<uuid:app_id>/package")
class RecommendedAgentPackageApi(Resource):
    @console_ns.doc(params=query_params_from_model(RecommendedAgentPackageQuery))
    @console_ns.doc(produces=["application/zip"], vendor={BINARY_RESPONSE_MEDIA_TYPES_VENDOR_KEY: ["application/zip"]})
    @console_ns.response(200, "Published Agent template package", console_ns.models[BinaryFileResponse.__name__])
    @console_ns.response(404, "Published template unavailable")
    @model_validate(RecommendedAgentPackageQuery)
    def get(self, query: RecommendedAgentPackageQuery, app_id: UUID):
        # Package URLs are fetched without browser credentials. Public catalog membership
        # and the current published version are rechecked for every download.
        try:
            exported = application_services().recommended_app_packages.download(
                app_id=str(app_id), version_id=query.version_id
            )
        except RecommendedAppQueryNotFoundError:
            raise RecommendedAppNotFoundError() from None
        try:
            response = send_file(
                exported.archive, mimetype="application/zip", as_attachment=True, download_name=exported.filename
            )
        except Exception:
            exported.close()
            raise
        response.headers["Cache-Control"] = "no-store"
        response.call_on_close(exported.close)
        return response
