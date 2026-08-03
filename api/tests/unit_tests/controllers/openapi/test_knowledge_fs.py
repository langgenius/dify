from __future__ import annotations

import inspect
import uuid
from unittest.mock import Mock

import pytest
from flask import Flask
from pydantic import BaseModel, ValidationError

from controllers.openapi import bp as openapi_bp
from controllers.openapi.auth.data import AuthData


def _route(app: Flask, path: str):
    return next(rule for rule in app.url_map.iter_rules() if rule.rule == path)


def test_each_knowledge_fs_command_has_its_own_command_oriented_openapi_route() -> None:
    from controllers.openapi.knowledge_fs import (
        KnowledgeFsEntryCompareApi,
        KnowledgeFsEntryContentSearchApi,
        KnowledgeFsEntryInspectApi,
        KnowledgeFsEntryListApi,
        KnowledgeFsEntryReadContentApi,
        KnowledgeFsEntrySearchApi,
        KnowledgeFsEntryTreeApi,
    )

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    prefix = "/openapi/v1/workspaces/<string:workspace_id>/knowledge-fs/knowledge-spaces/<string:knowledge_space_id>/fs"
    expected = {
        f"{prefix}:cat": (KnowledgeFsEntryReadContentApi, "GET"),
        f"{prefix}:diff": (KnowledgeFsEntryCompareApi, "POST"),
        f"{prefix}:find": (KnowledgeFsEntrySearchApi, "GET"),
        f"{prefix}:grep": (KnowledgeFsEntryContentSearchApi, "GET"),
        f"{prefix}:ls": (KnowledgeFsEntryListApi, "GET"),
        f"{prefix}:stat": (KnowledgeFsEntryInspectApi, "GET"),
        f"{prefix}:tree": (KnowledgeFsEntryTreeApi, "GET"),
    }

    for path, (view_class, method) in expected.items():
        rule = _route(app, path)
        assert app.view_functions[rule.endpoint].view_class is view_class
        assert method in rule.methods

    registered_paths = {rule.rule for rule in app.url_map.iter_rules()}
    assert not any("/knowledge-fs/spaces/" in path or "/entries" in path for path in registered_paths)


def test_list_controller_adapts_public_pagination_to_the_product_operation(monkeypatch) -> None:
    from controllers.openapi import knowledge_fs as module
    from controllers.openapi.knowledge_fs import KnowledgeFsEntryListApi
    from services.knowledge_fs.product_dto import KnowledgeFSListResponse

    facade = Mock()
    facade.list_knowledge_fs.return_value = KnowledgeFSListResponse.model_validate(
        {
            "items": [],
            "nextCursor": "opaque-next-page",
            "path": "/knowledge",
            "truncated": True,
        }
    )
    monkeypatch.setattr(module, "_knowledge_fs_facade", lambda: facade)
    account_id = uuid.uuid4()
    api = KnowledgeFsEntryListApi()
    app = Flask(__name__)

    with app.test_request_context(
        "/openapi/v1/workspaces/workspace-1/knowledge-fs/knowledge-spaces/space-1/fs:ls"
        "?path=/knowledge&page_size=25&page_token=opaque-page&consistency_class=path-consistent",
        method="GET",
    ):
        body, status = api.get.__wrapped__(
            api,
            workspace_id="workspace-1",
            knowledge_space_id="space-1",
            auth_data=AuthData.model_construct(account_id=account_id),
        )

    assert status == 200
    assert body == {
        "consistency_class": None,
        "data": [],
        "has_more": True,
        "next_page_token": "opaque-next-page",
        "path": "/knowledge",
        "preview": None,
        "truncated": True,
    }
    facade.list_knowledge_fs.assert_called_once()
    call = facade.list_knowledge_fs.call_args.kwargs
    assert call["tenant_id"] == "workspace-1"
    assert call["account_id"] == str(account_id)
    assert call["control_space_id"] == "space-1"
    assert call["query"].path == "/knowledge"
    assert call["query"].limit == 25
    assert call["query"].cursor == "opaque-page"
    assert call["query"].consistency_class == "path-consistent"


