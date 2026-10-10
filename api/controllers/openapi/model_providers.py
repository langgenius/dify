"""Model providers in one workspace: what is set up, their credential forms, credentials, models and defaults."""

from __future__ import annotations

from collections.abc import Generator, Iterable, Sequence
from contextlib import contextmanager
from http import HTTPStatus
from typing import Any, Final

from flask_restx import Resource
from werkzeug.exceptions import BadRequest

from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Example, Kind, endpoint, op_of
from controllers.openapi._errors import CredentialInvalid, ProviderNotFound
from controllers.openapi._i18n import localized
from controllers.openapi._models import (
    CredentialFormField,
    CredentialRef,
    CredentialWriteResponse,
    CustomModelRow,
    Hint,
    LlmModelBlock,
    ModelCredentialCreatePayload,
    ModelCredentialUpdatePayload,
    ModelListQuery,
    ModelListResponse,
    ModelProviderDetailResponse,
    ModelRef,
    ModelRow,
    ProviderCredentialCreatePayload,
    ProviderCredentialUpdatePayload,
)
from controllers.openapi._search import matches
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import ADMIN_ROLES, WORKSPACE_READ_GUARDS, workspace_write_guards
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity
from core.entities.provider_entities import CustomModelConfiguration
from extensions.ext_application_services import application_services
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import CredentialFormSchema
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from services.entities.model_provider_entities import CustomConfigurationStatus, ProviderResponse
from services.errors.app_model_config import ProviderNotFoundError
from services.model_provider.service import ModelProviderService

_CREATE: Final = workspace_write_guards(RBACPermission.CREDENTIAL_CREATE, roles=ADMIN_ROLES)
_MANAGE: Final = workspace_write_guards(RBACPermission.CREDENTIAL_MANAGE, roles=ADMIN_ROLES)

_PROVIDER_EXAMPLE: Final = "langgenius/openai/openai"
_OLLAMA_EXAMPLE: Final = "langgenius/ollama/ollama"
_PROVIDER_PATH: Final = "/workspaces/<string:workspace_id>/model-providers/<path:provider>"


@contextmanager
def _model_provider_errors() -> Generator[None, None, None]:
    """Maps what the model provider service raises for a credential write or a provider lookup."""
    try:
        yield
    except ProviderNotFoundError as error:
        raise ProviderNotFound(str(error)) from error
    except CredentialsValidateFailedError as error:
        raise CredentialInvalid(str(error)) from error
    except ValueError as error:
        raise BadRequest(str(error)) from error


def _form(schemas: Sequence[CredentialFormSchema], language: str | None) -> list[CredentialFormField]:
    return [
        CredentialFormField.of(
            name=field.variable,
            type=field.type,
            required=field.required,
            label=field.label,
            placeholder=field.placeholder,
            options=field.options,
            show_on=field.show_on,
            language=language,
        )
        for field in schemas
    ]


def _provider(workspace_id: str, provider: str) -> ProviderResponse:
    with _model_provider_errors():
        return ModelProviderService().get_provider(workspace_id, provider)


def _active(response: ProviderResponse) -> CredentialRef | None:
    config = response.custom_configuration
    if not config.current_credential_id:
        return None
    return CredentialRef(id=config.current_credential_id, name=config.current_credential_name)


def _row(response: ProviderResponse, language: str | None) -> dict[str, Any]:
    return {
        "provider": response.provider,
        "label": localized(response.label, language),
        "model_types": [str(model_type) for model_type in response.supported_model_types],
        "configured": response.custom_configuration.status == CustomConfigurationStatus.ACTIVE,
        "active_credential": _active(response),
    }


def _custom_model(response: ProviderResponse, ref: ModelRef) -> CustomModelConfiguration | None:
    for custom in response.custom_configuration.custom_models or []:
        if custom.model == ref.model and custom.model_type == ref.model_type:
            return custom
    return None


def _provider_write_response(
    workspace_id: str, response: ProviderResponse, credential_id: str
) -> CredentialWriteResponse:
    configuration = response.custom_configuration
    names = {c.credential_id: c.credential_name for c in configuration.available_credentials or []}
    active = configuration.current_credential_id == credential_id
    hints: list[Hint] = []
    if active:
        hints.append(
            Hint(
                summary="Pick a model for your nodes",
                op=op_of(ModelsApi.get),
                input={"workspace_id": workspace_id, "provider": response.provider},
            )
        )
    elif configuration.current_credential_id:
        hints.append(
            Hint(
                summary="Another credential is active; replace its values to use these",
                op=op_of(ModelProviderCredentialApi.patch),
                input={
                    "workspace_id": workspace_id,
                    "provider": response.provider,
                    "credential_id": configuration.current_credential_id,
                    "credentials": None,
                },
            )
        )
    return CredentialWriteResponse(id=credential_id, name=names.get(credential_id), active=active, hints=hints)


