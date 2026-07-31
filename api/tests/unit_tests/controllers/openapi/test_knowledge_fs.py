from __future__ import annotations

import uuid
from unittest.mock import Mock

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
