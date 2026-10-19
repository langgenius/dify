"""Personal-account PAT management HTTP contracts."""

from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from flask import make_response, request
from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from werkzeug.exceptions import Conflict, Forbidden, NotFound, ServiceUnavailable

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.flask_admission import console_personal_account_admission
from controllers.console.wraps import model_validate
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from machinery.context import AccountRequestContext
from services.personal_access_token_cipher import PersonalAccessTokenKeyUnavailableError
from services.personal_access_token_service import (
    PersonalAccessTokenAccessDeniedError,
    PersonalAccessTokenCatalogUnavailableError,
    PersonalAccessTokenCreateConflictError,
    PersonalAccessTokenExpiredError,
    PersonalAccessTokenNotFoundError,
    PersonalAccessTokenResourceRef,
    PersonalAccessTokenScopes,
    PersonalAccessTokenUpdateConflictError,
)


class PersonalAccessTokenResourcePayload(BaseModel):
    resource_type: Literal["app", "dataset", "app_runner"]
    resource_id: UUID


class PersonalAccessTokenResourceScopePayload(BaseModel):
    mode: Literal["all", "selected", "none"] = "all"
    resources: list[PersonalAccessTokenResourcePayload] = Field(default_factory=list)


class PersonalAccessTokenWorkspaceScopePayload(BaseModel):
    mode: Literal["all", "selected", "none"] = "all"
    workspace_ids: list[UUID] = Field(default_factory=list)


class PersonalAccessTokenCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255)
    expiration: Literal["30_days", "90_days", "180_days", "365_days", "never"] = "90_days"
    resource_scope: PersonalAccessTokenResourceScopePayload = Field(
        default_factory=PersonalAccessTokenResourceScopePayload
    )
    workspace_scope: PersonalAccessTokenWorkspaceScopePayload = Field(
        default_factory=PersonalAccessTokenWorkspaceScopePayload
    )


class PersonalAccessTokenUpdatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=255)
    version: int = Field(ge=1)
    resource_scope: PersonalAccessTokenResourceScopePayload | None = None
    workspace_scope: PersonalAccessTokenWorkspaceScopePayload | None = None

    @model_validator(mode="after")
    def require_both_scopes(self):
        if (self.resource_scope is None) != (self.workspace_scope is None):
            raise ValueError("Supply both scope domains or omit both to preserve them.")
        return self


class PersonalAccessTokenListQuery(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)


class PersonalAccessTokenCandidateQuery(BaseModel):
    cursor: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=100)
    keyword: str | None = Field(default=None, max_length=100)


class PersonalAccessTokenResponse(ResponseModel):
    id: str
    name: str
    secret_last_four: str
    created_at: datetime
    expires_at: datetime | None
    last_used_at: datetime | None
    resource_count: int
    workspace_count: int
    unavailable_count: int
    resource_scope_mode: Literal["all", "selected", "none"]
    workspace_scope_mode: Literal["all", "selected", "none"]
    status: Literal["active", "expired", "access_issue"]
    version: int

    @field_validator("created_at", "expires_at", "last_used_at")
    @classmethod
    def utc_timestamp(cls, value: datetime | None) -> datetime | None:
        return value.replace(tzinfo=UTC) if value is not None and value.tzinfo is None else value


class PersonalAccessTokenResourceResponse(ResponseModel):
    resource_type: Literal["app", "dataset", "app_runner"]
    resource_id: str
    workspace_id: str
    display_name: str
    workspace_name: str
    available: bool
    reason: str | None
    parent_app_id: str | None = None
    app_runners: list["PersonalAccessTokenResourceResponse"] = Field(default_factory=list)


class PersonalAccessTokenWorkspaceResponse(ResponseModel):
    workspace_id: str
    display_name: str
    available: bool
    reason: str | None
    role: str | None


class PersonalAccessTokenDetailResponse(ResponseModel):
    token: PersonalAccessTokenResponse
    resources: list[PersonalAccessTokenResourceResponse]
    workspaces: list[PersonalAccessTokenWorkspaceResponse]


class PersonalAccessTokenListResponse(ResponseModel):
    data: list[PersonalAccessTokenResponse]
    page: int
    limit: int
    total: int
    has_more: bool


class PersonalAccessTokenSecretResponse(ResponseModel):
    secret: str


