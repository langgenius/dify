import contextlib
import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import pytest
from fastopenapi.routers import FlaskRouter
from flask import Flask


def _create_isolated_router():
    import controllers.fastopenapi

    router_class = type(controllers.fastopenapi.console_router)
    return router_class()


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


def _noop_decorator(func):
    return func


def _noop_factory(*_args, **_kwargs):
    def decorator(func):
        return func

    return decorator


@contextlib.contextmanager
def _fake_console_wraps_module():
    """
    Avoid importing `controllers.console.__init__` (which imports many modules and would register routes
    before we can patch decorators).
    """
    keys = ("controllers.console", "controllers.console.app", "controllers.console.wraps")
    saved = {k: sys.modules.get(k) for k in keys}

    console_pkg = ModuleType("controllers.console")
    console_pkg.__path__ = []  # mark as package

    app_pkg = ModuleType("controllers.console.app")
    app_pkg.__path__ = []  # mark as package

    wraps_mod = ModuleType("controllers.console.wraps")
    wraps_mod.setup_required = _noop_decorator
    wraps_mod.login_required = _noop_decorator
    wraps_mod.account_initialization_required = _noop_decorator
    wraps_mod.edit_permission_required = _noop_decorator
    wraps_mod.annotation_import_rate_limit = _noop_decorator
    wraps_mod.annotation_import_concurrency_limit = _noop_decorator
    wraps_mod.cloud_edition_billing_resource_check = _noop_factory

    sys.modules["controllers.console"] = console_pkg
    sys.modules["controllers.console.app"] = app_pkg
    sys.modules["controllers.console.wraps"] = wraps_mod
    try:
        yield
    finally:
        for key, module in saved.items():
            if module is None:
                sys.modules.pop(key, None)
            else:
                sys.modules[key] = module


def _load_annotation_module_from_file() -> ModuleType:
    module_name = "controllers.console.app.annotation"
    sys.modules.pop(module_name, None)
    module_path = Path(__file__).resolve().parents[5] / "controllers" / "console" / "app" / "annotation.py"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True
    flask_app.config["SECRET_KEY"] = "test-secret"
    return flask_app


@pytest.fixture
def client(app):
    temp_router = _create_isolated_router()

    with (
        patch("controllers.fastopenapi.console_router", temp_router),
        patch("libs.login.login_required", side_effect=_noop_decorator),
        _fake_console_wraps_module(),
    ):
        _load_annotation_module_from_file()
        _dedupe_routes(temp_router)

        router = FlaskRouter(app=app, docs_url=None, redoc_url=None, openapi_url=None)
        router.include_router(temp_router, prefix="/console/api")
        yield app.test_client()


def test_get_annotation_setting_disabled_returns_minimal_payload(client):
    app_id = "11111111-1111-1111-1111-111111111111"
    with patch(
        "controllers.console.app.annotation.AppAnnotationService.get_app_annotation_setting_by_app_id",
        return_value={"enabled": False},
    ):
        resp = client.get(f"/console/api/apps/{app_id}/annotation-setting")

    assert resp.status_code == 200
    assert resp.get_json() == {"enabled": False}


def test_annotation_reply_action_enable_success(client):
    app_id = "11111111-1111-1111-1111-111111111111"
    with patch(
        "controllers.console.app.annotation.AppAnnotationService.enable_app_annotation",
        return_value={"job_id": "job-1", "job_status": "waiting"},
    ):
        resp = client.post(
            f"/console/api/apps/{app_id}/annotation-reply/enable",
            json={
                "score_threshold": 0.5,
                "embedding_provider_name": "provider",
                "embedding_model_name": "model",
            },
        )

    assert resp.status_code == 200
    assert resp.get_json() == {"job_id": "job-1", "job_status": "waiting"}


def test_list_annotations_success(client):
    app_id = "11111111-1111-1111-1111-111111111111"
    annotation = SimpleNamespace(
        id="ann-1",
        question="Q",
        content="A",
        hit_count=3,
        created_at=1700000000,
    )
    with patch(
        "controllers.console.app.annotation.AppAnnotationService.get_annotation_list_by_app_id",
        return_value=([annotation], 1),
    ):
        resp = client.get(f"/console/api/apps/{app_id}/annotations?page=1&limit=20&keyword=")

    assert resp.status_code == 200
    assert resp.get_json() == {
        "data": [{"id": "ann-1", "question": "Q", "answer": "A", "hit_count": 3, "created_at": 1700000000}],
        "has_more": False,
        "limit": 20,
        "total": 1,
        "page": 1,
    }


def test_delete_annotations_batch_uses_payload(client):
    app_id = "11111111-1111-1111-1111-111111111111"
    with patch(
        "controllers.console.app.annotation.AppAnnotationService.delete_app_annotations_in_batch",
        return_value={"deleted_count": 2},
    ) as mock_delete:
        resp = client.delete(
            f"/console/api/apps/{app_id}/annotations",
            json={"annotation_ids": ["ann-1", "ann-2"]},
        )

    assert resp.status_code == 204
    mock_delete.assert_called_once_with(app_id, ["ann-1", "ann-2"])
