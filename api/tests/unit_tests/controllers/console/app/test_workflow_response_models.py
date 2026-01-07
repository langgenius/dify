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


_workflow_module = _load_workflow_module()
WorkflowPaginationResponse = _workflow_module.WorkflowPaginationResponse
WorkflowRunNodeExecutionResponse = _workflow_module.WorkflowRunNodeExecutionResponse


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

def test_workflow_node_execution_response_serializes_nested_entities():
    node_execution = SimpleNamespace(
        id="node-1",
        index=1,
        predecessor_node_id=None,
        node_id="node-1",
        node_type="tool",
        title="Tool Node",
        inputs_dict={"foo": "bar"},
        process_data_dict={"step": 1},
        outputs_dict={"result": "ok"},
        status="succeeded",
        error=None,
        elapsed_time=1.23,
        execution_metadata_dict={"tool_info": {"provider_type": "builtin"}},
        extras={"icon": "icon-url"},
        created_at=_ts(),
        created_by_role="account",
        created_by_account=SimpleNamespace(id="acct-1", name="Alice", email="alice@example.com"),
        created_by_end_user=SimpleNamespace(id="end-1", type="end_user", is_anonymous=False, session_id="sess-1"),
        finished_at=_ts(13),
        inputs_truncated=False,
        outputs_truncated=False,
        process_data_truncated=False,
    )

    serialized = WorkflowRunNodeExecutionResponse.model_validate(node_execution, from_attributes=True).model_dump(
        mode="json"
    )

    assert serialized["created_by_account"]["name"] == "Alice"
    assert serialized["created_by_end_user"]["session_id"] == "sess-1"
    assert serialized["created_at"] == int(_ts().timestamp())
    assert serialized["inputs"] == {"foo": "bar"}
    assert serialized["execution_metadata"] == {"tool_info": {"provider_type": "builtin"}}


def test_workflow_pagination_serializes_workflow_items():
    workflows = [_workflow_stub("wf-1"), _workflow_stub("wf-2")]

    serialized = WorkflowPaginationResponse.model_validate(
        {"items": workflows, "page": 2, "limit": 5, "has_more": True},
        from_attributes=True,
    ).model_dump(mode="json")

    assert serialized["page"] == 2
    assert serialized["limit"] == 5
    assert serialized["has_more"] is True
    assert serialized["items"][1]["id"] == "wf-2"
