"""API keys an app hands to its Service API callers; the console's /apps/<id>/api-keys."""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from http import HTTPStatus
from typing import Final
from uuid import UUID

from flask_restx import Resource
from werkzeug.exceptions import NotFound

from constants.oauth_bearer import Scope
from constants.personal_access_token import PersonalAccessTokenPolicy
from controllers.common.errors import ForbiddenError
from controllers.common.fields import SimpleResultResponse
from controllers.common.rbac import AgentBehindApp, PlainApp, RBACCheck, RBACPermission
from controllers.openapi import openapi_ns
from controllers.openapi._contract import Effect, Example, Kind, endpoint
from controllers.openapi._errors import ApiKeyLimitExceeded, AppApiKeyNotReady
from controllers.openapi._models import AppApiKeyListResponse, AppApiKeyRow
from controllers.openapi.auth.requirements import (
    ADMIN_ROLES,
    EDITOR_ROLES,
    CheckRBACPermission,
    CheckScope,
    CheckSubject,
    CheckWorkspaceMember,
    CheckWorkspaceRole,
)
from controllers.openapi.auth.subjects import AccountSubject
from extensions.ext_application_services import application_services
from machinery.context import RequestContext
from services.app.api_key_service import AppApiKeyNotReadyError
from services.auth.api_key_contracts import (
    ApiKeyLimitExceededError,
    ApiKeyNotFoundError,
    ApiKeyRecord,
    ApiKeyResourceNotFoundError,
)
from services.errors.base import NoPermissionError

_APP_PATH: Final = "/apps/<string:app_id>/api-keys"

_READ_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject,)),
    CheckWorkspaceMember(),
    CheckScope(Scope.APPS_READ),
    CheckRBACPermission(
        RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp()),
        RBACCheck(RBACPermission.AGENT_ACCESS_POINT_VIEW, AgentBehindApp()),
    ),
    CheckWorkspaceRole(EDITOR_ROLES),
)
_WRITE_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject,)),
    CheckWorkspaceMember(),
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckRBACPermission(
        RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp()),
        RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentBehindApp()),
    ),
    CheckWorkspaceRole(EDITOR_ROLES),
)
_DELETE_GUARDS: Final = (
    CheckSubject(allowed=(AccountSubject,)),
    CheckWorkspaceMember(),
    CheckScope(Scope.WORKSPACE_WRITE),
    CheckRBACPermission(
        RBACCheck(RBACPermission.APP_RELEASE_AND_VERSION, PlainApp()),
        RBACCheck(RBACPermission.AGENT_ACCESS_POINT_MANAGE, AgentBehindApp()),
    ),
    CheckWorkspaceRole(ADMIN_ROLES),
)


@contextmanager
def _api_key_errors() -> Generator[None]:
    """Translate the errors every app API key operation can raise."""
    try:
        yield
    except (ApiKeyResourceNotFoundError, ApiKeyNotFoundError) as error:
        raise NotFound(str(error)) from error
    except NoPermissionError as error:
        raise ForbiddenError(str(error)) from error


@contextmanager
def _api_key_create_errors() -> Generator[None]:
    """Creating a key can also hit the per-app key limit or an unpublished agent."""
    try:
        with _api_key_errors():
            yield
    except ApiKeyLimitExceededError as error:
        raise ApiKeyLimitExceeded(str(error)) from error
    except AppApiKeyNotReadyError as error:
        raise AppApiKeyNotReady() from error


def _row(key: ApiKeyRecord) -> AppApiKeyRow:
    return AppApiKeyRow(id=key.id, token=key.token, created_at=key.created_at, last_used_at=key.last_used_at)


@openapi_ns.route(_APP_PATH)
class AppApiKeysApi(Resource):
    @endpoint(
        context="workspace",
        op="get.app_api_key",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="List an app's API keys",
        examples=(Example(title="List keys", input={"app_id": "<app_id>"}),),
        requirements=_READ_GUARDS,
        returns=(HTTPStatus.OK, AppApiKeyListResponse, "API keys"),
    )
    def get(self, ctx: RequestContext, app_id: str):
        """List the app's API keys.

        Every key is returned with its full token. Answers 404 when the app does
        not exist in the workspace or the token cannot reach it.
        """
        with _api_key_errors():
            keys = application_services().app_api_keys.list_keys(ctx, str(UUID(app_id)))
        return AppApiKeyListResponse(data=[_row(key) for key in keys])

    @endpoint(
        context="workspace",
        op="create.app_api_key",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        summary="Create an API key for an app; the full token is returned once",
        examples=(Example(title="Create a key", input={"app_id": "<app_id>"}),),
        requirements=_WRITE_GUARDS,
        returns=(HTTPStatus.CREATED, AppApiKeyRow, "API key created"),
    )
    def post(self, ctx: RequestContext, app_id: str):
        """Create an API key for the app.

        The full token is returned only in this response; store it securely.
        Answers 400 when the app has reached its API key limit and 409 when the
        app is an agent app that has not been published.
        """
        with _api_key_create_errors():
            key = application_services().app_api_keys.create_key(ctx, str(UUID(app_id)))
        return _row(key), HTTPStatus.CREATED


@openapi_ns.route(f"{_APP_PATH}/<string:api_key_id>")
class AppApiKeyApi(Resource):
    @endpoint(
        context="workspace",
        op="delete.app_api_key",
        pat_policy=PersonalAccessTokenPolicy.WORKSPACE_OPERATIONS,
        kind=Kind.OBJECT,
        effect=Effect.DESTRUCTIVE,
        summary="Delete an app's API key",
        examples=(Example(title="Delete a key", input={"app_id": "<app_id>", "api_key_id": "<api_key_id>"}),),
        requirements=_DELETE_GUARDS,
        returns=(HTTPStatus.OK, SimpleResultResponse, "API key deleted"),
    )
    def delete(self, ctx: RequestContext, app_id: str, api_key_id: str):
        """Delete an API key of the app.

        Answers 404 when `api_key_id` is not a valid id or names no key of this app.
        """
        try:
            key_id = str(UUID(api_key_id))
        except ValueError as error:
            raise NotFound("API key not found") from error
        with _api_key_errors():
            application_services().app_api_keys.delete_key(ctx, str(UUID(app_id)), key_id)
        return SimpleResultResponse(result="success")
