"""Tool provider credentials (API key) and the tools a workspace can use. OAuth credentials need the console."""

from __future__ import annotations

from collections.abc import Callable, Generator, Iterable, Sequence
from contextlib import contextmanager
from http import HTTPStatus
from typing import Final

from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._errors import CredentialInvalid, CredentialNotFound, CredentialOAuthOnly, ProviderNotFound
from controllers.openapi._i18n import localized
from controllers.openapi._models import (
    CredentialFormField,
    CredentialRef,
    CredentialWriteResponse,
    Hint,
    ToolCredentialCreatePayload,
    ToolCredentialUpdatePayload,
    ToolInputValue,
    ToolListQuery,
    ToolListResponse,
    ToolNodeTemplate,
    ToolParameterRow,
    ToolProviderDetailResponse,
    ToolRow,
    ToolSource,
)
from controllers.openapi._search import matches
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import admin_write, workspace_read
from core.db.session_factory import session_factory
from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.__base.tool import ToolParameter
from core.tools.entities.api_entities import ToolApiEntity, ToolProviderApiEntity
from core.tools.errors import ToolProviderCredentialValidationError, ToolProviderNotFoundError
from core.tools.tool_manager import ToolManager
from extensions.ext_application_services import application_services
from services.tools.api_tools_manage_service import ApiToolManageService
from services.tools.builtin_tools_manage_service import BuiltinToolManageService
from services.tools.mcp_tools_manage_service import MCPToolManageService
from services.tools.workflow_tools_manage_service import WorkflowToolManageService

_READ: Final = workspace_read()
_PROVIDER_EXAMPLE: Final = "langgenius/tavily/tavily"
_PROVIDER_PATH: Final = "/workspaces/<string:workspace_id>/tool-providers/<path:provider>"


def _form_fields(schemas: Sequence[ProviderConfig], language: str | None) -> list[CredentialFormField]:
    """A tool provider's API-key form, cut to what a caller needs. Tool forms have no show_on rules."""
    return [
        CredentialFormField(
            name=field.name,
            type=str(field.type),
            required=field.required,
            label=localized(field.label.model_dump(), language) if field.label else None,
            placeholder=localized(field.placeholder.model_dump(), language) if field.placeholder else None,
            options=[option.value for option in field.options] if field.options else None,
            show_on=[],
        )
        for field in schemas
    ]


@contextmanager
def _provider_errors() -> Generator[None, None, None]:
    try:
        yield
    except ToolProviderNotFoundError as error:
        raise ProviderNotFound(str(error)) from error


@contextmanager
def _credential_errors() -> Generator[None, None, None]:
    try:
        yield
    except ValueError as error:
        # The service rewraps every failure as a bare ValueError; the original is its __context__.
        if isinstance(error.__context__, ToolProviderCredentialValidationError):
            raise CredentialInvalid(str(error)) from error
        raise BadRequest(str(error)) from error


def _controller(workspace_id: str, provider: str):
    with _provider_errors():
        return ToolManager.get_builtin_provider(provider, workspace_id)


def _api_key_supported(controller) -> bool:
    return CredentialType.API_KEY in controller.get_supported_credential_types()


def _credentials(ctx: Context, provider: str):
    with _provider_errors():
        return BuiltinToolManageService.get_builtin_tool_provider_credentials(
            tenant_id=ctx.workspace.id,
            provider_name=provider,
            user=ctx.account,
            credential_query=application_services().credential_queries,
        )


def _visible_credential(ctx: Context, provider: str, credential_id: str):
    for credential in _credentials(ctx, provider):
        if credential.id == credential_id:
            return credential
    raise CredentialNotFound()


def _write_response(ctx: Context, provider: str, credential_id: str) -> CredentialWriteResponse:
    credential = _visible_credential(ctx, provider, credential_id)
    return CredentialWriteResponse(id=credential.id, name=credential.name, active=credential.is_default)


def _mcp_providers(ctx: Context) -> list[ToolProviderApiEntity]:
    with session_factory.create_session() as session:
        return MCPToolManageService(session=session).list_providers(tenant_id=ctx.workspace.id, include_sensitive=False)