class PersonalAccessTokenResourceCandidateResponse(ResponseModel):
    data: list[PersonalAccessTokenResourceResponse]
    next_cursor: int | None
    has_more: bool


class PersonalAccessTokenWorkspaceCandidateResponse(ResponseModel):
    data: list[PersonalAccessTokenWorkspaceResponse]
    next_cursor: int | None
    has_more: bool


register_schema_models(
    console_ns,
    PersonalAccessTokenCreatePayload,
    PersonalAccessTokenListQuery,
    PersonalAccessTokenUpdatePayload,
    PersonalAccessTokenCandidateQuery,
)
register_response_schema_models(
    console_ns,
    PersonalAccessTokenResponse,
    PersonalAccessTokenListResponse,
    PersonalAccessTokenSecretResponse,
    PersonalAccessTokenDetailResponse,
    PersonalAccessTokenResourceCandidateResponse,
    PersonalAccessTokenWorkspaceCandidateResponse,
)


@contextmanager
def _token_errors() -> Generator[None]:
    try:
        yield
    except PersonalAccessTokenCatalogUnavailableError:
        raise ServiceUnavailable("App Runner configuration is temporarily unavailable.") from None
    except PersonalAccessTokenKeyUnavailableError:
        raise ServiceUnavailable("Personal access token encryption is unavailable.") from None
    except PersonalAccessTokenNotFoundError:
        raise NotFound("Personal access token not found.") from None
    except PersonalAccessTokenExpiredError:
        raise Forbidden("Personal access token has expired.") from None
    except PersonalAccessTokenCreateConflictError:
        raise Conflict("Idempotency key is already used by a different or revoked request.") from None
    except PersonalAccessTokenAccessDeniedError as error:
        raise Forbidden(str(error)) from None
    except PersonalAccessTokenUpdateConflictError:
        raise Conflict("Personal access token changed; reload before saving.") from None


def _scopes(resource: PersonalAccessTokenResourceScopePayload, workspace: PersonalAccessTokenWorkspaceScopePayload):
    return PersonalAccessTokenScopes(
        resource_mode=resource.mode,
        resources=tuple(
            dict.fromkeys(
                PersonalAccessTokenResourceRef(
                    item.resource_type,
                    str(item.resource_id),
                )
                for item in resource.resources
            )
        ),
        workspace_mode=workspace.mode,
        workspace_ids=tuple(dict.fromkeys(str(item) for item in workspace.workspace_ids)),
    )


@console_ns.route("/account/personal-access-tokens")
class PersonalAccessTokenListApi(Resource):
    @console_ns.doc("list_personal_access_tokens", params=query_params_from_model(PersonalAccessTokenListQuery))
    @console_ns.response(200, "Personal access tokens", console_ns.models[PersonalAccessTokenListResponse.__name__])
    @console_personal_account_admission
    @model_validate(PersonalAccessTokenListQuery)
    def get(self, query: PersonalAccessTokenListQuery, context: AccountRequestContext) -> dict[str, object]:
        tokens = application_services().personal_access_tokens
        with _token_errors():
            rows = tokens.list_tokens(context, page=query.page, limit=query.limit)
            total = tokens.count_tokens(context)
        return dump_response(
            PersonalAccessTokenListResponse,
            {
                "data": rows,
                "page": query.page,
                "limit": query.limit,
                "total": total,
                "has_more": query.page * query.limit < total,
            },
        )

    @console_ns.doc("create_personal_access_token")
    @console_ns.doc(
        params={
            "Idempotency-Key": {
                "in": "header",
                "description": "Stable key for creation retries",
                "type": "string",
                "maxLength": 128,
            }
        }
    )
    @console_ns.expect(console_ns.models[PersonalAccessTokenCreatePayload.__name__])
    @console_ns.response(201, "Personal access token created", console_ns.models[PersonalAccessTokenResponse.__name__])
    @console_personal_account_admission
    @model_validate(PersonalAccessTokenCreatePayload)
    def post(self, payload: PersonalAccessTokenCreatePayload, context: AccountRequestContext):
        expiration_days = None if payload.expiration == "never" else int(payload.expiration.removesuffix("_days"))
        with _token_errors():
            token = application_services().personal_access_tokens.create(
                context,
                name=payload.name,
                expiration_days=expiration_days,
                creation_key=request.headers.get("Idempotency-Key"),
                scopes=_scopes(payload.resource_scope, payload.workspace_scope),
            )
        return dump_response(PersonalAccessTokenResponse, token), 201


