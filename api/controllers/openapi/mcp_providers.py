"""MCP providers — remote MCP servers a workspace calls tools from."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from http import HTTPStatus
from typing import Final

from flask_restx import Resource
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint
from controllers.openapi._errors import ProviderNotFound
from controllers.openapi._models import McpProviderPayload, McpProviderResponse
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import WORKSPACE_READ_GUARDS, workspace_write_guards
from core.db.session_factory import session_factory
from core.entities.mcp_provider import IdentityMode, MCPConfiguration
from services.tools.mcp_tools_manage_service import MCPToolManageService
from services.tools.tools_transform_service import ToolTransformService

logger = logging.getLogger(__name__)

_COLLECTION: Final = "/workspaces/<string:workspace_id>/mcp-providers"
_ITEM: Final = f"{_COLLECTION}/<string:provider_id>"

# The console gates MCP writes on MCP_MANAGE alone, with no workspace-role gate.
_MANAGE: Final = workspace_write_guards(RBACPermission.MCP_MANAGE, roles=None)


@contextmanager
def _mcp_errors() -> Generator[None]:
    """Every service `ValueError` answers 400; missing providers are caught
    earlier by `_require_provider` and answer 404."""
    try:
        yield
    except ValueError as error:
        raise BadRequest(str(error)) from error


def _service(session: Session) -> MCPToolManageService:
    return MCPToolManageService(session=session)


def _session() -> Session:
    return session_factory.create_session()


def _require_provider(session: Session, tenant_id: str, provider_id: str) -> None:
    """Raise ProviderNotFound when `provider_id` names no provider of the workspace.

    A malformed `provider_id` — anything `uuid.UUID` rejects — also answers
    404: it names no provider.
    """
    try:
        uuid.UUID(provider_id)
    except (AttributeError, TypeError, ValueError) as error:
        raise ProviderNotFound(f"expected a valid UUID, but got: {provider_id}") from error
    providers = _service(session).list_providers(tenant_id=tenant_id, include_sensitive=False)
    if all(provider.id != provider_id for provider in providers):
        raise ProviderNotFound("MCP tool not found")


def _describe(tenant_id: str, provider_id: str) -> McpProviderResponse:
    """Project one stored provider into the response with secrets masked.

    Raises ProviderNotFound when `provider_id` names no provider of the
    workspace.
    """
    with _session() as session:
        service = _service(session)
        _require_provider(session, tenant_id, provider_id)
        provider = service.get_provider_by_id(provider_id=provider_id, tenant_id=tenant_id)
        entity = ToolTransformService.mcp_provider_to_user_provider(provider)
    return McpProviderResponse(
        id=entity.id,
        name=entity.name,
        icon=dict(entity.icon) if isinstance(entity.icon, dict) else entity.icon,
        server_url=entity.server_url,
        server_identifier=entity.server_identifier,
        masked_headers=entity.masked_headers,
        authentication=entity.authentication,
        is_team_authorization=entity.is_team_authorization,
        is_dynamic_registration=entity.is_dynamic_registration,
        configuration=entity.configuration,
        identity_mode=entity.identity_mode,
        updated_at=entity.updated_at,
        tools=[tool.name for tool in entity.tools],
    )


@openapi_ns.route(_COLLECTION)
class McpProvidersApi(Resource):
    @endpoint(
        op="create.mcp_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Add an MCP provider",
        examples=(
            Example(
                title="A fetch server",
                input={
                    "server_url": "https://mcp.example.com/sse",
                    "name": "fetch",
                    "icon": "\U0001f310",
                    "icon_type": "emoji",
                    "server_identifier": "fetch",
                },
            ),
        ),
        requirements=_MANAGE,
        body=McpProviderPayload,
        returns=(HTTPStatus.CREATED, McpProviderResponse, "Provider created"),
    )
    def post(self, ctx: Context, workspace_id: str, *, body: McpProviderPayload):
        """Add an MCP provider.

        The provider is saved with user-identity forwarding off, then the API
        makes a best-effort connection to fetch the server's tools; a server
        that cannot be reached yet still answers 201, just without tools.
        Answers 400 for an invalid URL or a duplicate name, identifier, or
        server URL.
        """
        configuration = body.configuration or MCPConfiguration()
        with _session() as session, _mcp_errors():
            result = _service(session).create_provider(
                tenant_id=ctx.workspace.id,
                user_id=ctx.account.id,
                server_url=body.server_url,
                name=body.name,
                icon=body.icon,
                icon_type=body.icon_type,
                icon_background=body.icon_background,
                server_identifier=body.server_identifier,
                headers=body.headers or {},
                configuration=configuration,
                authentication=body.authentication,
                identity_mode=IdentityMode.OFF,
            )
            provider_id = result.id
            session.commit()

        # Best-effort tool fetch in a second, short transaction so the first
        # one holds no locks across network I/O.
        try:
            reconnect = MCPToolManageService.reconnect_with_url(
                server_url=body.server_url,
                headers=body.headers or {},
                timeout=configuration.timeout,
                sse_read_timeout=configuration.sse_read_timeout,
            )
            with _session() as session:
                provider = _service(session).get_provider_by_id(provider_id=provider_id, tenant_id=ctx.workspace.id)
                provider.authed = reconnect.authed
                provider.tools = reconnect.tools
                session.commit()
        except Exception:
            logger.warning("Failed to fetch MCP tools after creation", exc_info=True)

        return _describe(ctx.workspace.id, provider_id), HTTPStatus.CREATED


@openapi_ns.route(_ITEM)
class McpProviderApi(Resource):
    @endpoint(
        op="describe.mcp_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="One MCP provider",
        examples=(Example(title="The fetch provider", input={"provider_id": "<provider_id>"}),),
        requirements=WORKSPACE_READ_GUARDS,
        returns=(HTTPStatus.OK, McpProviderResponse, "MCP provider"),
    )
    def get(self, ctx: Context, workspace_id: str, provider_id: str):
        """Read one MCP provider.

        `server_url`, headers, and `authentication` echo back masked.
        `is_team_authorization` is true once the workspace authorized the
        provider through OAuth, which this API does not drive. Answers 404
        when `provider_id` names no provider.
        """
        return _describe(ctx.workspace.id, provider_id)

    @endpoint(
        op="set.mcp_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Replace an MCP provider",
        examples=(
            Example(
                title="Move the fetch provider",
                input={
                    "provider_id": "<provider_id>",
                    "server_url": "https://mcp2.example.com/sse",
                    "name": "fetch",
                    "icon": "\U0001f310",
                    "icon_type": "emoji",
                    "server_identifier": "fetch",
                },
            ),
        ),
        requirements=_MANAGE,
        body=McpProviderPayload,
        returns=(HTTPStatus.OK, McpProviderResponse, "Provider updated"),
    )
    def put(self, ctx: Context, workspace_id: str, provider_id: str, *, body: McpProviderPayload):
        """Replace an MCP provider.

        The request's URL is validated against the server before anything is
        stored; the provider keeps its existing identity-forwarding mode.
        Answers 404 when `provider_id` names no provider and 400 for an
        invalid URL or conflicting name, identifier, or server URL.
        """
        configuration = body.configuration or MCPConfiguration()

        with _session() as session, _mcp_errors():
            _require_provider(session, ctx.workspace.id, provider_id)
            validation_data = _service(session).get_provider_for_url_validation(
                tenant_id=ctx.workspace.id, provider_id=provider_id
            )

        with _mcp_errors():
            validation_result = MCPToolManageService.validate_server_url_standalone(
                tenant_id=ctx.workspace.id,
                new_server_url=body.server_url,
                validation_data=validation_data,
            )

        with _session() as session, _mcp_errors():
            service = _service(session)
            existing = service.get_provider_by_id(provider_id=provider_id, tenant_id=ctx.workspace.id)
            service.update_provider(
                tenant_id=ctx.workspace.id,
                provider_id=provider_id,
                server_url=body.server_url,
                name=body.name,
                icon=body.icon,
                icon_type=body.icon_type,
                icon_background=body.icon_background,
                server_identifier=body.server_identifier,
                headers=body.headers or {},
                configuration=configuration,
                authentication=body.authentication,
                validation_result=validation_result,
                identity_mode=IdentityMode(existing.identity_mode),
            )
            session.commit()

        return _describe(ctx.workspace.id, provider_id)

    @endpoint(
        op="delete.mcp_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Delete an MCP provider",
        examples=(Example(title="Remove the fetch provider", input={"provider_id": "<provider_id>"}),),
        requirements=_MANAGE,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Provider deleted"),
    )
    def delete(self, ctx: Context, workspace_id: str, provider_id: str):
        """Delete an MCP provider.

        Apps that used the provider's tools lose them. Answers 404 when
        `provider_id` names no provider.
        """
        with _session() as session, _mcp_errors():
            _require_provider(session, ctx.workspace.id, provider_id)
            _service(session).delete_provider(tenant_id=ctx.workspace.id, provider_id=provider_id)
            session.commit()
        return SimpleResultResponse(result="success")


@openapi_ns.route(f"{_ITEM}:refresh")
class McpProviderRefreshApi(Resource):
    @endpoint(
        op="refresh.mcp_provider",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Fetch the provider's tools again",
        examples=(Example(title="Refresh the fetch provider", input={"provider_id": "<provider_id>"}),),
        requirements=_MANAGE,
        returns=(HTTPStatus.OK, McpProviderResponse, "Provider refreshed"),
    )
    def post(self, ctx: Context, workspace_id: str, provider_id: str):
        """Fetch the provider's tools again from its server.

        Reconnects to the stored server URL and replaces the cached tool
        list; the response reports the result. Answers 404 when `provider_id`
        names no provider.
        """
        with _session() as session, _mcp_errors():
            _require_provider(session, ctx.workspace.id, provider_id)
            _service(session).list_provider_tools(
                tenant_id=ctx.workspace.id,
                provider_id=provider_id,
            )
            session.commit()
        return _describe(ctx.workspace.id, provider_id)