_TOOL_SOURCES: Final[dict[ToolSource, Callable[[Context], list[ToolProviderApiEntity]]]] = {
    ToolSource.BUILTIN: lambda ctx: BuiltinToolManageService.list_builtin_tools(ctx.account.id, ctx.workspace.id),
    ToolSource.WORKFLOW: lambda ctx: WorkflowToolManageService.list_tenant_workflow_tools(
        ctx.account.id, ctx.workspace.id
    ),
    ToolSource.API: lambda ctx: ApiToolManageService.list_api_tools(ctx.workspace.id),
    ToolSource.MCP: _mcp_providers,
}


def _inputs(parameters: Sequence[ToolParameter], form: ToolParameter.ToolParameterForm) -> dict[str, ToolInputValue]:
    return {p.name: ToolInputValue(value=p.default) for p in parameters if p.form == form}


def _parameter_row(parameter: ToolParameter, language: str | None) -> ToolParameterRow:
    return ToolParameterRow(
        name=parameter.name,
        label=localized(parameter.label.model_dump(), language),
        type=str(parameter.type),
        form=str(parameter.form),
        required=parameter.required,
        default=parameter.default,
        options=[option.value for option in parameter.options],
        min=parameter.min,
        max=parameter.max,
        llm_description=parameter.llm_description,
    )


def tool_row(provider: ToolProviderApiEntity, tool: ToolApiEntity, language: str | None) -> ToolRow:
    parameters = tool.parameters or []
    label = localized(tool.label.model_dump(), language) or tool.name
    return ToolRow(
        provider=provider.id,
        provider_type=str(provider.type),
        provider_label=localized(provider.label.model_dump(), language),
        configured=provider.is_team_authorization,
        name=tool.name,
        label=label,
        description=localized(tool.description.model_dump(), language),
        parameters=[_parameter_row(p, language) for p in parameters],
        node_data=ToolNodeTemplate(
            title=label,
            provider_type=str(provider.type),
            provider_id=provider.server_identifier or provider.id,
            provider_name=provider.name,
            plugin_id=provider.plugin_id or None,
            plugin_unique_identifier=provider.plugin_unique_identifier or None,
            tool_name=tool.name,
            tool_label=label,
            tool_parameters=_inputs(parameters, ToolParameter.ToolParameterForm.LLM),
            tool_configurations=_inputs(parameters, ToolParameter.ToolParameterForm.FORM),
        ),
    )


def tool_rows(
    providers: Iterable[ToolProviderApiEntity], *, words: str, provider: str | None, language: str | None
) -> list[ToolRow]:
    rows = [tool_row(p, tool, language) for p in providers if provider is None or p.id == provider for tool in p.tools]
    rows = [r for r in rows if matches(words, r.name, r.label, r.provider, r.provider_label)]
    return sorted(rows, key=lambda r: (r.provider, r.name))


@openapi_ns.route("/workspaces/<string:workspace_id>/tools")
class ToolsApi(Resource):
    @endpoint(
        op="get.tool",
        kind=Kind.LIST,
        summary="Tools a workflow can call here, each with a ready tool node data",
        examples=(
            Example(title="Find GitHub tools", input={"query": "github"}),
            Example(title="Workflows published as tools", input={"provider_type": "workflow"}),
        ),
        requirements=_READ,
        query=ToolListQuery,
        returns=(HTTPStatus.OK, ToolListResponse, "Tools"),
    )
    def get(self, ctx: Context, workspace_id: str, *, query: ToolListQuery):
        sources = [query.provider_type] if query.provider_type else list(ToolSource)
        providers = [p for source in sources for p in _TOOL_SOURCES[source](ctx)]
        rows = tool_rows(providers, words=query.query, provider=query.provider, language=ctx.account.interface_language)
        page = ToolListResponse.page_of(rows, query=query)
        unready = sorted({r.provider for r in page.data if not r.configured and r.provider_type == ToolSource.BUILTIN})
        page.hints = [
            Hint(
                summary="Set up this provider to use its tools",
                op=op_of(ToolProviderApi.get),
                input={"workspace_id": ctx.workspace.id, "provider": provider},
            )
            for provider in unready
        ]
        return page