@console_ns.route("/account/personal-access-tokens/<uuid:token_id>/secret")
class PersonalAccessTokenSecretApi(Resource):
    @console_ns.doc("copy_personal_access_token")
    @console_ns.response(
        200, "Complete personal access token", console_ns.models[PersonalAccessTokenSecretResponse.__name__]
    )
    @console_personal_account_admission
    def post(self, context: AccountRequestContext, token_id: UUID):
        with _token_errors():
            secret = application_services().personal_access_tokens.copy_secret(context, token_id=str(token_id))
        response = make_response(dump_response(PersonalAccessTokenSecretResponse, {"secret": secret}))
        response.headers["Cache-Control"] = "no-store"
        return response


@console_ns.route("/account/personal-access-tokens/<uuid:token_id>")
class PersonalAccessTokenApi(Resource):
    @console_ns.doc("describe_personal_access_token")
    @console_ns.response(200, "Saved scopes", console_ns.models[PersonalAccessTokenDetailResponse.__name__])
    @console_personal_account_admission
    def get(self, context: AccountRequestContext, token_id: UUID):
        with _token_errors():
            detail = application_services().personal_access_tokens.details(context, token_id=str(token_id))
        return dump_response(PersonalAccessTokenDetailResponse, detail)

    @console_ns.doc("update_personal_access_token")
    @console_ns.expect(console_ns.models[PersonalAccessTokenUpdatePayload.__name__])
    @console_ns.response(200, "Updated scopes", console_ns.models[PersonalAccessTokenDetailResponse.__name__])
    @console_personal_account_admission
    @model_validate(PersonalAccessTokenUpdatePayload)
    def patch(self, payload: PersonalAccessTokenUpdatePayload, context: AccountRequestContext, token_id: UUID):
        scopes = (
            _scopes(payload.resource_scope, payload.workspace_scope)
            if payload.resource_scope is not None and payload.workspace_scope is not None
            else None
        )
        with _token_errors():
            detail = application_services().personal_access_tokens.update(
                context,
                token_id=str(token_id),
                name=payload.name,
                version=payload.version,
                scopes=scopes,
            )
        return dump_response(PersonalAccessTokenDetailResponse, detail)

    @console_ns.doc("revoke_personal_access_token")
    @console_ns.response(204, "Personal access token revoked")
    @console_personal_account_admission
    def delete(self, context: AccountRequestContext, token_id: UUID) -> tuple[str, int]:
        with _token_errors():
            application_services().personal_access_tokens.revoke(context, token_id=str(token_id))
        return "", 204


@console_ns.route("/account/personal-access-token-resources")
class PersonalAccessTokenResourcesApi(Resource):
    @console_ns.doc(
        "list_personal_access_token_resources",
        params=query_params_from_model(PersonalAccessTokenCandidateQuery),
    )
    @console_ns.response(
        200, "Available resources", console_ns.models[PersonalAccessTokenResourceCandidateResponse.__name__]
    )
    @console_personal_account_admission
    @model_validate(PersonalAccessTokenCandidateQuery)
    def get(self, query: PersonalAccessTokenCandidateQuery, context: AccountRequestContext):
        with _token_errors():
            page = application_services().personal_access_tokens.resource_candidates(
                context,
                keyword=query.keyword,
                cursor=query.cursor,
                limit=query.limit,
            )
        return dump_response(PersonalAccessTokenResourceCandidateResponse, page)


@console_ns.route("/account/personal-access-token-workspaces")
class PersonalAccessTokenWorkspacesApi(Resource):
    @console_ns.doc(
        "list_personal_access_token_workspaces", params=query_params_from_model(PersonalAccessTokenCandidateQuery)
    )
    @console_ns.response(
        200, "Available workspaces", console_ns.models[PersonalAccessTokenWorkspaceCandidateResponse.__name__]
    )
    @console_personal_account_admission
    @model_validate(PersonalAccessTokenCandidateQuery)
    def get(self, query: PersonalAccessTokenCandidateQuery, context: AccountRequestContext):
        page = application_services().personal_access_tokens.workspace_candidates(
            context,
            keyword=query.keyword,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(PersonalAccessTokenWorkspaceCandidateResponse, page)