def _model_write_response(
    workspace_id: str, response: ProviderResponse, ref: ModelRef, credential_id: str
) -> CredentialWriteResponse:
    custom = _custom_model(response, ref)
    names = {c.credential_id: c.credential_name for c in (custom.available_model_credentials if custom else [])}
    active = custom is not None and custom.current_credential_id == credential_id
    hints = (
        [
            Hint(
                summary="Another credential is active for the model; replace its values to use these",
                op=op_of(ModelCredentialApi.patch),
                input={
                    "workspace_id": workspace_id,
                    "provider": response.provider,
                    "credential_id": custom.current_credential_id,
                    "model": ref.model,
                    "model_type": ref.model_type.value,
                    "credentials": None,
                },
            )
        ]
        if custom is not None and custom.current_credential_id and not active
        else []
    )
    return CredentialWriteResponse(id=credential_id, name=names.get(credential_id), active=active, hints=hints)


def model_rows(models: Iterable[ModelWithProviderEntity], *, words: str, language: str | None) -> list[ModelRow]:
    rows = []
    for m in models:
        if m.deprecated:
            continue
        row = ModelRow(
            provider=m.provider.provider,
            provider_label=localized(m.provider.label, language),
            model=m.model,
            model_type=str(m.model_type),
            label=localized(m.label, language),
            status=str(m.status),
            features=[str(f) for f in m.features or []],
            node_model=LlmModelBlock(provider=m.provider.provider, name=m.model, mode=str(mode))
            if m.model_type == ModelType.LLM and (mode := m.model_properties.get(ModelPropertyKey.MODE))
            else None,
        )
        if matches(words, row.model, row.label, row.provider, row.provider_label):
            rows.append(row)
    return rows


@openapi_ns.route(_PROVIDER_PATH)
class ModelProviderApi(Resource):
    @endpoint(
        op="describe.model_provider",
        kind=Kind.OBJECT,
        summary="One model provider with its credential form and saved credentials (names only)",
        examples=(Example(title="OpenAI", input={"provider": _PROVIDER_EXAMPLE}),),
        requirements=WORKSPACE_READ_GUARDS,
        returns=(HTTPStatus.OK, ModelProviderDetailResponse, "Model provider"),
    )
    def get(self, ctx: Context, workspace_id: str, provider: str):
        response = _provider(ctx.workspace.id, provider)
        language = ctx.account.interface_language
        form = _form(
            response.provider_credential_schema.credential_form_schemas if response.provider_credential_schema else [],
            language,
        )
        credentials = [
            CredentialRef(id=c.credential_id, name=c.credential_name)
            for c in ModelProviderService().get_provider_available_credentials(
                ctx.workspace.id, provider, ctx.account, credential_query=application_services().credential_queries
            )
        ]
        model_schema = response.model_credential_schema
        hints = (
            []
            if credentials or not form
            else [
                Hint(
                    summary="Ask the user for these values, then save them",
                    op=op_of(ModelProviderCredentialsApi.post),
                    input={"workspace_id": ctx.workspace.id, "provider": provider, "credentials": None},
                    form=[field.model_dump() for field in form],
                )
            ]
        )
        hints.append(
            Hint(
                summary="List its models",
                op=op_of(ModelsApi.get),
                input={"workspace_id": ctx.workspace.id, "provider": provider},
            )
        )
        return ModelProviderDetailResponse(
            **_row(response, language),
            credential_form=form,
            credentials=credentials,
            custom_model_form=_form(model_schema.credential_form_schemas, language) if model_schema else None,
            custom_models=[
                CustomModelRow(
                    model=custom.model,
                    model_type=str(custom.model_type),
                    active_credential=CredentialRef(
                        id=custom.current_credential_id, name=custom.current_credential_name
                    )
                    if custom.current_credential_id
                    else None,
                )
                for custom in response.custom_configuration.custom_models or []
            ],
            hints=hints,
        )


@openapi_ns.route(f"{_PROVIDER_PATH}/credentials")
class ModelProviderCredentialsApi(Resource):
    @endpoint(
        op="create.model_provider.credential",
        kind=Kind.OBJECT,
        summary="Save a credential for a model provider; the provider checks it first",
        examples=(
            Example(
                title="Save an OpenAI key (pass credentials with @-)",
                input={"provider": _PROVIDER_EXAMPLE, "credentials": {"openai_api_key": "<from the user>"}},
            ),
        ),
        requirements=_CREATE,
        body=ProviderCredentialCreatePayload,
        returns=(HTTPStatus.CREATED, CredentialWriteResponse, "Credential saved"),
    )
    def post(self, ctx: Context, workspace_id: str, provider: str, *, body: ProviderCredentialCreatePayload):
        with _model_provider_errors():
            credential_id = ModelProviderService().create_provider_credential(
                tenant_id=ctx.workspace.id, provider=provider, credentials=body.credentials, credential_name=body.name
            )
        response = _provider(ctx.workspace.id, provider)
        return _provider_write_response(ctx.workspace.id, response, credential_id), HTTPStatus.CREATED


