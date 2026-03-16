from __future__ import annotations

import sys
from importlib import util
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

from services.app_dsl_service import Import, ImportStatus
from services.claude_workflow.import_service import ClaudeWorkflowImportExecutionError


FIXTURES_DIR = Path(__file__).resolve().parents[4] / "fixtures" / "claude_workflow"


@pytest.fixture()
def app_import_module(monkeypatch):
    module_name = "controllers.console.app.app_import"
    root = Path(__file__).resolve().parents[5]
    module_path = root / "controllers" / "console" / "app" / "app_import.py"

    class _StubNamespace:
        def __init__(self) -> None:
            self.models: dict[str, Any] = {}
            self.payload: dict[str, Any] | None = None

        def schema_model(self, name, schema):
            self.models[name] = schema
            return schema

        def model(self, name, model_dict=None, **kwargs):
            if model_dict is not None:
                self.models[name] = model_dict
            return model_dict

        def route(self, *args, **kwargs):
            def decorator(obj):
                return obj

            return decorator

        def expect(self, *args, **kwargs):
            def decorator(obj):
                return obj

            return decorator

    def _identity_decorator(*args, **kwargs):
        if args and callable(args[0]) and len(args) == 1 and not kwargs:
            return args[0]

        def decorator(obj):
            return obj

        return decorator

    original_modules: dict[str, ModuleType | None] = {
        "controllers.console": sys.modules.get("controllers.console"),
        "controllers.console.app": sys.modules.get("controllers.console.app"),
        "controllers.console.app.wraps": sys.modules.get("controllers.console.app.wraps"),
        "controllers.console.wraps": sys.modules.get("controllers.console.wraps"),
        "extensions.ext_database": sys.modules.get("extensions.ext_database"),
        "fields.app_fields": sys.modules.get("fields.app_fields"),
        "libs.login": sys.modules.get("libs.login"),
        module_name: sys.modules.get(module_name),
    }

    console_module = ModuleType("controllers.console")
    console_module.__path__ = [str(root / "controllers" / "console")]
    console_module.console_ns = _StubNamespace()
    sys.modules["controllers.console"] = console_module

    app_package = ModuleType("controllers.console.app")
    app_package.__path__ = [str(root / "controllers" / "console" / "app")]
    sys.modules["controllers.console.app"] = app_package

    wraps_module = ModuleType("controllers.console.app.wraps")
    wraps_module.get_app_model = _identity_decorator
    sys.modules["controllers.console.app.wraps"] = wraps_module

    console_wraps_module = ModuleType("controllers.console.wraps")
    console_wraps_module.account_initialization_required = _identity_decorator
    console_wraps_module.cloud_edition_billing_resource_check = _identity_decorator
    console_wraps_module.edit_permission_required = _identity_decorator
    console_wraps_module.setup_required = _identity_decorator
    sys.modules["controllers.console.wraps"] = console_wraps_module

    db_module = ModuleType("extensions.ext_database")
    db_module.db = SimpleNamespace(engine=object())
    sys.modules["extensions.ext_database"] = db_module

    fields_module = ModuleType("fields.app_fields")
    fields_module.app_import_check_dependencies_fields = {"leaked_dependencies": {}}
    fields_module.app_import_fields = {"id": {}}
    fields_module.leaked_dependency_fields = {"name": {}}
    sys.modules["fields.app_fields"] = fields_module

    login_module = ModuleType("libs.login")
    login_module.current_account_with_tenant = lambda: (SimpleNamespace(current_tenant_id="tenant-1"), None)
    login_module.login_required = _identity_decorator
    sys.modules["libs.login"] = login_module

    spec = util.spec_from_file_location(module_name, module_path)
    module = util.module_from_spec(spec)
    sys.modules[module_name] = module

    assert spec.loader is not None
    spec.loader.exec_module(module)

    try:
        yield module
    finally:
        for name, original in original_modules.items():
            if original is not None:
                sys.modules[name] = original
            else:
                sys.modules.pop(name, None)


def _payload(name: str) -> dict[str, Any]:
    return {
        "mode": "yaml-content",
        "yaml_content": (FIXTURES_DIR / name).read_text(encoding="utf-8"),
    }


    def test_app_import_api_returns_successful_import_payload(app_import_module, monkeypatch) -> None:
        class _FakeSession:
            def __enter__(self):
                return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def commit(self):
            return None

    class _FakeImportService:
        def __init__(self, session) -> None:
            self.session = session

        def import_app(self, **kwargs):
            return Import(id="import-1", status=ImportStatus.COMPLETED, app_id="app-1", app_mode="workflow")

    monkeypatch.setattr(app_import_module, "Session", lambda engine: _FakeSession())
    monkeypatch.setattr(app_import_module, "ClaudeWorkflowImportService", _FakeImportService)
    monkeypatch.setattr(
        app_import_module.FeatureService,
        "get_system_features",
        lambda: SimpleNamespace(webapp_auth=SimpleNamespace(enabled=False)),
    )
    app_import_module.console_ns.payload = _payload("basic_llm.yml")

    response, status = app_import_module.AppImportApi().post()

    assert status == 200
    assert response["status"] == ImportStatus.COMPLETED
    assert response["app_id"] == "app-1"


    def test_app_import_api_maps_schema_failure_to_http_400(app_import_module, monkeypatch) -> None:
        class _FakeSession:
            def __enter__(self):
                return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def commit(self):
            return None

    class _FakeImportService:
        def __init__(self, session) -> None:
            self.session = session

        def import_app(self, **kwargs):
            raise ClaudeWorkflowImportExecutionError(
                status_code=400,
                payload=Import(id="import-2", status=ImportStatus.FAILED, error="edges.1.target: unknown target"),
            )

    monkeypatch.setattr(app_import_module, "Session", lambda engine: _FakeSession())
    monkeypatch.setattr(app_import_module, "ClaudeWorkflowImportService", _FakeImportService)
    app_import_module.console_ns.payload = _payload("invalid_missing_edge_target.yml")

    response, status = app_import_module.AppImportApi().post()

    assert status == 400
    assert response["status"] == ImportStatus.FAILED
    assert "edges.1.target" in response["error"]


    def test_app_import_api_maps_compiler_failure_to_http_422(app_import_module, monkeypatch) -> None:
        class _FakeSession:
            def __enter__(self):
                return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def commit(self):
            return None

    class _FakeImportService:
        def __init__(self, session) -> None:
            self.session = session

        def import_app(self, **kwargs):
            raise ClaudeWorkflowImportExecutionError(
                status_code=422,
                payload=Import(id="import-3", status=ImportStatus.FAILED, error="Invalid selector payload"),
            )

    monkeypatch.setattr(app_import_module, "Session", lambda engine: _FakeSession())
    monkeypatch.setattr(app_import_module, "ClaudeWorkflowImportService", _FakeImportService)
    app_import_module.console_ns.payload = _payload("http_request.yml")

    response, status = app_import_module.AppImportApi().post()

    assert status == 422
    assert response["status"] == ImportStatus.FAILED
    assert response["error"] == "Invalid selector payload"