@pytest.mark.parametrize(
    "incomplete_filter",
    [{"metadata_key": "owner"}, {"metadata_value": "legal"}],
)
def test_entry_search_requires_a_complete_metadata_pair(incomplete_filter: dict[str, str]) -> None:
    from controllers.openapi.knowledge_fs import KnowledgeFSEntrySearchQuery

    with pytest.raises(ValidationError, match="must be supplied together"):
        KnowledgeFSEntrySearchQuery.model_validate({"path": "/knowledge", **incomplete_filter})


@pytest.mark.parametrize(
    ("api_name", "method_name", "public_query", "facade_method", "product_query_type", "expected_fields"),
    [
        (
            "KnowledgeFsEntryTreeApi",
            "get",
            {"path": "/knowledge", "page_size": 12, "page_token": "page", "depth": 3},
            "tree_knowledge_fs",
            "KnowledgeFSTreeQuery",
            {"path": "/knowledge", "limit": 12, "cursor": "page", "depth": 3},
        ),
        (
            "KnowledgeFsEntryContentSearchApi",
            "get",
            {"path": "/knowledge", "text": "TODO", "page_size": 10, "timeout_ms": 500},
            "grep_knowledge_fs",
            "KnowledgeFSGrepQuery",
            {"path": "/knowledge", "query": "TODO", "limit": 10, "timeout_ms": 500},
        ),
        (
            "KnowledgeFsEntrySearchApi",
            "get",
            {"path": "/knowledge", "name_contains": "readme", "resource_type": "document"},
            "find_knowledge_fs",
            "KnowledgeFSFindQuery",
            {"path": "/knowledge", "name_contains": "readme", "resource_type": "document"},
        ),
        (
            "KnowledgeFsEntryCompareApi",
            "post",
            {
                "old_path": "/knowledge/old.md",
                "new_path": "/knowledge/new.md",
                "mode": "word",
                "include_semantic_summary": True,
            },
            "diff_knowledge_fs",
            "KnowledgeFSDiffQuery",
            {
                "old_path": "/knowledge/old.md",
                "new_path": "/knowledge/new.md",
                "mode": "word",
                "semantic": True,
            },
        ),
        (
            "KnowledgeFsEntryReadContentApi",
            "get",
            {"path": "/knowledge/readme.md", "page_size": 40, "page_token": "page"},
            "cat_knowledge_fs",
            "KnowledgeFSCatQuery",
            {"path": "/knowledge/readme.md", "limit": 40, "cursor": "page"},
        ),
        (
            "KnowledgeFsEntryInspectApi",
            "get",
            {"path": "/knowledge/readme.md"},
            "stat_knowledge_fs",
            "KnowledgeFSStatQuery",
            {"path": "/knowledge/readme.md"},
        ),
    ],
)
def test_each_custom_interface_delegates_with_an_internal_product_query(
    monkeypatch: pytest.MonkeyPatch,
    api_name: str,
    method_name: str,
    public_query: dict[str, object],
    facade_method: str,
    product_query_type: str,
    expected_fields: dict[str, object],
) -> None:
    from controllers.openapi import knowledge_fs as module
    from services.knowledge_fs import product_dto

    facade = Mock()
    product_responses = {
        "tree_knowledge_fs": product_dto.KnowledgeFSTreeResponse.model_validate(
            {
                "path": "/knowledge",
                "root": {"kind": "directory", "metadata": {}, "name": "knowledge", "path": "/knowledge"},
                "truncated": False,
            }
        ),
        "grep_knowledge_fs": product_dto.KnowledgeFSGrepResponse(matches=[], path="/knowledge", truncated=False),
        "find_knowledge_fs": product_dto.KnowledgeFSListResponse(items=[], path="/knowledge", truncated=False),
        "diff_knowledge_fs": product_dto.KnowledgeFSDiffResponse.model_validate(
            {
                "mode": "word",
                "new_path": "/knowledge/new.md",
                "old_path": "/knowledge/old.md",
                "operations": [],
                "stats": {"delete": 0, "equal": 0, "insert": 0},
            }
        ),
        "cat_knowledge_fs": product_dto.KnowledgeFSCatResponse(
            content_type="text/markdown", path="/knowledge/readme.md", text="hello", truncated=False
        ),
        "stat_knowledge_fs": product_dto.KnowledgeFSStatResponse.model_validate(
            {
                "metadata": {},
                "path": "/knowledge/readme.md",
                "resource_type": "document",
                "target_id": "document-1",
            }
        ),
    }
    getattr(facade, facade_method).return_value = product_responses[facade_method]
    monkeypatch.setattr(module, "_knowledge_fs_facade", lambda: facade)
    account_id = uuid.uuid4()
    api_class = getattr(module, api_name)
    public_model_name = {
        "KnowledgeFsEntryTreeApi": "KnowledgeFSEntryTreeQuery",
        "KnowledgeFsEntryContentSearchApi": "KnowledgeFSEntryContentSearchQuery",
        "KnowledgeFsEntrySearchApi": "KnowledgeFSEntrySearchQuery",
        "KnowledgeFsEntryCompareApi": "KnowledgeFSEntryComparePayload",
        "KnowledgeFsEntryReadContentApi": "KnowledgeFSEntryReadContentQuery",
        "KnowledgeFsEntryInspectApi": "KnowledgeFSEntryInspectQuery",
    }[api_name]
    public_model = getattr(module, public_model_name).model_validate(public_query)

    result = inspect.unwrap(getattr(api_class, method_name))(
        api_class(),
        workspace_id="workspace-1",
        knowledge_space_id="space-1",
        auth_data=AuthData.model_construct(account_id=account_id),
        **({"body": public_model} if method_name == "post" else {"query": public_model}),
    )

    assert isinstance(result, BaseModel)
    getattr(facade, facade_method).assert_called_once()
    call = getattr(facade, facade_method).call_args.kwargs
    assert call["tenant_id"] == "workspace-1"
    assert call["account_id"] == str(account_id)
    assert call["control_space_id"] == "space-1"
    assert isinstance(call["query"], getattr(product_dto, product_query_type))
    for field, value in expected_fields.items():
        assert getattr(call["query"], field) == value


