"""Inner API endpoints for the enterprise admin app list and app detail.

Called by the enterprise admin-api service. The list covers Studio-visible apps
across all workspaces with a summary of their built-in environment; enterprise
joins its own environments, deployment status, and invocation metrics onto it by
app id. The detail adds what only CE owns: the built-in environment's published
version, access points, and invocations.
"""

from dataclasses import asdict
from datetime import datetime
from http import HTTPStatus
from typing import Literal
from uuid import UUID

from flask_restx import Resource
from pydantic import BaseModel, Field, ValidationError, field_validator
from werkzeug.exceptions import BadRequest

from controllers.common.fields import SimpleMessageResponse
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
)
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response, to_timestamp
from models.model import AppMode
from services.app.enterprise_app_service import EnterpriseAppListParams

EnterpriseAppListMode = Literal["completion", "workflow", "chat", "advanced-chat", "agent-chat", "agent"]
APP_LIST_QUERY_ARRAY_FIELDS = ("workspace_ids", "modes")


class EnterpriseAppListQuery(BaseModel):
    page: int = Field(default=1, ge=1, le=99999, description="Page number (1-99999)")
    limit: int = Field(default=20, ge=1, le=100, description="Page size (1-100)")
    workspace_ids: list[UUID] = Field(default_factory=list, description="Filter by workspace IDs (repeatable)")
    modes: list[EnterpriseAppListMode] = Field(default_factory=list, description="Filter by app modes (repeatable)")
    name: str | None = Field(default=None, max_length=255, description="Filter by app name substring")
    sort_by: Literal["created_at", "name"] = Field(default="created_at", description="Sort field")
    sort_order: Literal["asc", "desc"] = Field(default="desc", description="Sort direction")

    @field_validator("name", mode="before")
    @classmethod
    def blank_name_as_none(cls, value: object) -> object:
        return value.strip() or None if isinstance(value, str) else value


class EnterpriseAppCreatorResponse(ResponseModel):
    id: str
    name: str
    email: str


