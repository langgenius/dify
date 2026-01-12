from __future__ import annotations

import builtins
import sys
from datetime import datetime
from importlib import util
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest
from flask.views import MethodView

# kombu references MethodView as a global when importing celery/kombu pools.
if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


def _load_app_module():
    module_name = "controllers.console.app.app"
    if module_name in sys.modules:
        return sys.modules[module_name]

    root = Path(__file__).resolve().parents[5]
    module_path = root / "controllers" / "console" / "app" / "app.py"

    class _StubNamespace:
        def __init__(self):
            self.models: dict[str, Any] = {}
            self.payload = None

        def schema_model(self, name, schema):
            self.models[name] = schema

        def _decorator(self, obj):
            return obj

        def doc(self, *args, **kwargs):
            return self._decorator

        def expect(self, *args, **kwargs):
            return self._decorator

        def response(self, *args, **kwargs):
            return self._decorator

        def route(self, *args, **kwargs):
            def decorator(obj):
                return obj

            return decorator

    stub_namespace = _StubNamespace()

    original_console = sys.modules.get("controllers.console")
    original_app_pkg = sys.modules.get("controllers.console.app")
    stubbed_modules: list[tuple[str, ModuleType | None]] = []

    console_module = ModuleType("controllers.console")
    console_module.__path__ = [str(root / "controllers" / "console")]
    console_module.console_ns = stub_namespace
    console_module.api = None
    console_module.bp = None
    sys.modules["controllers.console"] = console_module

    app_package = ModuleType("controllers.console.app")
    app_package.__path__ = [str(root / "controllers" / "console" / "app")]
    sys.modules["controllers.console.app"] = app_package
    console_module.app = app_package

    def _stub_module(name: str, attrs: dict[str, Any]):
        original = sys.modules.get(name)
        module = ModuleType(name)
        for key, value in attrs.items():
            setattr(module, key, value)
        sys.modules[name] = module
        stubbed_modules.append((name, original))

    class _OpsTraceManager:
        @staticmethod
        def get_app_tracing_config(app_id: str) -> dict[str, Any]:
            return {}

        @staticmethod
        def update_app_tracing_config(app_id: str, **kwargs) -> None:
            return None

    _stub_module(
        "core.ops.ops_trace_manager",
        {
            "OpsTraceManager": _OpsTraceManager,
            "TraceQueueManager": object,
            "TraceTask": object,
        },
    )

    spec = util.spec_from_file_location(module_name, module_path)
    module = util.module_from_spec(spec)
    sys.modules[module_name] = module

    try:
        assert spec.loader is not None
        spec.loader.exec_module(module)
    finally:
        for name, original in reversed(stubbed_modules):
            if original is not None:
                sys.modules[name] = original
            else:
                sys.modules.pop(name, None)
        if original_console is not None:
            sys.modules["controllers.console"] = original_console
        else:
            sys.modules.pop("controllers.console", None)
        if original_app_pkg is not None:
            sys.modules["controllers.console.app"] = original_app_pkg
        else:
            sys.modules.pop("controllers.console.app", None)

    return module


_app_module = _load_app_module()
AppDetailWithSite = _app_module.AppDetailWithSite
AppPagination = _app_module.AppPagination
AppPartial = _app_module.AppPartial


@pytest.fixture(autouse=True)
def patch_signed_url(monkeypatch):
    """Ensure icon URL generation uses a deterministic helper for tests."""

    def _fake_signed_url(key: str | None) -> str | None:
        if not key:
            return None
        return f"signed:{key}"

    monkeypatch.setattr(_app_module.file_helpers, "get_signed_file_url", _fake_signed_url)


def _ts(hour: int = 12) -> datetime:
    return datetime(2024, 1, 1, hour, 0, 0)


def _dummy_model_config():
    return SimpleNamespace(
        model_dict={"provider": "openai", "name": "gpt-4o"},
        pre_prompt="hello",
        created_by="config-author",
        created_at=_ts(9),
        updated_by="config-editor",
        updated_at=_ts(10),
    )


def _dummy_workflow():
    return SimpleNamespace(
        id="wf-1",
        created_by="workflow-author",
        created_at=_ts(8),
        updated_by="workflow-editor",
        updated_at=_ts(9),
    )


