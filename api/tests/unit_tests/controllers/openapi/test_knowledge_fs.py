from __future__ import annotations

import inspect
import uuid
from unittest.mock import Mock

import pytest
from flask import Flask

from controllers.openapi import bp as openapi_bp
from controllers.openapi.auth.data import AuthData


def _route(app: Flask, path: str):
    return next(rule for rule in app.url_map.iter_rules() if rule.rule == path)


def test_each_knowledge_fs_command_has_its_own_openapi_route() -> None:
    from controllers.openapi.knowledge_fs import (
        KnowledgeFsCatApi,
        KnowledgeFsDiffApi,
        KnowledgeFsFindApi,
        KnowledgeFsGrepApi,
        KnowledgeFsListApi,
        KnowledgeFsStatApi,
        KnowledgeFsTreeApi,
    )

    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    prefix = "/openapi/v1/workspaces/<string:workspace_id>/knowledge-fs/spaces/<string:control_space_id>/fs"
    expected = {
        f"{prefix}/cat": KnowledgeFsCatApi,
        f"{prefix}/diff": KnowledgeFsDiffApi,
        f"{prefix}/find": KnowledgeFsFindApi,
        f"{prefix}/grep": KnowledgeFsGrepApi,
        f"{prefix}/ls": KnowledgeFsListApi,
        f"{prefix}/stat": KnowledgeFsStatApi,
        f"{prefix}/tree": KnowledgeFsTreeApi,
    }

    for path, view_class in expected.items():
        rule = _route(app, path)
        assert app.view_functions[rule.endpoint].view_class is view_class
        assert "GET" in rule.methods


def test_list_controller_forwards_its_validated_query_to_the_list_operation(monkeypatch) -> None:
    from controllers.openapi import knowledge_fs as module
    from controllers.openapi.knowledge_fs import KnowledgeFsListApi
    from services.knowledge_fs.product_dto import KnowledgeFSListResponse

    facade = Mock()
    facade.list_knowledge_fs.return_value = KnowledgeFSListResponse.model_validate(
        {
            "items": [],
            "path": "/knowledge",
            "truncated": False,
        }
    )
    monkeypatch.setattr(module, "_knowledge_fs_facade", lambda: facade)
    account_id = uuid.uuid4()
    api = KnowledgeFsListApi()
    app = Flask(__name__)

    with app.test_request_context(
        "/openapi/v1/workspaces/workspace-1/knowledge-fs/spaces/control-1/fs/ls"
        "?path=/knowledge&limit=25&consistency_class=path-consistent",
        method="GET",
    ):
        body, status = api.get.__wrapped__(
            api,
            workspace_id="workspace-1",
            control_space_id="control-1",
            auth_data=AuthData.model_construct(account_id=account_id),
        )

    assert status == 200
    assert body == {
        "consistency_class": None,
        "items": [],
        "next_cursor": None,
        "path": "/knowledge",
        "preview": None,
        "truncated": False,
    }
    facade.list_knowledge_fs.assert_called_once()
    call = facade.list_knowledge_fs.call_args.kwargs
    assert call["tenant_id"] == "workspace-1"
    assert call["account_id"] == str(account_id)
    assert call["control_space_id"] == "control-1"
    assert call["query"].path == "/knowledge"
    assert call["query"].limit == 25
    assert call["query"].consistency_class == "path-consistent"


@pytest.mark.parametrize(
    ("api_name", "facade_method"),
    [
        ("KnowledgeFsListApi", "list_knowledge_fs"),
        ("KnowledgeFsTreeApi", "tree_knowledge_fs"),
        ("KnowledgeFsGrepApi", "grep_knowledge_fs"),
        ("KnowledgeFsFindApi", "find_knowledge_fs"),
        ("KnowledgeFsDiffApi", "diff_knowledge_fs"),
        ("KnowledgeFsCatApi", "cat_knowledge_fs"),
        ("KnowledgeFsStatApi", "stat_knowledge_fs"),
    ],
)
def test_each_controller_delegates_to_its_command_specific_facade_method(
    monkeypatch: pytest.MonkeyPatch,
    api_name: str,
    facade_method: str,
) -> None:
    from controllers.openapi import knowledge_fs as module

    facade = Mock()
    expected = object()
    getattr(facade, facade_method).return_value = expected
    monkeypatch.setattr(module, "_knowledge_fs_facade", lambda: facade)
    account_id = uuid.uuid4()
    query = object()
    api_class = getattr(module, api_name)

    result = inspect.unwrap(api_class.get)(
        api_class(),
        workspace_id="workspace-1",
        control_space_id="control-1",
        auth_data=AuthData.model_construct(account_id=account_id),
        query=query,
    )

    assert result is expected
    getattr(facade, facade_method).assert_called_once_with(
        tenant_id="workspace-1",
        account_id=str(account_id),
        control_space_id="control-1",
        query=query,
    )


def test_knowledge_fs_facade_uses_the_configured_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    from controllers.openapi import knowledge_fs as module

    session_maker = object()
    facade = object()
    get_runtime = Mock(return_value=Mock(facade=facade))
    monkeypatch.setattr(module.session_factory, "get_session_maker", lambda: session_maker)
    monkeypatch.setattr(module, "get_knowledge_fs_runtime", get_runtime)

    assert module._knowledge_fs_facade() is facade
    get_runtime.assert_called_once_with(session_maker)


def test_knowledge_fs_error_adapter_preserves_the_openapi_http_contract() -> None:
    from werkzeug.exceptions import (
        BadRequest,
        Conflict,
        Forbidden,
        NotFound,
        RequestEntityTooLarge,
        ServiceUnavailable,
        UnprocessableEntity,
    )

    from controllers.openapi import knowledge_fs as module
    from services.knowledge_fs.product_authorization import KnowledgeFSProductNotFoundError
    from services.knowledge_fs.product_remote import (
        KnowledgeFSOperationUnavailableError,
        KnowledgeFSProductRemoteError,
        KnowledgeFSProductRequestRejectedError,
        KnowledgeFSProductResourceNotFoundError,
    )
    from services.knowledge_fs_capability import KnowledgeFSCapabilityConfigurationError

    mappings = (
        (KnowledgeFSProductNotFoundError("hidden"), NotFound),
        (KnowledgeFSProductResourceNotFoundError("missing"), NotFound),
        (KnowledgeFSProductRequestRejectedError(status_code=400), BadRequest),
        (KnowledgeFSProductRequestRejectedError(status_code=409), Conflict),
        (KnowledgeFSProductRequestRejectedError(status_code=413), RequestEntityTooLarge),
        (KnowledgeFSProductRequestRejectedError(status_code=422), UnprocessableEntity),
        (PermissionError("forbidden"), Forbidden),
        (KnowledgeFSCapabilityConfigurationError("misconfigured"), ServiceUnavailable),
        (KnowledgeFSOperationUnavailableError("unavailable"), ServiceUnavailable),
        (KnowledgeFSProductRemoteError("upstream"), ServiceUnavailable),
    )

    for domain_error, http_error in mappings:
        fail = module._knowledge_fs_errors(Mock(side_effect=domain_error))

        with pytest.raises(http_error):
            fail()