@openapi_ns.route(_PROVIDER_PATH)
class ToolProviderApi(Resource):
    @endpoint(
        op="describe.tool_provider",
        kind=Kind.OBJECT,
        summary="One tool provider with its API-key form and saved credentials (names only)",
        examples=(Example(title="Tavily", input={"provider": _PROVIDER_EXAMPLE}),),
        requirements=_READ,
        returns=(HTTPStatus.OK, ToolProviderDetailResponse, "Tool provider"),
    )
    def get(self, ctx: Context, workspace_id: str, provider: str):
        controller = _controller(ctx.workspace.id, provider)
        language = ctx.account.interface_language
        api_key = _api_key_supported(controller)
        form = (
            _form_fields(controller.get_credentials_schema_by_type(CredentialType.API_KEY), language) if api_key else []
        )
        saved = _credentials(ctx, provider)
        configured = (
            not controller.need_credentials
            or BuiltinToolManageService.get_builtin_provider(provider, ctx.workspace.id) is not None
        )
        default = next((c for c in saved if c.is_default), None)
        hints = (
            [
                Hint(
                    summary="Ask the user for these values, then save them",
                    op=op_of(ToolProviderCredentialsApi.post),
                    input={"workspace_id": ctx.workspace.id, "provider": provider, "credentials": None},
                    form=[field.model_dump() for field in form],
                )
            ]
            if api_key and form and not configured
            else []
        )
        hints.append(
            Hint(
                summary="List its tools",
                op=op_of(ToolsApi.get),
                input={"workspace_id": ctx.workspace.id, "provider": provider},
            )
        )
        return ToolProviderDetailResponse(
            provider=provider,
            label=localized(controller.entity.identity.label.model_dump(), language),
            configured=configured,
            credential_types=[str(t) for t in controller.get_supported_credential_types()],
            credential_form=form,
            credentials=[CredentialRef(id=c.id, name=c.name) for c in saved],
            default_credential=CredentialRef(id=default.id, name=default.name) if default else None,
            hints=hints,
        )


@openapi_ns.route(f"{_PROVIDER_PATH}/credentials")
class ToolProviderCredentialsApi(Resource):
    @endpoint(
        op="create.tool_provider.credential",
        kind=Kind.OBJECT,
        summary="Save an API-key credential for a tool provider; the provider checks it first",
        examples=(
            Example(
                title="Save a Tavily key (pass credentials with @-)",
                input={"provider": _PROVIDER_EXAMPLE, "credentials": {"tavily_api_key": "<from the user>"}},
            ),
        ),
        requirements=admin_write(RBACPermission.CREDENTIAL_CREATE),
        body=ToolCredentialCreatePayload,
        returns=(HTTPStatus.CREATED, CredentialWriteResponse, "Credential saved"),
    )
    def post(self, ctx: Context, workspace_id: str, provider: str, *, body: ToolCredentialCreatePayload):
        if not _api_key_supported(_controller(ctx.workspace.id, provider)):
            raise CredentialOAuthOnly()
        with _credential_errors():
            result = BuiltinToolManageService.add_builtin_tool_provider(
                user_id=ctx.account.id,
                api_type=CredentialType.API_KEY,
                tenant_id=ctx.workspace.id,
                provider=provider,
                credentials=body.credentials,
                name=body.name,
            )
        return _write_response(ctx, provider, result["id"]), HTTPStatus.CREATED


@openapi_ns.route(f"{_PROVIDER_PATH}/credentials/<string:credential_id>")
class ToolProviderCredentialApi(Resource):
    @endpoint(
        op="set.tool_provider.credential",
        kind=Kind.OBJECT,
        summary="Replace a saved tool provider credential",
        examples=(
            Example(
                title="Rotate the key",
                input={
                    "provider": _PROVIDER_EXAMPLE,
                    "credential_id": "<credential_id>",
                    "credentials": {"tavily_api_key": "<from the user>"},
                },
            ),
        ),
        requirements=admin_write(RBACPermission.CREDENTIAL_MANAGE),
        body=ToolCredentialUpdatePayload,
        returns=(HTTPStatus.OK, CredentialWriteResponse, "Credential replaced"),
    )
    def patch(
        self, ctx: Context, workspace_id: str, provider: str, credential_id: str, *, body: ToolCredentialUpdatePayload
    ):
        if _visible_credential(ctx, provider, credential_id).credential_type != CredentialType.API_KEY:
            raise CredentialOAuthOnly()
        with _credential_errors():
            BuiltinToolManageService.update_builtin_tool_provider(
                user_id=ctx.account.id,
                tenant_id=ctx.workspace.id,
                provider=provider,
                credential_id=credential_id,
                credentials=body.credentials,
                name=body.name,
            )
        return _write_response(ctx, provider, credential_id)