def test_app_partial_serialization_uses_aliases():
    created_at = _ts()
    app_obj = SimpleNamespace(
        id="app-1",
        name="My App",
        desc_or_prompt="Prompt snippet",
        mode_compatible_with_agent="chat",
        icon_type="image",
        icon="icon-key",
        icon_background="#fff",
        app_model_config=_dummy_model_config(),
        workflow=_dummy_workflow(),
        created_by="creator",
        created_at=created_at,
        updated_by="editor",
        updated_at=created_at,
        tags=[SimpleNamespace(id="tag-1", name="Utilities", type="app")],
        access_mode="private",
        create_user_name="Creator",
        author_name="Author",
        has_draft_trigger=True,
    )

    serialized = AppPartial.model_validate(app_obj, from_attributes=True).model_dump(mode="json")

    assert serialized["description"] == "Prompt snippet"
    assert serialized["mode"] == "chat"
    assert serialized["icon_url"] == "signed:icon-key"
    assert serialized["created_at"] == int(created_at.timestamp())
    assert serialized["updated_at"] == int(created_at.timestamp())
    assert serialized["model_config"]["model"] == {"provider": "openai", "name": "gpt-4o"}
    assert serialized["workflow"]["id"] == "wf-1"
    assert serialized["tags"][0]["name"] == "Utilities"


def test_app_detail_with_site_includes_nested_serialization():
    timestamp = _ts(14)
    site = SimpleNamespace(
        code="site-code",
        title="Public Site",
        icon_type="image",
        icon="site-icon",
        created_at=timestamp,
        updated_at=timestamp,
    )
    app_obj = SimpleNamespace(
        id="app-2",
        name="Detailed App",
        description="Desc",
        mode_compatible_with_agent="advanced-chat",
        icon_type="image",
        icon="detail-icon",
        icon_background="#123456",
        enable_site=True,
        enable_api=True,
        app_model_config={
            "opening_statement": "hi",
            "model": {"provider": "openai", "name": "gpt-4o"},
            "retriever_resource": {"enabled": True},
        },
        workflow=_dummy_workflow(),
        tracing={"enabled": True},
        use_icon_as_answer_icon=True,
        created_by="creator",
        created_at=timestamp,
        updated_by="editor",
        updated_at=timestamp,
        access_mode="public",
        tags=[SimpleNamespace(id="tag-2", name="Prod", type="app")],
        api_base_url="https://api.example.com/v1",
        max_active_requests=5,
        deleted_tools=[{"type": "api", "tool_name": "search", "provider_id": "prov"}],
        site=site,
    )

    serialized = AppDetailWithSite.model_validate(app_obj, from_attributes=True).model_dump(mode="json")

    assert serialized["icon_url"] == "signed:detail-icon"
    assert serialized["model_config"]["retriever_resource"] == {"enabled": True}
    assert serialized["deleted_tools"][0]["tool_name"] == "search"
    assert serialized["site"]["icon_url"] == "signed:site-icon"
    assert serialized["site"]["created_at"] == int(timestamp.timestamp())


def test_app_pagination_aliases_per_page_and_has_next():
    item_one = SimpleNamespace(
        id="app-10",
        name="Paginated One",
        desc_or_prompt="Summary",
        mode_compatible_with_agent="chat",
        icon_type="image",
        icon="first-icon",
        created_at=_ts(15),
        updated_at=_ts(15),
    )
    item_two = SimpleNamespace(
        id="app-11",
        name="Paginated Two",
        desc_or_prompt="Summary",
        mode_compatible_with_agent="agent-chat",
        icon_type="emoji",
        icon="🙂",
        created_at=_ts(16),
        updated_at=_ts(16),
    )
    pagination = SimpleNamespace(
        page=2,
        per_page=10,
        total=50,
        has_next=True,
        items=[item_one, item_two],
    )

    serialized = AppPagination.model_validate(pagination, from_attributes=True).model_dump(mode="json")

    assert serialized["page"] == 2
    assert serialized["limit"] == 10
    assert serialized["has_more"] is True
    assert len(serialized["data"]) == 2
    assert serialized["data"][0]["icon_url"] == "signed:first-icon"
    assert serialized["data"][1]["icon_url"] is None
