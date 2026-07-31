"""Bearer-authenticated, command-specific KnowledgeFS filesystem reads for difyctl."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from http import HTTPStatus

from flask_restx import Resource
from werkzeug.exceptions import (
    BadRequest,
    Conflict,
    Forbidden,
    NotFound,
    RequestEntityTooLarge,
    ServiceUnavailable,
    UnprocessableEntity,
)

from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, returns
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData
from core.db.session_factory import session_factory
from libs.oauth_bearer import Scope, TokenType
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_authorization import KnowledgeFSProductNotFoundError
from services.knowledge_fs.product_dto import (
    KnowledgeFSCatQuery,
    KnowledgeFSCatResponse,
    KnowledgeFSDiffQuery,
    KnowledgeFSDiffResponse,
    KnowledgeFSFindQuery,
    KnowledgeFSGrepQuery,
    KnowledgeFSGrepResponse,
    KnowledgeFSListQuery,
    KnowledgeFSListResponse,
    KnowledgeFSStatQuery,
    KnowledgeFSStatResponse,
    KnowledgeFSTreeQuery,
    KnowledgeFSTreeResponse,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from services.knowledge_fs.runtime import get_knowledge_fs_runtime
from services.knowledge_fs_capability import KnowledgeFSCapabilityConfigurationError


def _knowledge_fs_facade() -> KnowledgeFSDataFacade:
    return get_knowledge_fs_runtime(session_factory.get_session_maker()).facade


def _knowledge_fs_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except (KnowledgeFSProductNotFoundError, KnowledgeFSProductResourceNotFoundError) as exc:
            raise NotFound("KnowledgeFS space or path not found") from exc
        except KnowledgeFSProductRequestRejectedError as exc:
            if exc.status_code == HTTPStatus.BAD_REQUEST:
                raise BadRequest("invalid KnowledgeFS request") from exc
            if exc.status_code == HTTPStatus.CONFLICT:
                raise Conflict("KnowledgeFS request conflicted with current state") from exc
            if exc.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE:
                raise RequestEntityTooLarge() from exc
            raise UnprocessableEntity("KnowledgeFS request was rejected") from exc
        except PermissionError as exc:
            raise Forbidden("KnowledgeFS space access denied") from exc
        except (
            KnowledgeFSCapabilityConfigurationError,
            KnowledgeFSOperationUnavailableError,
            KnowledgeFSProductRemoteError,
        ) as exc:
            raise ServiceUnavailable("KnowledgeFS is unavailable") from exc

    return decorated


def _account_id(auth_data: AuthData) -> str:
    return str(auth_data.account_id)


@openapi_ns.route("/workspaces/<string:workspace_id>/knowledge-fs/spaces/<string:control_space_id>/fs/ls")
class KnowledgeFsListApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @returns(200, KnowledgeFSListResponse, description="KnowledgeFS directory listing")
    @accepts(query=KnowledgeFSListQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        control_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSListQuery,
    ) -> KnowledgeFSListResponse:
        return _knowledge_fs_facade().list_knowledge_fs(
            tenant_id=workspace_id,
            account_id=_account_id(auth_data),
            control_space_id=control_space_id,
            query=query,
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/knowledge-fs/spaces/<string:control_space_id>/fs/tree")
class KnowledgeFsTreeApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @returns(200, KnowledgeFSTreeResponse, description="KnowledgeFS directory tree")
    @accepts(query=KnowledgeFSTreeQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        control_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSTreeQuery,
    ) -> KnowledgeFSTreeResponse:
        return _knowledge_fs_facade().tree_knowledge_fs(
            tenant_id=workspace_id,
            account_id=_account_id(auth_data),
            control_space_id=control_space_id,
            query=query,
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/knowledge-fs/spaces/<string:control_space_id>/fs/grep")
class KnowledgeFsGrepApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @returns(200, KnowledgeFSGrepResponse, description="KnowledgeFS text matches")
    @accepts(query=KnowledgeFSGrepQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        control_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSGrepQuery,
    ) -> KnowledgeFSGrepResponse:
        return _knowledge_fs_facade().grep_knowledge_fs(
            tenant_id=workspace_id,
            account_id=_account_id(auth_data),
            control_space_id=control_space_id,
            query=query,
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/knowledge-fs/spaces/<string:control_space_id>/fs/find")
class KnowledgeFsFindApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @returns(200, KnowledgeFSListResponse, description="KnowledgeFS path matches")
    @accepts(query=KnowledgeFSFindQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        control_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSFindQuery,
    ) -> KnowledgeFSListResponse:
        return _knowledge_fs_facade().find_knowledge_fs(
            tenant_id=workspace_id,
            account_id=_account_id(auth_data),
            control_space_id=control_space_id,
            query=query,
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/knowledge-fs/spaces/<string:control_space_id>/fs/diff")
class KnowledgeFsDiffApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @returns(200, KnowledgeFSDiffResponse, description="KnowledgeFS text diff")
    @accepts(query=KnowledgeFSDiffQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        control_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSDiffQuery,
    ) -> KnowledgeFSDiffResponse:
        return _knowledge_fs_facade().diff_knowledge_fs(
            tenant_id=workspace_id,
            account_id=_account_id(auth_data),
            control_space_id=control_space_id,
            query=query,
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/knowledge-fs/spaces/<string:control_space_id>/fs/cat")
class KnowledgeFsCatApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @returns(200, KnowledgeFSCatResponse, description="KnowledgeFS file content")
    @accepts(query=KnowledgeFSCatQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        control_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSCatQuery,
    ) -> KnowledgeFSCatResponse:
        return _knowledge_fs_facade().cat_knowledge_fs(
            tenant_id=workspace_id,
            account_id=_account_id(auth_data),
            control_space_id=control_space_id,
            query=query,
        )


@openapi_ns.route("/workspaces/<string:workspace_id>/knowledge-fs/spaces/<string:control_space_id>/fs/stat")
class KnowledgeFsStatApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @returns(200, KnowledgeFSStatResponse, description="KnowledgeFS path metadata")
    @accepts(query=KnowledgeFSStatQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        control_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSStatQuery,
    ) -> KnowledgeFSStatResponse:
        return _knowledge_fs_facade().stat_knowledge_fs(
            tenant_id=workspace_id,
            account_id=_account_id(auth_data),
            control_space_id=control_space_id,
            query=query,
        )


__all__ = [
    "KnowledgeFsCatApi",
    "KnowledgeFsDiffApi",
    "KnowledgeFsFindApi",
    "KnowledgeFsGrepApi",
    "KnowledgeFsListApi",
    "KnowledgeFsStatApi",
    "KnowledgeFsTreeApi",
]
