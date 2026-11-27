"""API tool providers — OpenAPI-schema-backed custom tool providers of a workspace."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from http import HTTPStatus
from typing import Final

from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Effect, Example, Kind, endpoint
from controllers.openapi._errors import ProviderNotFound
from controllers.openapi._models import (
    ApiToolProviderListQuery,
    ApiToolProviderListResponse,
    ApiToolProviderPayload,
    ApiToolProviderResponse,
    ApiToolProviderRow,
    ToolEmojiIcon,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import ADMIN_ROLES, WORKSPACE_READ_GUARDS, workspace_write_guards
from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.errors import ApiToolProviderNotFoundError
from services.tools.api_tools_manage_service import ApiToolManageService

_COLLECTION: Final = "/workspaces/<string:workspace_id>/api-tool-providers"
_ITEM: Final = f"{_COLLECTION}/<string:provider_name>"

_MANAGE: Final = workspace_write_guards(RBACPermission.TOOL_MANAGE, roles=ADMIN_ROLES)


@contextmanager
def _api_tool_errors() -> Generator[None]:
    """Map service errors to OpenAPI errors: a missing provider answers 404, every other
    service `ValueError` (duplicate names, invalid schemas or credentials) answers 400."""
    try:
        yield
    except ApiToolProviderNotFoundError as error:
        raise ProviderNotFound(str(error)) from error
    except ValueError as error:
        raise BadRequest(str(error)) from error


def _require_provider(workspace_id: str, provider_name: str) -> None:
    """Raise ProviderNotFound when `provider_name` names no API tool provider of the workspace."""
    if all(provider.name != provider_name for provider in ApiToolManageService.list_api_tools(workspace_id)):
        raise ProviderNotFound(f"you have not added provider {provider_name}")


def _describe(ctx: Context, provider_name: str) -> ApiToolProviderResponse:
    _require_provider(ctx.workspace.id, provider_name)
    with _api_tool_errors():
        provider = ApiToolManageService.get_api_tool_provider(ctx.account.id, ctx.workspace.id, provider_name)
    return ApiToolProviderResponse(
        name=provider_name,
        icon=ToolEmojiIcon.model_validate(provider["icon"]),
        schema_type=provider["schema_type"],
        schema_=provider["schema"],
        credentials=dict(provider["credentials"]),
        privacy_policy=provider["privacy_policy"],
        custom_disclaimer=provider["custom_disclaimer"],
        labels=list(provider["labels"]),
        tools=[tool["operation_id"] or "default_tool" for tool in provider["tools"]],
        description=provider["description"],
    )


def _row(provider: ToolProviderApiEntity) -> ApiToolProviderRow:
    return ApiToolProviderRow(
        name=provider.name,
        icon=dict(provider.icon) if isinstance(provider.icon, dict) else provider.icon,
        description=provider.description.en_US or None,
        labels=list(provider.labels),
        tools=[tool.name for tool in provider.tools],
    )


@openapi_ns.route(_COLLECTION)
class ApiToolProvidersApi(Resource):
    @endpoint(
        op="get.api_tool_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.LIST,
        summary="API tool providers of the workspace",
        examples=(Example(title="List API tool providers", input={"page": 1, "limit": 20}),),
        requirements=WORKSPACE_READ_GUARDS,
        query=ApiToolProviderListQuery,
        returns=(HTTPStatus.OK, ApiToolProviderListResponse, "API tool providers"),
    )
    def get(self, ctx: Context, workspace_id: str, *, query: ApiToolProviderListQuery):
        """List the workspace's API tool providers, one page at a time.

        Every entry carries the provider name, icon, description, labels, and
        the names of the tools its schema defines — never credential values.
        """
        rows = [_row(provider) for provider in ApiToolManageService.list_api_tools(ctx.workspace.id)]
        return ApiToolProviderListResponse.page_of(rows, query=query)

    @endpoint(
        op="create.api_tool_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Add an API tool provider",
        examples=(
            Example(
                title="A weather API",
                input={
                    "name": "weather",
                    "icon": {"background": "#252525", "content": "\U0001f324"},
                    "credentials": {"auth_type": "none"},
                    "schema_type": "openapi",
                    "schema": "<openapi schema>",
                },
            ),
        ),
        requirements=_MANAGE,
        body=ApiToolProviderPayload,
        returns=(HTTPStatus.CREATED, ApiToolProviderResponse, "Provider created"),
    )
    def post(self, ctx: Context, workspace_id: str, *, body: ApiToolProviderPayload):
        """Add an API tool provider.

        `schema` is an OpenAPI schema of `schema_type` that defines the
        provider's tools; `credentials` configures how calls authenticate.
        Answers 400 for a duplicate name, an invalid schema, or invalid
        credentials. The response masks credential values.
        """
        with _api_tool_errors():
            ApiToolManageService.create_api_tool_provider(
                ctx.account.id,
                ctx.workspace.id,
                body.name,
                body.icon.model_dump(mode="json"),
                body.credentials,
                body.schema_type,
                body.schema_,
                body.privacy_policy or "",
                body.custom_disclaimer or "",
                body.labels or [],
            )
        return _describe(ctx, body.name), HTTPStatus.CREATED


@openapi_ns.route(_ITEM)
class ApiToolProviderApi(Resource):
    @endpoint(
        op="describe.api_tool_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="One API tool provider",
        examples=(Example(title="The weather provider", input={"provider_name": "weather"}),),
        requirements=WORKSPACE_READ_GUARDS,
        returns=(HTTPStatus.OK, ApiToolProviderResponse, "API tool provider"),
    )
    def get(self, ctx: Context, workspace_id: str, provider_name: str):
        """Read one API tool provider.

        `credentials` echoes back with secret values masked. Answers 404 when
        `provider_name` names no provider.
        """
        return _describe(ctx, provider_name)

    @endpoint(
        op="set.api_tool_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Replace an API tool provider",
        examples=(
            Example(
                title="Replace the weather provider",
                input={
                    "provider_name": "weather",
                    "name": "weather-v2",
                    "icon": {"background": "#252525", "content": "\U0001f324"},
                    "credentials": {"auth_type": "none"},
                    "schema_type": "openapi",
                    "schema": "<openapi schema>",
                },
            ),
        ),
        requirements=_MANAGE,
        body=ApiToolProviderPayload,
        returns=(HTTPStatus.OK, ApiToolProviderResponse, "Provider replaced"),
    )
    def put(self, ctx: Context, workspace_id: str, provider_name: str, *, body: ApiToolProviderPayload):
        """Replace an API tool provider.

        Full replace: the stored icon, schema, credentials, disclaimer, and
        labels become the request's. A body `name` different from
        `provider_name` renames the provider. Answers 404 when `provider_name`
        names no provider and 400 for invalid input.
        """
        with _api_tool_errors():
            ApiToolManageService.update_api_tool_provider(
                ctx.account.id,
                ctx.workspace.id,
                body.name,
                provider_name,
                body.icon.model_dump(mode="json"),
                body.credentials,
                body.schema_type,
                body.schema_,
                body.privacy_policy,
                body.custom_disclaimer or "",
                body.labels or [],
            )
        return _describe(ctx, body.name)

    @endpoint(
        op="delete.api_tool_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Delete an API tool provider",
        examples=(Example(title="Remove the weather provider", input={"provider_name": "weather"}),),
        requirements=_MANAGE,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Provider deleted"),
    )
    def delete(self, ctx: Context, workspace_id: str, provider_name: str):
        """Delete an API tool provider.

        Apps that used the provider's tools lose them; the credential is gone
        for good. Answers 404 when `provider_name` names no provider.
        """
        _require_provider(ctx.workspace.id, provider_name)
        with _api_tool_errors():
            ApiToolManageService.delete_api_tool_provider(ctx.account.id, ctx.workspace.id, provider_name)
        return SimpleResultResponse(result="success")