@openapi_ns.route(f"{_PROVIDER_PATH}/credentials/<string:credential_id>")
class ModelProviderCredentialApi(Resource):
    @endpoint(
        op="set.model_provider.credential",
        kind=Kind.OBJECT,
        summary="Replace a saved model provider credential",
        examples=(
            Example(
                title="Rotate the key",
                input={
                    "provider": _PROVIDER_EXAMPLE,
                    "credential_id": "<credential_id>",
                    "credentials": {"openai_api_key": "<from the user>"},
                },
            ),
        ),
        requirements=_MANAGE,
        body=ProviderCredentialUpdatePayload,
        returns=(HTTPStatus.OK, CredentialWriteResponse, "Credential replaced"),
    )
    def patch(
        self,
        ctx: Context,
        workspace_id: str,
        provider: str,
        credential_id: str,
        *,
        body: ProviderCredentialUpdatePayload,
    ):
        with _model_provider_errors():
            ModelProviderService().update_provider_credential(
                tenant_id=ctx.workspace.id,
                provider=provider,
                credentials=body.credentials,
                credential_id=credential_id,
                credential_name=body.name,
            )
        return _provider_write_response(ctx.workspace.id, _provider(ctx.workspace.id, provider), credential_id)


@openapi_ns.route("/workspaces/<string:workspace_id>/models")
class ModelsApi(Resource):
    @endpoint(
        op="get.model",
        kind=Kind.LIST,
        summary="Models in the workspace across providers, with whether each can be used now",
        examples=(
            Example(title="LLMs", input={"model_type": "llm"}),
            Example(title="OpenAI models", input={"provider": _PROVIDER_EXAMPLE}),
        ),
        requirements=WORKSPACE_READ_GUARDS,
        query=ModelListQuery,
        returns=(HTTPStatus.OK, ModelListResponse, "Models"),
    )
    def get(self, ctx: Context, workspace_id: str, *, query: ModelListQuery):
        models = ModelProviderService().list_models(
            ctx.workspace.id, provider=query.provider, model_type=query.model_type
        )
        rows = model_rows(models, words=query.query, language=ctx.account.interface_language)
        page = ModelListResponse.page_of(rows, query=query)
        unready = sorted({row.provider for row in page.data if row.status != ModelStatus.ACTIVE})
        page.hints = [
            Hint(
                summary="Set up this provider to use its models",
                op=op_of(ModelProviderApi.get),
                input={"workspace_id": ctx.workspace.id, "provider": provider},
            )
            for provider in unready
        ]
        return page


@openapi_ns.route(f"{_PROVIDER_PATH}/models/credentials")
class ModelCredentialsApi(Resource):
    @endpoint(
        op="create.model.credential",
        kind=Kind.OBJECT,
        summary="Save a credential for one model you name, for providers such as OpenAI-compatible or Ollama; "
        "it becomes the model's active credential when the model has none",
        examples=(
            Example(
                title="A self-hosted model",
                input={
                    "provider": _OLLAMA_EXAMPLE,
                    "model": "llama3",
                    "model_type": "llm",
                    "credentials": {"base_url": "http://ollama:11434"},
                },
            ),
        ),
        requirements=_CREATE,
        body=ModelCredentialCreatePayload,
        returns=(HTTPStatus.CREATED, CredentialWriteResponse, "Credential saved"),
    )
    def post(self, ctx: Context, workspace_id: str, provider: str, *, body: ModelCredentialCreatePayload):
        service = ModelProviderService()
        with _model_provider_errors():
            credential_id = service.create_model_credential(
                tenant_id=ctx.workspace.id,
                provider=provider,
                model_type=body.model_type.value,
                model=body.model,
                credentials=body.credentials,
                credential_name=body.name,
            )
            service.activate_model_credential_if_none(
                ctx.workspace.id, provider, body.model_type.value, body.model, credential_id
            )
        response = _provider(ctx.workspace.id, provider)
        return _model_write_response(ctx.workspace.id, response, body, credential_id), HTTPStatus.CREATED


@openapi_ns.route(f"{_PROVIDER_PATH}/models/credentials/<string:credential_id>")
class ModelCredentialApi(Resource):
    @endpoint(
        op="set.model.credential",
        kind=Kind.OBJECT,
        summary="Replace a saved credential of one model",
        examples=(
            Example(
                title="Rotate",
                input={
                    "provider": _OLLAMA_EXAMPLE,
                    "credential_id": "<credential_id>",
                    "model": "llama3",
                    "model_type": "llm",
                    "credentials": {"base_url": "http://ollama:11434"},
                },
            ),
        ),
        requirements=_MANAGE,
        body=ModelCredentialUpdatePayload,
        returns=(HTTPStatus.OK, CredentialWriteResponse, "Credential replaced"),
    )
    def patch(
        self, ctx: Context, workspace_id: str, provider: str, credential_id: str, *, body: ModelCredentialUpdatePayload
    ):
        with _model_provider_errors():
            ModelProviderService().update_model_credential(
                tenant_id=ctx.workspace.id,
                provider=provider,
                model_type=body.model_type.value,
                model=body.model,
                credentials=body.credentials,
                credential_id=credential_id,
                credential_name=body.name,
            )
        return _model_write_response(ctx.workspace.id, _provider(ctx.workspace.id, provider), body, credential_id)