class EnterpriseAppResponse(ResponseModel):
    id: str
    name: str
    description: str
    mode: str
    icon_type: str | None
    icon: str | None
    icon_background: str | None
    workspace_id: str
    workspace_name: str | None
    created_by: EnterpriseAppCreatorResponse | None
    created_at: int
    updated_at: int

    @field_validator("created_at", "updated_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int) -> int:
        return to_timestamp(value)


_INVOCATION_COUNT_DESCRIPTION = (
    "Built-in invocations in the last 24h: published workflow runs (app-run, webhook, schedule, plugin) for "
    "workflow and advanced-chat apps, non-debugger messages for other apps"
)


class EnterpriseAppBuiltInSummaryResponse(ResponseModel):
    published: bool = Field(description="Whether the app detail reports a built-in published_version")
    invocation_count_24h: int = Field(validation_alias="invocation_count", description=_INVOCATION_COUNT_DESCRIPTION)


class EnterpriseAppListItemResponse(EnterpriseAppResponse):
    built_in: EnterpriseAppBuiltInSummaryResponse


class EnterpriseAppPaginationResponse(ResponseModel):
    page: int
    limit: int
    total: int
    has_more: bool
    data: list[EnterpriseAppListItemResponse]


class EnterpriseAppPublishedVersionResponse(ResponseModel):
    id: str
    version: str | None = Field(description="Workflow version string; null for Agent config snapshots")
    version_number: int | None = Field(
        description="The #N shown in Studio version history; null for unnumbered legacy workflows"
    )
    marked_name: str | None = Field(description="Workflow version name; null for Agent config snapshots")
    marked_comment: str | None = Field(description="Workflow version comment or Agent snapshot version note")
    created_by: EnterpriseAppCreatorResponse | None
    published_at: int

    @field_validator("published_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int) -> int:
        return to_timestamp(value)


class EnterpriseAppSiteResponse(ResponseModel):
    enabled: bool
    code: str | None
    app_base_url: str | None


class EnterpriseAppApiResponse(ResponseModel):
    enabled: bool
    base_url: str | None
    api_key_count: int


class EnterpriseAppMCPServerResponse(ResponseModel):
    status: str
    server_code: str


class EnterpriseAppTriggerResponse(ResponseModel):
    id: str
    node_id: str | None
    title: str
    trigger_type: str
    provider_name: str | None
    status: str
    webhook_url: str | None


class EnterpriseAppBuiltInResponse(ResponseModel):
    published_version: EnterpriseAppPublishedVersionResponse | None = Field(
        description=(
            "Version the built-in environment serves; null when unpublished, when an Agent App draft has "
            "unpublished changes, and always for chat, completion, and agent-chat apps"
        )
    )
    published_version_count: int = Field(
        description="Number of entries in the app's Studio version history; 0 for apps without versions"
    )
    site: EnterpriseAppSiteResponse
    api: EnterpriseAppApiResponse
    mcp_server: EnterpriseAppMCPServerResponse | None
    triggers: list[EnterpriseAppTriggerResponse]
    last_invoked_at: int | None = Field(
        description="Latest invocation counted like invocation_count_24h, without the 24h limit"
    )
    invocation_count_24h: int = Field(validation_alias="invocation_count", description=_INVOCATION_COUNT_DESCRIPTION)
    failed_invocation_count_24h: int = Field(
        validation_alias="failed_invocation_count",
        description=(
            "Invocations counted in invocation_count_24h that ended failed or partial-succeeded (workflow runs) "
            "or in error (messages); running and stopped runs are not failures"
        ),
    )

    @field_validator("last_invoked_at", mode="before")
    @classmethod
    def _normalize_timestamp(cls, value: datetime | int | None) -> int | None:
        return to_timestamp(value)


class EnterpriseAppDetailResponse(EnterpriseAppResponse):
    built_in: EnterpriseAppBuiltInResponse


register_response_schema_models(inner_api_ns, EnterpriseAppPaginationResponse, EnterpriseAppDetailResponse)


@inner_api_ns.route("/enterprise/apps")
class EnterpriseAppList(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc(
        "enterprise_app_list",
        params=query_params_from_model(EnterpriseAppListQuery),
        responses={HTTPStatus.BAD_REQUEST: "Invalid query parameters"},
    )
    @inner_api_ns.response(HTTPStatus.OK, "Success", inner_api_ns.models[EnterpriseAppPaginationResponse.__name__])
    def get(self):
        """List Studio-visible apps across all workspaces."""
        try:
            query = query_params_from_request(EnterpriseAppListQuery, list_fields=APP_LIST_QUERY_ARRAY_FIELDS)
        except ValidationError as exc:
            raise BadRequest(str(exc)) from exc

        result = application_services().apps.enterprise.list_apps(
            EnterpriseAppListParams(
                page=query.page,
                limit=query.limit,
                workspace_ids=[str(workspace_id) for workspace_id in query.workspace_ids],
                modes=[AppMode(mode) for mode in query.modes],
                name=query.name,
                sort_by=query.sort_by,
                sort_order=query.sort_order,
            )
        )
        return dump_response(
            EnterpriseAppPaginationResponse,
            {
                "page": result.page,
                "limit": result.per_page,
                "total": result.total,
                "has_more": result.has_next,
                "data": [{**asdict(item.app), "built_in": item.built_in} for item in result.items],
            },
        )


@inner_api_ns.route("/enterprise/apps/<uuid:app_id>")
class EnterpriseAppDetail(Resource):
    @setup_required
    @enterprise_inner_api_only
    @inner_api_ns.doc("enterprise_app_detail", responses={HTTPStatus.NOT_FOUND: "App not found"})
    @inner_api_ns.response(HTTPStatus.OK, "Success", inner_api_ns.models[EnterpriseAppDetailResponse.__name__])
    def get(self, app_id: UUID):
        """Get a Studio-visible app with its built-in environment state."""
        detail = application_services().apps.enterprise.get_app(str(app_id))
        if detail is None:
            return dump_response(SimpleMessageResponse, {"message": "app not found"}), HTTPStatus.NOT_FOUND

        return dump_response(
            EnterpriseAppDetailResponse,
            {**asdict(detail.app), "built_in": detail.built_in},
        )
