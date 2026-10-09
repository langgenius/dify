"""Tool provider credentials (API key) and the tools a workspace can use. OAuth credentials need the console."""

from __future__ import annotations

from collections.abc import Generator, Sequence
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
    ToolProviderDetailResponse,
)
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import admin_write, workspace_read
from core.entities.provider_entities import ProviderConfig
from core.plugin.entities.plugin_daemon import CredentialType
from core.tools.errors import ToolProviderCredentialValidationError, ToolProviderNotFoundError
from core.tools.tool_manager import ToolManager
from extensions.ext_application_services import application_services
from services.tools.builtin_tools_manage_service import BuiltinToolManageService

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

    @endpoint(
        op="delete.tool_provider.credential",
        kind=Kind.OBJECT,
        summary="Delete a saved tool provider credential",
        examples=(Example(title="Delete", input={"provider": _PROVIDER_EXAMPLE, "credential_id": "<credential_id>"}),),
        requirements=admin_write(RBACPermission.CREDENTIAL_MANAGE),
        returns=(HTTPStatus.OK, CredentialRef, "Credential deleted"),
    )
    def delete(self, ctx: Context, workspace_id: str, provider: str, credential_id: str):
        credential = _visible_credential(ctx, provider, credential_id)
        try:
            BuiltinToolManageService.delete_builtin_tool_provider(ctx.workspace.id, provider, credential_id)
        except ValueError as error:
            raise BadRequest(str(error)) from error
        return CredentialRef(id=credential_id, name=credential.name)
