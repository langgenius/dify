"""Model providers in one workspace: what is set up, their credential forms, credentials, models and defaults."""

from __future__ import annotations

from collections.abc import Generator, Iterable, Sequence
from contextlib import contextmanager
from http import HTTPStatus
from typing import Any, Final

from flask_restx import Resource
from werkzeug.exceptions import BadRequest, UnprocessableEntity

from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Effect, Example, Kind, endpoint, op_of
from controllers.openapi._errors import CredentialInvalid, CredentialNotFound, ModelNotFound, ProviderNotFound
from controllers.openapi._i18n import localized
from controllers.openapi._models import (
    CredentialFormField,
    CredentialRef,
    CredentialWriteResponse,
    CustomModelRow,
    DefaultModelPayload,
    DefaultModelResponse,
    Hint,
    LlmModelBlock,
    LoadBalancingEntry,
    LoadBalancingEntryPayload,
    LoadBalancingSettings,
    ModelCredentialCreatePayload,
    ModelCredentialUpdatePayload,
    ModelListQuery,
    ModelListResponse,
    ModelProviderDetailResponse,
    ModelRef,
    ModelRefQuery,
    ModelRow,
    ModelSettingsPutPayload,
    ModelSettingsQuery,
    ModelSettingsResponse,
    ProviderCredentialCreatePayload,
    ProviderCredentialUpdatePayload,
)
from controllers.openapi._search import matches
from controllers.openapi.auth.context import Context
from controllers.openapi.auth.requirements import ADMIN_ROLES, WORKSPACE_READ_GUARDS, workspace_write_guards
from core.entities.model_entities import ModelStatus, ModelWithProviderEntity
from core.entities.provider_configuration import ProviderConfiguration
from core.entities.provider_entities import CustomModelConfiguration
from core.plugin.impl.model_runtime_factory import create_plugin_provider_manager
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from graphon.model_runtime.entities.model_entities import ModelPropertyKey, ModelType
from graphon.model_runtime.entities.provider_entities import CredentialFormSchema
from graphon.model_runtime.errors.validate import CredentialsValidateFailedError
from services.entities.model_provider_entities import CustomConfigurationStatus, ProviderResponse
from services.errors.app_model_config import ProviderNotFoundError
from services.model_load_balancing_service import LoadBalancingConfigSummaryDict, ModelLoadBalancingService
from services.model_provider.service import ModelProviderService

_CREATE: Final = workspace_write_guards(RBACPermission.CREDENTIAL_CREATE, roles=ADMIN_ROLES)
_MANAGE: Final = workspace_write_guards(RBACPermission.CREDENTIAL_MANAGE, roles=ADMIN_ROLES)
_USE: Final = workspace_write_guards(RBACPermission.CREDENTIAL_USE, roles=ADMIN_ROLES)
_MODEL_CONFIG: Final = workspace_write_guards(RBACPermission.PLUGIN_MODEL_CONFIG, roles=ADMIN_ROLES)

_PROVIDER_EXAMPLE: Final = "langgenius/openai/openai"
_OLLAMA_EXAMPLE: Final = "langgenius/ollama/ollama"
_PROVIDER_PATH: Final = "/workspaces/<string:workspace_id>/model-providers/<path:provider>"


@contextmanager
def _model_provider_errors() -> Generator[None]:
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


def _configured(response: ProviderResponse) -> bool:
    return response.custom_configuration.status == CustomConfigurationStatus.ACTIVE


