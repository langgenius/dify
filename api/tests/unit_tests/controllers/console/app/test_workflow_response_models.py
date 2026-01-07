from __future__ import annotations

import builtins
import sys
from datetime import datetime
from importlib import util
from pathlib import Path
from types import ModuleType, SimpleNamespace

from flask.views import MethodView

from core.variables import SecretVariable, StringVariable

# kombu references MethodView as a global when importing celery/kombu pools.
if not hasattr(builtins, "MethodView"):
    builtins.MethodView = MethodView  # type: ignore[attr-defined]


def _load_workflow_module():
    module_name = "controllers.console.app.workflow"
    if module_name in sys.modules:
        return sys.modules[module_name]

    root = Path(__file__).resolve().parents[5]
    module_path = root / "controllers" / "console" / "app" / "workflow.py"

    class _StubNamespace:
        def __init__(self):
            self.models: dict[str, dict] = {}
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

    spec = util.spec_from_file_location(module_name, module_path)
    module = util.module_from_spec(spec)
    sys.modules[module_name] = module

    try:
        assert spec.loader is not None
        spec.loader.exec_module(module)
    finally:
        if original_console is not None:
            sys.modules["controllers.console"] = original_console
        else:
            sys.modules.pop("controllers.console", None)
        if original_app_pkg is not None:
            sys.modules["controllers.console.app"] = original_app_pkg
        else:
            sys.modules.pop("controllers.console.app", None)

    return module


def _ts(hour: int = 12) -> datetime:
    return datetime(2024, 1, 1, hour, 0, 0)


def _workflow_stub(identifier: str = "wf-1") -> SimpleNamespace:
    return SimpleNamespace(
        id=identifier,
        graph_dict={"nodes": [], "edges": []},
        features_dict={"file_upload": {"enabled": True}},
        unique_hash=f"hash-{identifier}",
        version="draft",
        marked_name="Workflow",
        marked_comment="Comment",
        created_by_account=SimpleNamespace(id="acct-1", name="Alice", email="alice@example.com"),
        created_at=_ts(),
        updated_by_account=None,
        updated_at=_ts(13),
        tool_published=True,
        environment_variables=[
            StringVariable(id="env-1", name="API_KEY", value="123", description="visible"),
            SecretVariable(id="env-2", name="SECRET", value="encrypted", description="hidden"),
        ],
        conversation_variables=[
            StringVariable(id="conv-1", name="topic", value="science", description="desc"),
        ],
        rag_pipeline_variables=[
            {
                "label": "Field",
                "variable": "field",
                "type": "text-input",
                "belong_to_node_id": "node-1",
                "allow_file_extension": [".txt"],
                "allow_file_upload_methods": ["local_file"],
            }
        ],
    )
