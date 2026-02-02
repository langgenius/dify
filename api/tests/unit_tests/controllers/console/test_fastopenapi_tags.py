import builtins
import contextlib
import importlib
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from flask.views import MethodView

from extensions import ext_fastopenapi
from extensions.ext_database import db


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.config["SECRET_KEY"] = "test-secret"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

    db.init_app(app)

    return app


@pytest.fixture(autouse=True)
def fix_method_view_issue(monkeypatch):
    if not hasattr(builtins, "MethodView"):
        monkeypatch.setattr(builtins, "MethodView", MethodView, raising=False)


def _create_isolated_router():
    import controllers.fastopenapi

    router_class = type(controllers.fastopenapi.console_router)
    return router_class()


@contextlib.contextmanager
def _patch_auth_and_router(temp_router):
    def noop(func):
        return func

    default_user = MagicMock(has_edit_permission=True, is_dataset_editor=False)

    with (
        patch("controllers.fastopenapi.console_router", temp_router),
        patch("extensions.ext_fastopenapi.console_router", temp_router),
        patch("controllers.console.wraps.setup_required", side_effect=noop),
        patch("libs.login.login_required", side_effect=noop),
        patch("controllers.console.wraps.account_initialization_required", side_effect=noop),
        patch("controllers.console.wraps.edit_permission_required", side_effect=noop),
        patch("libs.login.current_account_with_tenant", return_value=(default_user, "tenant-id")),
        patch("configs.dify_config.EDITION", "CLOUD"),
    ):
        import extensions.ext_fastopenapi

        importlib.reload(extensions.ext_fastopenapi)

        yield


def _force_reload_module(target_module: str, alias_module: str):
    if target_module in sys.modules:
        del sys.modules[target_module]
    if alias_module in sys.modules:
        del sys.modules[alias_module]

    module = importlib.import_module(target_module)
    sys.modules[alias_module] = sys.modules[target_module]

    return module


def _dedupe_routes(router):
    seen = set()
    unique_routes = []
    for path, method, endpoint in reversed(router.get_routes()):
        key = (path, method, endpoint.__name__)
        if key in seen:
            continue
        seen.add(key)
        unique_routes.append((path, method, endpoint))
    router._routes = list(reversed(unique_routes))


def _cleanup_modules(target_module: str, alias_module: str):
    if target_module in sys.modules:
        del sys.modules[target_module]
    if alias_module in sys.modules:
        del sys.modules[alias_module]


@pytest.fixture
def mock_tags_module_env():
    target_module = "controllers.console.tag.tags"
    alias_module = "api.controllers.console.tag.tags"
    temp_router = _create_isolated_router()

    try:
        with _patch_auth_and_router(temp_router):
            tags_module = _force_reload_module(target_module, alias_module)
            _dedupe_routes(temp_router)
            yield tags_module
    finally:
        _cleanup_modules(target_module, alias_module)


def test_list_tags_success(app: Flask, mock_tags_module_env):
    # Arrange
    tag = SimpleNamespace(id="tag-1", name="Alpha", type="app", binding_count=2)
    with patch("controllers.console.tag.tags.TagService.get_tags", return_value=[tag]):
        ext_fastopenapi.init_app(app)
        client = app.test_client()

        # Act
        response = client.get("/console/api/tags?type=app&keyword=Alpha")

    # Assert
    assert response.status_code == 200
    assert response.get_json() == [
        {"id": "tag-1", "name": "Alpha", "type": "app", "binding_count": 2},
    ]


def test_create_tag_success(app: Flask, mock_tags_module_env):
    # Arrange
    tag = SimpleNamespace(id="tag-2", name="Beta", type="app")
    with patch("controllers.console.tag.tags.TagService.save_tags", return_value=tag) as mock_save:
        ext_fastopenapi.init_app(app)
        client = app.test_client()

        # Act
        response = client.post("/console/api/tags", json={"name": "Beta", "type": "app"})

    # Assert
    assert response.status_code == 200
    assert response.get_json() == {
        "id": "tag-2",
        "name": "Beta",
        "type": "app",
        "binding_count": 0,
    }
    mock_save.assert_called_once_with({"name": "Beta", "type": "app"})


def test_update_tag_success(app: Flask, mock_tags_module_env):
    # Arrange
    tag = SimpleNamespace(id="tag-3", name="Gamma", type="app")
    with (
        patch("controllers.console.tag.tags.TagService.update_tags", return_value=tag) as mock_update,
        patch("controllers.console.tag.tags.TagService.get_tag_binding_count", return_value=4),
    ):
        ext_fastopenapi.init_app(app)
        client = app.test_client()

        # Act
        response = client.patch(
            "/console/api/tags/11111111-1111-1111-1111-111111111111",
            json={"name": "Gamma", "type": "app"},
        )

    # Assert
    assert response.status_code == 200
    assert response.get_json() == {
        "id": "tag-3",
        "name": "Gamma",
        "type": "app",
        "binding_count": 4,
    }
    mock_update.assert_called_once_with(
        {"name": "Gamma", "type": "app"},
        "11111111-1111-1111-1111-111111111111",
    )


def test_delete_tag_success(app: Flask, mock_tags_module_env):
    # Arrange
    with patch("controllers.console.tag.tags.TagService.delete_tag") as mock_delete:
        ext_fastopenapi.init_app(app)
        client = app.test_client()

        # Act
        response = client.delete("/console/api/tags/11111111-1111-1111-1111-111111111111")

    # Assert
    assert response.status_code == 204
    mock_delete.assert_called_once_with("11111111-1111-1111-1111-111111111111")


def test_create_tag_binding_success(app: Flask, mock_tags_module_env):
    # Arrange
    payload = {"tag_ids": ["tag-1", "tag-2"], "target_id": "target-1", "type": "app"}
    with patch("controllers.console.tag.tags.TagService.save_tag_binding") as mock_bind:
        ext_fastopenapi.init_app(app)
        client = app.test_client()

        # Act
        response = client.post("/console/api/tag-bindings/create", json=payload)

    # Assert
    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    mock_bind.assert_called_once_with(payload)


def test_delete_tag_binding_success(app: Flask, mock_tags_module_env):
    # Arrange
    payload = {"tag_id": "tag-1", "target_id": "target-1", "type": "app"}
    with patch("controllers.console.tag.tags.TagService.delete_tag_binding") as mock_unbind:
        ext_fastopenapi.init_app(app)
        client = app.test_client()

        # Act
        response = client.post("/console/api/tag-bindings/remove", json=payload)

    # Assert
    assert response.status_code == 200
    assert response.get_json() == {"result": "success"}
    mock_unbind.assert_called_once_with(payload)