def _row(response: ProviderResponse, language: str | None) -> dict[str, Any]:
    return {
        "provider": response.provider,
        "label": localized(response.label, language),
        "model_types": [str(model_type) for model_type in response.supported_model_types],
        "configured": _configured(response),
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
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
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
            if _configured(response) or not form
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
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
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
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
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

    @endpoint(
        op="delete.model_provider.credential",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Delete a saved model provider credential",
        examples=(
            Example(
                title="Remove a key",
                input={"provider": _PROVIDER_EXAMPLE, "credential_id": "<credential_id>"},
            ),
        ),
        requirements=_MANAGE,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Credential deleted"),
    )
    def delete(self, ctx: Context, workspace_id: str, provider: str, credential_id: str):
        """Delete a saved model provider credential.

        Answers 404 when `credential_id` is not among the credentials that
        `describe.model_provider` lists for this provider.
        """
        visible = ModelProviderService().get_provider_available_credentials(
            ctx.workspace.id, provider, ctx.account, credential_query=application_services().credential_queries
        )
        if all(credential.credential_id != credential_id for credential in visible):
            raise CredentialNotFound()
        with _model_provider_errors():
            ModelProviderService().remove_provider_credential(
                tenant_id=ctx.workspace.id, provider=provider, credential_id=credential_id
            )
        return SimpleResultResponse(result="success")


@openapi_ns.route("/workspaces/<string:workspace_id>/models")
class ModelsApi(Resource):
    @endpoint(
        op="get.model",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
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
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Save a credential for one model you name, for providers such as OpenAI-compatible or Ollama; "
        "the first credential of a model not yet set up becomes its active credential",
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
        with _model_provider_errors():
            credential_id = ModelProviderService().create_model_credential(
                tenant_id=ctx.workspace.id,
                provider=provider,
                model_type=body.model_type.value,
                model=body.model,
                credentials=body.credentials,
                credential_name=body.name,
            )
        response = _provider(ctx.workspace.id, provider)
        return _model_write_response(ctx.workspace.id, response, body, credential_id), HTTPStatus.CREATED


@openapi_ns.route(f"{_PROVIDER_PATH}/models/credentials/<string:credential_id>")
class ModelCredentialApi(Resource):
    @endpoint(
        op="set.model.credential",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
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

    @endpoint(
        op="delete.model.credential",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Delete a saved credential of one model",
        examples=(
            Example(
                title="Remove a model credential",
                input={
                    "provider": _OLLAMA_EXAMPLE,
                    "credential_id": "<credential_id>",
                    "model": "llama3",
                    "model_type": "llm",
                },
            ),
        ),
        requirements=_MANAGE,
        query=ModelRefQuery,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Credential deleted"),
    )
    def delete(self, ctx: Context, workspace_id: str, provider: str, credential_id: str, *, query: ModelRefQuery):
        """Delete a saved credential of one model.

        `model` and `model_type` are required query parameters. Answers 404
        when `credential_id` is not among the credentials this model lists.
        """
        visible = ModelProviderService().get_provider_model_available_credentials(
            ctx.workspace.id, provider, query.model_type.value, query.model
        )
        if all(credential.credential_id != credential_id for credential in visible):
            raise CredentialNotFound()
        with _model_provider_errors():
            ModelProviderService().remove_model_credential(
                tenant_id=ctx.workspace.id,
                provider=provider,
                model_type=query.model_type.value,
                model=query.model,
                credential_id=credential_id,
            )
        return SimpleResultResponse(result="success")


@openapi_ns.route(f"{_PROVIDER_PATH}/credentials/<string:credential_id>:activate")
class ModelProviderCredentialActivateApi(Resource):
    @endpoint(
        op="activate.model_provider.credential",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Make a saved model provider credential the active one",
        examples=(
            Example(
                title="Activate a key",
                input={"provider": _PROVIDER_EXAMPLE, "credential_id": "<credential_id>"},
            ),
        ),
        requirements=_USE,
        returns=(HTTPStatus.OK, CredentialWriteResponse, "Credential activated"),
    )
    def post(self, ctx: Context, workspace_id: str, provider: str, credential_id: str):
        """Make a saved model provider credential the active one.

        Answers 404 when `credential_id` is not among the credentials that
        `describe.model_provider` lists for this provider.
        """
        visible = ModelProviderService().get_provider_available_credentials(
            ctx.workspace.id, provider, ctx.account, credential_query=application_services().credential_queries
        )
        if all(credential.credential_id != credential_id for credential in visible):
            raise CredentialNotFound()
        with _model_provider_errors():
            ModelProviderService().switch_active_provider_credential(
                tenant_id=ctx.workspace.id, provider=provider, credential_id=credential_id
            )
        return _provider_write_response(ctx.workspace.id, _provider(ctx.workspace.id, provider), credential_id)


@openapi_ns.route(f"{_PROVIDER_PATH}/models/credentials/<string:credential_id>:activate")
class ModelCredentialActivateApi(Resource):
    @endpoint(
        op="activate.model.credential",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Make a saved credential the active one for one model",
        examples=(
            Example(
                title="Activate a model credential",
                input={
                    "provider": _OLLAMA_EXAMPLE,
                    "credential_id": "<credential_id>",
                    "model": "llama3",
                    "model_type": "llm",
                },
            ),
        ),
        requirements=_USE,
        body=ModelRef,
        returns=(HTTPStatus.OK, CredentialWriteResponse, "Credential activated"),
    )
    def post(self, ctx: Context, workspace_id: str, provider: str, credential_id: str, *, body: ModelRef):
        """Make a saved credential the active one for one model.

        Answers 404 when `credential_id` is not among the credentials this
        model lists.
        """
        visible = ModelProviderService().get_provider_model_available_credentials(
            ctx.workspace.id, provider, body.model_type.value, body.model
        )
        if all(credential.credential_id != credential_id for credential in visible):
            raise CredentialNotFound()
        with _model_provider_errors():
            ModelProviderService().switch_active_custom_model_credential(
                tenant_id=ctx.workspace.id,
                provider=provider,
                model_type=body.model_type.value,
                model=body.model,
                credential_id=credential_id,
            )
        return _model_write_response(ctx.workspace.id, _provider(ctx.workspace.id, provider), body, credential_id)


@openapi_ns.route(f"{_PROVIDER_PATH}/models")
class ProviderModelsApi(Resource):
    @endpoint(
        op="delete.model",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Delete a custom model and its credentials",
        examples=(
            Example(
                title="Remove a custom model",
                input={"provider": _OLLAMA_EXAMPLE, "model": "llama3", "model_type": "llm"},
            ),
        ),
        requirements=_MODEL_CONFIG,
        query=ModelRefQuery,
        returns=(HTTPStatus.OK, SimpleResultResponse, "Model deleted"),
    )
    def delete(self, ctx: Context, workspace_id: str, provider: str, *, query: ModelRefQuery):
        """Delete a custom model and its credentials.

        `model` and `model_type` are required query parameters. Answers 404
        when the provider's `custom_models` list has no entry with that model
        and type.
        """
        ref = ModelRef(model=query.model, model_type=query.model_type)
        if _custom_model(_provider(ctx.workspace.id, provider), ref) is None:
            raise ModelNotFound()
        with _model_provider_errors():
            ModelProviderService().remove_model(
                tenant_id=ctx.workspace.id, provider=provider, model_type=query.model_type.value, model=query.model
            )
        return SimpleResultResponse(result="success")


def _model_type(value: str) -> ModelType:
    try:
        return ModelType(value)
    except ValueError as error:
        raise UnprocessableEntity(f"unknown model type {value!r}") from error


@openapi_ns.route("/workspaces/<string:workspace_id>/default-models/<string:model_type>")
class DefaultModelApi(Resource):
    @endpoint(
        op="describe.default_model",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="The default model of one model type",
        examples=(Example(title="The default LLM", input={"model_type": "llm"}),),
        requirements=WORKSPACE_READ_GUARDS,
        returns=(HTTPStatus.OK, DefaultModelResponse, "Default model"),
    )
    def get(self, ctx: Context, workspace_id: str, model_type: str):
        """Read the workspace's default model of one model type.

        `provider` and `model` are null while no default is set. An unknown
        `model_type` answers 422.
        """
        kind = _model_type(model_type)
        entity = ModelProviderService().get_default_model_of_model_type(ctx.workspace.id, kind.value)
        return DefaultModelResponse(
            model_type=kind.value,
            provider=entity.provider.provider if entity else None,
            model=entity.model if entity else None,
        )

    @endpoint(
        op="set.default_model",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Set the default model of one model type",
        examples=(
            Example(
                title="Default the LLM to gpt-4o",
                input={"model_type": "llm", "provider": _PROVIDER_EXAMPLE, "model": "gpt-4o"},
            ),
        ),
        requirements=_MODEL_CONFIG,
        body=DefaultModelPayload,
        returns=(HTTPStatus.OK, DefaultModelResponse, "Default model set"),
    )
    def put(self, ctx: Context, workspace_id: str, model_type: str, *, body: DefaultModelPayload):
        """Set the workspace's default model of one model type.

        An unknown `model_type` answers 422.
        """
        kind = _model_type(model_type)
        with _model_provider_errors():
            ModelProviderService().update_default_model_of_model_type(
                tenant_id=ctx.workspace.id, model_type=kind.value, provider=body.provider, model=body.model
            )
        return DefaultModelResponse(model_type=kind.value, provider=body.provider, model=body.model)


def _provider_configuration(workspace_id: str, provider: str) -> ProviderConfiguration:
    configuration = (
        create_plugin_provider_manager(tenant_id=workspace_id).get_configurations(workspace_id).get(provider)
    )
    if configuration is None:
        raise ProviderNotFound()
    return configuration


def _model_settings(ctx: Context, provider: str, ref: ModelSettingsQuery) -> ModelSettingsResponse:
    configuration = _provider_configuration(ctx.workspace.id, provider)
    lb_enabled, configs = ModelLoadBalancingService().get_load_balancing_configs(
        tenant_id=ctx.workspace.id,
        provider=provider,
        model=ref.model,
        model_type=ref.model_type.value,
        session=db.session(),
        config_from=ref.config_from,
    )
    setting = configuration.get_provider_model_setting(model_type=ref.model_type, model=ref.model)
    return ModelSettingsResponse(
        model=ref.model,
        model_type=ref.model_type,
        config_from=ref.config_from,
        enabled=setting.enabled if setting else True,
        load_balancing=LoadBalancingSettings(
            enabled=lb_enabled,
            entries=[
                LoadBalancingEntry(
                    id=config["id"],
                    name=config["name"],
                    credential_id=config["credential_id"],
                    enabled=config["enabled"],
                    inherit=config["name"] == "__inherit__",
                )
                for config in configs
            ],
        ),
    )


def _lb_config_dicts(
    current: Sequence[LoadBalancingConfigSummaryDict], entries: Sequence[LoadBalancingEntryPayload]
) -> list[dict[str, Any]]:
    """Translate desired load-balancing entries into the config dicts the service replaces by.

    Reuses the existing config id for each credential (and the inherit row for
    a null credential_id) so a replace does not delete and recreate rows it
    keeps. Entries without a matching row become new configs; rows not listed
    are deleted by the service.
    """
    by_credential = {config["credential_id"]: config for config in current if config["credential_id"]}
    inherit = next((config for config in current if config["name"] == "__inherit__"), None)
    configs = []
    for entry in entries:
        if entry.credential_id is None:
            config = {"name": "__inherit__", "enabled": entry.enabled}
            if inherit:
                config["id"] = inherit["id"]
        elif existing := by_credential.get(entry.credential_id):
            config = {
                "id": existing["id"],
                "name": existing["name"],
                "credential_id": entry.credential_id,
                "enabled": entry.enabled,
            }
        else:
            # The service overwrites name with the credential's own name.
            config = {"name": entry.credential_id, "credential_id": entry.credential_id, "enabled": entry.enabled}
        configs.append(config)
    return configs


@openapi_ns.route(f"{_PROVIDER_PATH}/models/settings")
class ModelSettingsApi(Resource):
    @endpoint(
        op="describe.model.settings",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="A model's enabled flag and load-balancing entries",
        examples=(
            Example(
                title="Settings of a predefined model",
                input={
                    "provider": _PROVIDER_EXAMPLE,
                    "model": "gpt-4o",
                    "model_type": "llm",
                    "config_from": "predefined-model",
                },
            ),
        ),
        requirements=WORKSPACE_READ_GUARDS,
        query=ModelSettingsQuery,
        returns=(HTTPStatus.OK, ModelSettingsResponse, "Model settings"),
    )
    def get(self, ctx: Context, workspace_id: str, provider: str, *, query: ModelSettingsQuery):
        """Read a model's enabled flag and load-balancing entries.

        `enabled` is false while the model is disabled for this workspace.
        Load-balancing entries carry credential ids, never credential values;
        the entry with `inherit` true reuses the active credential.
        """
        return _model_settings(ctx, provider, query)

    @endpoint(
        op="set.model.settings",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Set a model's enabled flag and load-balancing entries",
        examples=(
            Example(
                title="Balance across two credentials",
                input={
                    "provider": _PROVIDER_EXAMPLE,
                    "model": "gpt-4o",
                    "model_type": "llm",
                    "config_from": "predefined-model",
                    "enabled": True,
                    "load_balancing": {
                        "enabled": True,
                        "entries": [
                            {"credential_id": None, "enabled": True},
                            {"credential_id": "<credential_id>", "enabled": True},
                        ],
                    },
                },
            ),
        ),
        requirements=_MODEL_CONFIG,
        body=ModelSettingsPutPayload,
        returns=(HTTPStatus.OK, ModelSettingsResponse, "Model settings"),
    )
    def put(self, ctx: Context, workspace_id: str, provider: str, *, body: ModelSettingsPutPayload):
        """Replace a model's enabled flag and load-balancing entries.

        The list is declarative: load-balancing entries the workspace has but
        the request omits are deleted. An entry with a null `credential_id`
        reuses the active credential; at most one such entry is allowed, and
        duplicate credential ids answer 422. Load-balancing entries always
        reference saved credentials — inline credential values are not
        accepted.
        """
        _, current = ModelLoadBalancingService().get_load_balancing_configs(
            tenant_id=ctx.workspace.id,
            provider=provider,
            model=body.model,
            model_type=body.model_type.value,
            session=db.session(),
            config_from=body.config_from,
        )
        with _model_provider_errors():
            balancing = ModelLoadBalancingService()
            balancing.update_load_balancing_configs(
                tenant_id=ctx.workspace.id,
                provider=provider,
                model=body.model,
                model_type=body.model_type.value,
                configs=_lb_config_dicts(current, body.load_balancing.entries),
                config_from=body.config_from,
                session=db.session(),
            )
            if body.load_balancing.enabled:
                balancing.enable_model_load_balancing(
                    tenant_id=ctx.workspace.id,
                    provider=provider,
                    model=body.model,
                    model_type=body.model_type.value,
                )
            else:
                balancing.disable_model_load_balancing(
                    tenant_id=ctx.workspace.id,
                    provider=provider,
                    model=body.model,
                    model_type=body.model_type.value,
                )
            provider_service = ModelProviderService()
            if body.enabled:
                provider_service.enable_model(
                    tenant_id=ctx.workspace.id,
                    provider=provider,
                    model=body.model,
                    model_type=body.model_type.value,
                )
            else:
                provider_service.disable_model(
                    tenant_id=ctx.workspace.id,
                    provider=provider,
                    model=body.model,
                    model_type=body.model_type.value,
                )
        return _model_settings(ctx, provider, body)
