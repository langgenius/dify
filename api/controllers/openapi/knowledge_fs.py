"""Command-oriented KnowledgeFS filesystem APIs consumed by difyctl.

Each difyctl filesystem command maps to an independent custom method under the
``fs`` resource. Public request and response models remain independent from the
internal KnowledgeFS product DTOs.

All operations are read-only, require an OAuth account bearer with workspace
read scope, and re-check the knowledge-space tenant boundary in the product
facade.  Deliberately indistinguishable space/path misses share one 404 code so
callers cannot use this surface to enumerate hidden resources.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from http import HTTPStatus
from typing import Literal

from flask_restx import Resource
from pydantic import BaseModel, ConfigDict, Field, JsonValue, field_validator, model_validator

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, returns
from controllers.openapi._errors import (
    ErrorBody,
    KnowledgeFsAccessDeniedError,
    KnowledgeFsConflictError,
    KnowledgeFsInvalidRequestError,
    KnowledgeFsRequestRejectedError,
    KnowledgeFsRequestTooLargeError,
    KnowledgeFsResourceNotFoundError,
    KnowledgeFsUnavailableError,
)
from controllers.openapi.auth.composition import auth_router
from controllers.openapi.auth.data import AuthData
from core.db.session_factory import session_factory
from fields.base import ResponseModel
from libs.oauth_bearer import Scope, TokenType
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.product_authorization import KnowledgeFSProductNotFoundError
from services.knowledge_fs.product_dto import (
    KNOWLEDGE_FS_PATH_PATTERN,
    KnowledgeFSCatQuery,
    KnowledgeFSCatResponse,
    KnowledgeFSConsistencyClass,
    KnowledgeFSDiffQuery,
    KnowledgeFSDiffResponse,
    KnowledgeFSFindQuery,
    KnowledgeFSGrepQuery,
    KnowledgeFSGrepResponse,
    KnowledgeFSListQuery,
    KnowledgeFSListResponse,
    KnowledgeFSResourceType,
    KnowledgeFSStatQuery,
    KnowledgeFSStatResponse,
    KnowledgeFSTreeQuery,
    KnowledgeFSTreeResponse,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSEntryResponse as ProductKnowledgeFSEntryResponse,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSGrepMatchResponse as ProductKnowledgeFSGrepMatchResponse,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSTreeNodeResponse as ProductKnowledgeFSTreeNodeResponse,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from services.knowledge_fs.runtime import get_knowledge_fs_runtime
from services.knowledge_fs_capability import KnowledgeFSCapabilityConfigurationError

_PATH_DESCRIPTION = "Canonical KnowledgeFS virtual path under /sources, /knowledge, /evidence, or /workspaces."
_PAGE_SIZE_DESCRIPTION = "Maximum number of results to return (1-100)."
_PAGE_TOKEN_DESCRIPTION = (
    "Opaque continuation token returned as next_page_token. Repeat the same query without inspecting the token."
)
_NEXT_PAGE_TOKEN_DESCRIPTION = "Opaque continuation token for the next page; null when no continuation is available."
_CONTENT_PAGE_SIZE_DESCRIPTION = (
    "Maximum source segments to read (1-100); ignored when the selected entry has one bounded content value."
)
_CONSISTENCY_DESCRIPTION = "Optional KnowledgeFS read-consistency policy."
_OPEN_RESPONSE_VALUE_DESCRIPTION = (
    "Open response value. Clients must tolerate unknown future values and fall back to generic display behavior."
)
_READ_SECURITY_DESCRIPTION = (
    "Requires an OAuth account bearer with WORKSPACE_READ. Authentication and workspace scope are checked before "
    "request validation, and knowledge-space membership is revalidated for every call. A hidden or missing knowledge "
    "space or entry uses the same 404 response. These operations are read-only and do not emit mutation audit events."
)
_PAGINATION_DESCRIPTION = (
    "Results use the canonical, stable KnowledgeFS traversal order. The opaque next_page_token captures that order; "
    "reuse it with unchanged filters and consistency_class. total is intentionally omitted because tenant-aware "
    "visibility scans are bounded and an exact count can require an unbounded scan."
)
_CONTENT_CONTINUATION_DESCRIPTION = (
    "Content follows stable source order. When next_page_token is present, reuse it with the same path and "
    "consistency_class. total is not returned because this response is a bounded content stream, not a collection."
)

_KNOWLEDGE_FS_ERROR_RESPONSES = {
    400: "Invalid KnowledgeFS request",
    401: "Missing or invalid OAuth account bearer",
    403: "Caller lacks workspace or knowledge-space read access",
    404: "Knowledge space or entry is missing or hidden",
    409: "Requested consistency conflicts with current state",
    413: "Request exceeds a KnowledgeFS operational bound",
    422: "Request validation failed or the request was rejected",
    503: "KnowledgeFS is temporarily unavailable",
}


class _KnowledgeFSEntryQuery(BaseModel):
    path: str = Field(min_length=1, max_length=4_096, pattern=KNOWLEDGE_FS_PATH_PATTERN, description=_PATH_DESCRIPTION)
    consistency_class: KnowledgeFSConsistencyClass | None = Field(default=None, description=_CONSISTENCY_DESCRIPTION)

    model_config = ConfigDict(extra="forbid")


class _KnowledgeFSPaginatedEntryQuery(_KnowledgeFSEntryQuery):
    page_size: int = Field(default=20, ge=1, le=100, description=_PAGE_SIZE_DESCRIPTION)
    page_token: str | None = Field(default=None, min_length=1, max_length=8_192, description=_PAGE_TOKEN_DESCRIPTION)


class KnowledgeFSEntryListQuery(_KnowledgeFSPaginatedEntryQuery):
    """List direct children in stable KnowledgeFS traversal order."""


class KnowledgeFSEntryTreeQuery(_KnowledgeFSPaginatedEntryQuery):
    depth: int | None = Field(default=None, ge=1, le=8, description="Maximum tree depth (1-8).")


class KnowledgeFSEntryContentSearchQuery(_KnowledgeFSPaginatedEntryQuery):
    text: str = Field(min_length=1, max_length=4_000, description="Text to find in readable entry content.")
    timeout_ms: int | None = Field(
        default=None,
        ge=1,
        le=10_000,
        description="Optional search time budget in milliseconds (1-10000).",
    )

    @field_validator("text", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class KnowledgeFSEntrySearchQuery(_KnowledgeFSPaginatedEntryQuery):
    metadata_key: str | None = Field(
        default=None,
        min_length=1,
        max_length=120,
        description="Exact metadata key; metadata_value must be supplied with it.",
    )
    metadata_value: str | None = Field(
        default=None,
        min_length=1,
        max_length=4_000,
        description="Exact metadata value; metadata_key must be supplied with it.",
    )
    name_contains: str | None = Field(default=None, min_length=1, max_length=240)
    resource_type: KnowledgeFSResourceType | None = None

    @model_validator(mode="after")
    def validate_metadata_pair(self) -> KnowledgeFSEntrySearchQuery:
        if (self.metadata_key is None) != (self.metadata_value is None):
            raise ValueError("metadata_key and metadata_value must be supplied together")
        return self


class KnowledgeFSEntryReadContentQuery(_KnowledgeFSEntryQuery):
    page_size: int = Field(default=100, ge=1, le=100, description=_CONTENT_PAGE_SIZE_DESCRIPTION)
    page_token: str | None = Field(default=None, min_length=1, max_length=8_192, description=_PAGE_TOKEN_DESCRIPTION)


class KnowledgeFSEntryInspectQuery(_KnowledgeFSEntryQuery):
    pass


class KnowledgeFSEntryComparePayload(BaseModel):
    old_path: str = Field(
        min_length=1,
        max_length=4_096,
        pattern=KNOWLEDGE_FS_PATH_PATTERN,
        description="Canonical path of the baseline entry.",
    )
    new_path: str = Field(
        min_length=1,
        max_length=4_096,
        pattern=KNOWLEDGE_FS_PATH_PATTERN,
        description="Canonical path of the entry to compare.",
    )
    mode: Literal["line", "word"] | None = Field(default=None, description="Comparison granularity.")
    include_semantic_summary: bool = Field(
        default=False,
        description="Whether to generate a bounded semantic change summary. This can consume model quota.",
    )
    consistency_class: KnowledgeFSConsistencyClass | None = Field(default=None, description=_CONSISTENCY_DESCRIPTION)

    model_config = ConfigDict(extra="forbid")


class KnowledgeFSEntryResponse(ResponseModel):
    kind: Literal["directory", "resource"]
    metadata: dict[str, JsonValue]
    name: str
    path: str
    resource_type: str | None = Field(default=None, description=_OPEN_RESPONSE_VALUE_DESCRIPTION)
    target_id: str | None = None
    version: int | None = Field(default=None, ge=1)

    @classmethod
    def from_product_entry(cls, response: ProductKnowledgeFSEntryResponse) -> KnowledgeFSEntryResponse:
        return cls.model_validate(response.model_dump(mode="python"))


class KnowledgeFSEntryListResponse(ResponseModel):
    consistency_class: str | None = Field(default=None, description=_OPEN_RESPONSE_VALUE_DESCRIPTION)
    data: list[KnowledgeFSEntryResponse]
    has_more: bool
    next_page_token: str | None = Field(default=None, description=_NEXT_PAGE_TOKEN_DESCRIPTION)
    path: str
    preview: bool | None = None
    truncated: bool = Field(
        description="Whether operational bounds made the result incomplete, even when no continuation is available."
    )

    @classmethod
    def from_product(cls, response: KnowledgeFSListResponse) -> KnowledgeFSEntryListResponse:
        return cls(
            consistency_class=response.consistency_class,
            data=[KnowledgeFSEntryResponse.from_product_entry(item) for item in response.items],
            has_more=response.next_cursor is not None,
            next_page_token=response.next_cursor,
            path=response.path,
            preview=response.preview,
            truncated=response.truncated,
        )


class KnowledgeFSEntryTreeNodeResponse(KnowledgeFSEntryResponse):
    children: list[KnowledgeFSEntryTreeNodeResponse] | None = None

    @classmethod
    def from_product_tree_node(cls, response: ProductKnowledgeFSTreeNodeResponse) -> KnowledgeFSEntryTreeNodeResponse:
        return cls.model_validate(
            {
                **response.model_dump(mode="python", exclude={"children"}),
                "children": (
                    None
                    if response.children is None
                    else [KnowledgeFSEntryTreeNodeResponse.from_product_tree_node(child) for child in response.children]
                ),
            }
        )


class KnowledgeFSEntryTreeResponse(ResponseModel):
    consistency_class: str | None = Field(default=None, description=_OPEN_RESPONSE_VALUE_DESCRIPTION)
    has_more: bool
    next_page_token: str | None = Field(default=None, description=_NEXT_PAGE_TOKEN_DESCRIPTION)
    path: str
    preview: bool | None = None
    root: KnowledgeFSEntryTreeNodeResponse
    truncated: bool = Field(
        description="Whether operational bounds made the result incomplete, even when no continuation is available."
    )

    @classmethod
    def from_product(cls, response: KnowledgeFSTreeResponse) -> KnowledgeFSEntryTreeResponse:
        return cls(
            consistency_class=response.consistency_class,
            has_more=response.next_cursor is not None,
            next_page_token=response.next_cursor,
            path=response.path,
            preview=response.preview,
            root=KnowledgeFSEntryTreeNodeResponse.from_product_tree_node(response.root),
            truncated=response.truncated,
        )


class KnowledgeFSEntryContentMatchResponse(ResponseModel):
    end_offset: int = Field(ge=0)
    kind: Literal["node", "segment"]
    metadata: dict[str, JsonValue]
    node_id: str | None = None
    path: str
    segment_id: str | None = None
    snippet: str
    start_offset: int = Field(ge=0)

    @classmethod
    def from_product(cls, response: ProductKnowledgeFSGrepMatchResponse) -> KnowledgeFSEntryContentMatchResponse:
        return cls.model_validate(response.model_dump(mode="python"))


class KnowledgeFSEntryContentSearchResponse(ResponseModel):
    data: list[KnowledgeFSEntryContentMatchResponse]
    has_more: bool
    next_page_token: str | None = Field(default=None, description=_NEXT_PAGE_TOKEN_DESCRIPTION)
    path: str
    truncated: bool = Field(
        description="Whether operational bounds made the result incomplete, even when no continuation is available."
    )

    @classmethod
    def from_product(cls, response: KnowledgeFSGrepResponse) -> KnowledgeFSEntryContentSearchResponse:
        return cls(
            data=[KnowledgeFSEntryContentMatchResponse.from_product(match) for match in response.matches],
            has_more=response.next_cursor is not None,
            next_page_token=response.next_cursor,
            path=response.path,
            truncated=response.truncated,
        )


class KnowledgeFSEntryReadContentResponse(ResponseModel):
    content_type: str
    has_more: bool
    next_page_token: str | None = Field(default=None, description=_NEXT_PAGE_TOKEN_DESCRIPTION)
    path: str
    text: str
    truncated: bool = Field(
        description="Whether operational bounds made the content incomplete, even when no continuation is available."
    )

    @classmethod
    def from_product(cls, response: KnowledgeFSCatResponse) -> KnowledgeFSEntryReadContentResponse:
        return cls(
            content_type=response.content_type,
            has_more=response.next_cursor is not None,
            next_page_token=response.next_cursor,
            path=response.path,
            text=response.text,
            truncated=response.truncated,
        )


class KnowledgeFSEntryComparisonOperationResponse(ResponseModel):
    kind: Literal["equal", "insert", "delete"]
    new_end: int | None = Field(default=None, ge=1)
    new_start: int | None = Field(default=None, ge=1)
    old_end: int | None = Field(default=None, ge=1)
    old_start: int | None = Field(default=None, ge=1)
    text: str


class KnowledgeFSEntryComparisonStatsResponse(ResponseModel):
    delete: int = Field(ge=0)
    equal: int = Field(ge=0)
    insert: int = Field(ge=0)


class KnowledgeFSEntrySemanticChangeResponse(ResponseModel):
    category: str
    evidence: list[str]
    summary: str


class KnowledgeFSEntrySemanticSummaryResponse(ResponseModel):
    changes: list[KnowledgeFSEntrySemanticChangeResponse]
    metadata: dict[str, JsonValue]
    model: str | None = None
    summary: str


class KnowledgeFSEntryComparisonResponse(ResponseModel):
    mode: Literal["line", "word"]
    new_path: str
    old_path: str
    operations: list[KnowledgeFSEntryComparisonOperationResponse]
    semantic: KnowledgeFSEntrySemanticSummaryResponse | None = None
    stats: KnowledgeFSEntryComparisonStatsResponse

    @classmethod
    def from_product(cls, response: KnowledgeFSDiffResponse) -> KnowledgeFSEntryComparisonResponse:
        return cls.model_validate(response.model_dump(mode="python"))


class KnowledgeFSEntryMetadataResponse(ResponseModel):
    consistency_class: str | None = Field(default=None, description=_OPEN_RESPONSE_VALUE_DESCRIPTION)
    content_type: str | None = None
    metadata: dict[str, JsonValue]
    parser_status: str | None = Field(default=None, description=_OPEN_RESPONSE_VALUE_DESCRIPTION)
    path: str
    preview: bool | None = None
    resource_type: str = Field(description=_OPEN_RESPONSE_VALUE_DESCRIPTION)
    sha256: str | None = None
    size_bytes: int | None = Field(default=None, ge=0)
    target_id: str
    version: int | None = Field(default=None, ge=1)

    @classmethod
    def from_product(cls, response: KnowledgeFSStatResponse) -> KnowledgeFSEntryMetadataResponse:
        return cls.model_validate(response.model_dump(mode="python"))


register_schema_models(
    openapi_ns,
    KnowledgeFSEntryListQuery,
    KnowledgeFSEntryTreeQuery,
    KnowledgeFSEntryContentSearchQuery,
    KnowledgeFSEntrySearchQuery,
    KnowledgeFSEntryReadContentQuery,
    KnowledgeFSEntryInspectQuery,
    KnowledgeFSEntryComparePayload,
)
register_response_schema_models(
    openapi_ns,
    KnowledgeFSEntryListResponse,
    KnowledgeFSEntryTreeResponse,
    KnowledgeFSEntryContentSearchResponse,
    KnowledgeFSEntryReadContentResponse,
    KnowledgeFSEntryComparisonResponse,
    KnowledgeFSEntryMetadataResponse,
)


def _knowledge_fs_facade() -> KnowledgeFSDataFacade:
    return get_knowledge_fs_runtime(session_factory.get_session_maker()).facade


def _knowledge_fs_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except (KnowledgeFSProductNotFoundError, KnowledgeFSProductResourceNotFoundError) as exc:
            raise KnowledgeFsResourceNotFoundError() from exc
        except KnowledgeFSProductRequestRejectedError as exc:
            if exc.status_code == HTTPStatus.BAD_REQUEST:
                raise KnowledgeFsInvalidRequestError() from exc
            if exc.status_code == HTTPStatus.CONFLICT:
                raise KnowledgeFsConflictError() from exc
            if exc.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE:
                raise KnowledgeFsRequestTooLargeError() from exc
            raise KnowledgeFsRequestRejectedError() from exc
        except PermissionError as exc:
            raise KnowledgeFsAccessDeniedError() from exc
        except (
            KnowledgeFSCapabilityConfigurationError,
            KnowledgeFSOperationUnavailableError,
            KnowledgeFSProductRemoteError,
        ) as exc:
            raise KnowledgeFsUnavailableError() from exc

    return decorated


def _account_id(auth_data: AuthData) -> str:
    return str(auth_data.account_id)


def _facade_args(workspace_id: str, knowledge_space_id: str, auth_data: AuthData) -> dict[str, str]:
    # The OpenAPI resource ID is resolved through Dify's control-plane record.
    # Keeping that implementation name at this adapter boundary prevents it from
    # leaking into the external path and leaves the backing lookup replaceable.
    return {
        "tenant_id": workspace_id,
        "account_id": _account_id(auth_data),
        "control_space_id": knowledge_space_id,
    }


def _list_product_query(query: KnowledgeFSEntryListQuery) -> KnowledgeFSListQuery:
    return KnowledgeFSListQuery(
        path=query.path,
        limit=query.page_size,
        cursor=query.page_token,
        consistency_class=query.consistency_class,
    )


def _tree_product_query(query: KnowledgeFSEntryTreeQuery) -> KnowledgeFSTreeQuery:
    return KnowledgeFSTreeQuery(
        path=query.path,
        limit=query.page_size,
        cursor=query.page_token,
        depth=query.depth,
        consistency_class=query.consistency_class,
    )


def _content_search_product_query(query: KnowledgeFSEntryContentSearchQuery) -> KnowledgeFSGrepQuery:
    return KnowledgeFSGrepQuery(
        path=query.path,
        query=query.text,
        limit=query.page_size,
        cursor=query.page_token,
        timeout_ms=query.timeout_ms,
        consistency_class=query.consistency_class,
    )


def _search_product_query(query: KnowledgeFSEntrySearchQuery) -> KnowledgeFSFindQuery:
    return KnowledgeFSFindQuery(
        path=query.path,
        limit=query.page_size,
        cursor=query.page_token,
        metadata_key=query.metadata_key,
        metadata_value=query.metadata_value,
        name_contains=query.name_contains,
        resource_type=query.resource_type,
        consistency_class=query.consistency_class,
    )


def _compare_product_query(body: KnowledgeFSEntryComparePayload) -> KnowledgeFSDiffQuery:
    return KnowledgeFSDiffQuery(
        old_path=body.old_path,
        new_path=body.new_path,
        mode=body.mode,
        semantic=body.include_semantic_summary,
        consistency_class=body.consistency_class,
    )


def _read_content_product_query(query: KnowledgeFSEntryReadContentQuery) -> KnowledgeFSCatQuery:
    return KnowledgeFSCatQuery(
        path=query.path,
        limit=query.page_size,
        cursor=query.page_token,
        consistency_class=query.consistency_class,
    )


def _inspect_product_query(query: KnowledgeFSEntryInspectQuery) -> KnowledgeFSStatQuery:
    return KnowledgeFSStatQuery(path=query.path, consistency_class=query.consistency_class)


_FS_ROUTE = "/workspaces/<string:workspace_id>/knowledge-fs/knowledge-spaces/<string:knowledge_space_id>/fs"


def _knowledge_fs_operation[**P, R](
    operation_id: str,
    *,
    summary: str,
    description: str,
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """Attach the stable operation identity and complete non-2xx contract."""

    def decorator(view: Callable[P, R]) -> Callable[P, R]:
        documented = openapi_ns.doc(
            operation_id,
            summary=summary,
            description=f"{description} {_READ_SECURITY_DESCRIPTION}",
            params={
                "knowledge_space_id": "Stable Dify knowledge-space resource ID; treat it as opaque.",
                "workspace_id": "Dify workspace ID that owns the knowledge space.",
            },
        )(view)
        for status_code, response_description in _KNOWLEDGE_FS_ERROR_RESPONSES.items():
            documented = openapi_ns.response(
                status_code,
                response_description,
                openapi_ns.models[ErrorBody.__name__],
            )(documented)
        return documented

    return decorator


@openapi_ns.route(f"{_FS_ROUTE}:ls")
class KnowledgeFsEntryListApi(Resource):
    """List direct child entries; default ordering is stable and encoded by the page token."""

    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @_knowledge_fs_operation(
        "ls_knowledge_fs",
        summary="List a KnowledgeFS directory (ls)",
        description=(f"Lists direct child entries under path, equivalent to difyctl fs ls. {_PAGINATION_DESCRIPTION}"),
    )
    @returns(200, KnowledgeFSEntryListResponse, description="Knowledge-space entry page")
    @accepts(query=KnowledgeFSEntryListQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        knowledge_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSEntryListQuery,
    ) -> KnowledgeFSEntryListResponse:
        response = _knowledge_fs_facade().list_knowledge_fs(
            **_facade_args(workspace_id, knowledge_space_id, auth_data),
            query=_list_product_query(query),
        )
        return KnowledgeFSEntryListResponse.from_product(response)


@openapi_ns.route(f"{_FS_ROUTE}:tree")
class KnowledgeFsEntryTreeApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @_knowledge_fs_operation(
        "tree_knowledge_fs",
        summary="Traverse a KnowledgeFS directory (tree)",
        description=(
            f"Returns a depth- and page-size-bounded tree rooted at path, equivalent to difyctl fs tree. "
            f"{_PAGINATION_DESCRIPTION}"
        ),
    )
    @returns(200, KnowledgeFSEntryTreeResponse, description="Knowledge-space entry tree")
    @accepts(query=KnowledgeFSEntryTreeQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        knowledge_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSEntryTreeQuery,
    ) -> KnowledgeFSEntryTreeResponse:
        response = _knowledge_fs_facade().tree_knowledge_fs(
            **_facade_args(workspace_id, knowledge_space_id, auth_data),
            query=_tree_product_query(query),
        )
        return KnowledgeFSEntryTreeResponse.from_product(response)


@openapi_ns.route(f"{_FS_ROUTE}:grep")
class KnowledgeFsEntryContentSearchApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @_knowledge_fs_operation(
        "grep_knowledge_fs",
        summary="Search KnowledgeFS content (grep)",
        description=(
            "Searches readable content beneath path, equivalent to difyctl fs grep. Matches follow canonical entry "
            f"traversal order and source-offset order within each entry. {_PAGINATION_DESCRIPTION}"
        ),
    )
    @returns(200, KnowledgeFSEntryContentSearchResponse, description="Knowledge-space content matches")
    @accepts(query=KnowledgeFSEntryContentSearchQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        knowledge_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSEntryContentSearchQuery,
    ) -> KnowledgeFSEntryContentSearchResponse:
        response = _knowledge_fs_facade().grep_knowledge_fs(
            **_facade_args(workspace_id, knowledge_space_id, auth_data),
            query=_content_search_product_query(query),
        )
        return KnowledgeFSEntryContentSearchResponse.from_product(response)


@openapi_ns.route(f"{_FS_ROUTE}:find")
class KnowledgeFsEntrySearchApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @_knowledge_fs_operation(
        "find_knowledge_fs",
        summary="Find KnowledgeFS entries (find)",
        description=(
            "Searches entries beneath path by name, resource type, or an exact metadata key/value pair, equivalent "
            "to difyctl fs find. "
            f"{_PAGINATION_DESCRIPTION}"
        ),
    )
    @returns(200, KnowledgeFSEntryListResponse, description="Knowledge-space entry search results")
    @accepts(query=KnowledgeFSEntrySearchQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        knowledge_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSEntrySearchQuery,
    ) -> KnowledgeFSEntryListResponse:
        response = _knowledge_fs_facade().find_knowledge_fs(
            **_facade_args(workspace_id, knowledge_space_id, auth_data),
            query=_search_product_query(query),
        )
        return KnowledgeFSEntryListResponse.from_product(response)


@openapi_ns.route(f"{_FS_ROUTE}:diff")
class KnowledgeFsEntryCompareApi(Resource):
    """Side-effect-free comparison query; semantic summaries can consume model quota on every retry."""

    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @_knowledge_fs_operation(
        "diff_knowledge_fs",
        summary="Compare two KnowledgeFS entries (diff)",
        description=(
            "Performs a side-effect-free comparison, equivalent to difyctl fs diff. POST is used because this is a "
            "structured query and an optional semantic summary can consume model quota. Automatic retries are not safe "
            "when include_semantic_summary=true because each retry can consume quota again."
        ),
    )
    @returns(200, KnowledgeFSEntryComparisonResponse, description="Knowledge-space entry comparison")
    @accepts(body=KnowledgeFSEntryComparePayload)
    @_knowledge_fs_errors
    def post(
        self,
        workspace_id: str,
        knowledge_space_id: str,
        *,
        auth_data: AuthData,
        body: KnowledgeFSEntryComparePayload,
    ) -> KnowledgeFSEntryComparisonResponse:
        response = _knowledge_fs_facade().diff_knowledge_fs(
            **_facade_args(workspace_id, knowledge_space_id, auth_data),
            query=_compare_product_query(body),
        )
        return KnowledgeFSEntryComparisonResponse.from_product(response)


@openapi_ns.route(f"{_FS_ROUTE}:cat")
class KnowledgeFsEntryReadContentApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @_knowledge_fs_operation(
        "cat_knowledge_fs",
        summary="Read KnowledgeFS entry content (cat)",
        description=(
            f"Reads a bounded text portion of one entry, equivalent to difyctl fs cat. "
            f"{_CONTENT_CONTINUATION_DESCRIPTION}"
        ),
    )
    @returns(200, KnowledgeFSEntryReadContentResponse, description="Knowledge-space entry content")
    @accepts(query=KnowledgeFSEntryReadContentQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        knowledge_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSEntryReadContentQuery,
    ) -> KnowledgeFSEntryReadContentResponse:
        response = _knowledge_fs_facade().cat_knowledge_fs(
            **_facade_args(workspace_id, knowledge_space_id, auth_data),
            query=_read_content_product_query(query),
        )
        return KnowledgeFSEntryReadContentResponse.from_product(response)


@openapi_ns.route(f"{_FS_ROUTE}:stat")
class KnowledgeFsEntryInspectApi(Resource):
    @auth_router.guard_workspace(
        scope=Scope.WORKSPACE_READ,
        allowed_token_types=frozenset({TokenType.OAUTH_ACCOUNT}),
    )
    @_knowledge_fs_operation(
        "stat_knowledge_fs",
        summary="Inspect a KnowledgeFS entry (stat)",
        description=(
            "Returns stable metadata for one entry selected by canonical virtual path without reading content, "
            "equivalent to difyctl fs stat."
        ),
    )
    @returns(200, KnowledgeFSEntryMetadataResponse, description="Knowledge-space entry metadata")
    @accepts(query=KnowledgeFSEntryInspectQuery)
    @_knowledge_fs_errors
    def get(
        self,
        workspace_id: str,
        knowledge_space_id: str,
        *,
        auth_data: AuthData,
        query: KnowledgeFSEntryInspectQuery,
    ) -> KnowledgeFSEntryMetadataResponse:
        response = _knowledge_fs_facade().stat_knowledge_fs(
            **_facade_args(workspace_id, knowledge_space_id, auth_data),
            query=_inspect_product_query(query),
        )
        return KnowledgeFSEntryMetadataResponse.from_product(response)


__all__ = [
    "KnowledgeFsEntryCompareApi",
    "KnowledgeFsEntryContentSearchApi",
    "KnowledgeFsEntryInspectApi",
    "KnowledgeFsEntryListApi",
    "KnowledgeFsEntryReadContentApi",
    "KnowledgeFsEntrySearchApi",
    "KnowledgeFsEntryTreeApi",
]