def test_knowledge_fs_facade_uses_the_configured_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.openapi import knowledge_fs as module

    session_maker = object()
    facade = object()
    get_runtime = Mock(return_value=Mock(facade=facade))
    monkeypatch.setattr(module.session_factory, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(module, "get_knowledge_fs_runtime", get_runtime)

    assert module._knowledge_fs_facade() is facade
    get_runtime.assert_called_once_with(session_maker)


def test_knowledge_fs_error_adapter_uses_stable_domain_errors() -> None:
    from controllers.openapi import knowledge_fs as module
    from controllers.openapi._errors import (
        KnowledgeFsAccessDeniedError,
        KnowledgeFsConflictError,
        KnowledgeFsInvalidRequestError,
        KnowledgeFsRequestRejectedError,
        KnowledgeFsRequestTooLargeError,
        KnowledgeFsResourceNotFoundError,
        KnowledgeFsUnavailableError,
    )
    from services.knowledge_fs.product_authorization import KnowledgeFSProductNotFoundError
    from services.knowledge_fs.product_remote import (
        KnowledgeFSOperationUnavailableError,
        KnowledgeFSProductRemoteError,
        KnowledgeFSProductRequestRejectedError,
        KnowledgeFSProductResourceNotFoundError,
    )
    from services.knowledge_fs_capability import KnowledgeFSCapabilityConfigurationError

    mappings = (
        (KnowledgeFSProductNotFoundError("hidden"), KnowledgeFsResourceNotFoundError),
        (KnowledgeFSProductResourceNotFoundError("missing"), KnowledgeFsResourceNotFoundError),
        (KnowledgeFSProductRequestRejectedError(status_code=400), KnowledgeFsInvalidRequestError),
        (KnowledgeFSProductRequestRejectedError(status_code=409), KnowledgeFsConflictError),
        (KnowledgeFSProductRequestRejectedError(status_code=413), KnowledgeFsRequestTooLargeError),
        (KnowledgeFSProductRequestRejectedError(status_code=422), KnowledgeFsRequestRejectedError),
        (PermissionError("forbidden"), KnowledgeFsAccessDeniedError),
        (KnowledgeFSCapabilityConfigurationError("misconfigured"), KnowledgeFsUnavailableError),
        (KnowledgeFSOperationUnavailableError("unavailable"), KnowledgeFsUnavailableError),
        (KnowledgeFSProductRemoteError("upstream"), KnowledgeFsUnavailableError),
    )

    for domain_error, openapi_error in mappings:
        fail = module._knowledge_fs_errors(Mock(side_effect=domain_error))

        with pytest.raises(openapi_error):
            fail()
