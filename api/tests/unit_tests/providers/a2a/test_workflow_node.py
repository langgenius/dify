"""External node contracts use real typed variable segments and graph DTOs."""

import pytest

from core.app.entities.app_invoke_entities import DifyRunContext
from core.workflow.node_factory import resolve_workflow_node_class
from graphon.enums import BuiltinNodeTypes
from graphon.file import File
from graphon.file.enums import FileTransferMethod
from graphon.runtime import VariablePool
from providers.a2a.workflow_node import (
    ExternalAgentNode,
    ExternalAgentNodeData,
    ensure_supported_workflow_owner,
    task_parts,
)
from services.external_agents.io_contracts import ExternalIOError
from services.external_agents.runtime_contracts import RuntimeError


def test_task_rendering_preserves_typed_files_array_order_and_json_text() -> None:
    pool = VariablePool()
    first = File(type="document", transfer_method=FileTransferMethod.LOCAL_FILE, related_id="first", filename="a.pdf")
    second = File(type="document", transfer_method=FileTransferMethod.LOCAL_FILE, related_id="second", filename="b.txt")
    pool.add(("source", "documents"), [first, second, first])
    pool.add(("source", "flags"), {"enabled": False, "values": [0, ""]})
    assert task_parts("Read {{#source.documents#}} {{#source.flags#}}", pool) == (
        {"text": "Read "},
        {"fileRef": {"file_id": "first", "kind": "upload"}},
        {"fileRef": {"file_id": "second", "kind": "upload"}},
        {"fileRef": {"file_id": "first", "kind": "upload"}},
        {"text": " "},
        {"text": '{"enabled":false,"values":[0,""]}'},
    )


def test_nested_file_dict_and_nonfinite_cannot_be_rendered_as_task_text() -> None:
    pool = VariablePool()
    pool.add(("source", "object"), {"nested": [{"dify_model_identity": "__dify__file__", "url": "secret"}]})
    with pytest.raises(ExternalIOError, match="explicit typed"):
        task_parts("{{#source.object#}}", pool)
    pool.add(("source", "number"), float("nan"))
    with pytest.raises(ExternalIOError, match="finite"):
        task_parts("{{#source.number#}}", pool)


def test_external_kind_never_falls_back_to_v1_and_unknown_kind_is_rejected() -> None:
    data = ExternalAgentNodeData(type="agent", version="2", agent_node_kind="external_a2a")
    assert (
        resolve_workflow_node_class(node_type=BuiltinNodeTypes.AGENT, node_version="2", node_data=data)
        is ExternalAgentNode
    )
    with pytest.raises(ValueError, match="Unsupported Agent"):
        resolve_workflow_node_class(
            node_type=BuiltinNodeTypes.AGENT, node_version="2", node_data={"agent_node_kind": "future_unknown"}
        )


def test_external_generic_retry_and_typed_default_coercion_are_rejected() -> None:
    with pytest.raises(ValueError, match="generic node retries"):
        ExternalAgentNodeData(agent_task="Task", retry_config={"retry_enabled": True})
    with pytest.raises(ValueError, match="does not match"):
        ExternalAgentNodeData(
            agent_declared_outputs=[{"name": "count", "type": "number"}],
            default_value=[{"key": "count", "type": "number", "value": "1"}],
        )
    with pytest.raises(ValueError, match="non-file"):
        ExternalAgentNodeData(
            agent_declared_outputs=[{"name": "report", "type": "file"}],
            default_value=[{"key": "report", "type": "string", "value": "https://example.com"}],
        )
    data = ExternalAgentNodeData(
        agent_declared_outputs=[{"name": "accepted", "type": "boolean"}],
        default_value=[{"key": "accepted", "type": "boolean", "value": False}],
    )
    assert data.default_value_dict == {"accepted": False}


def test_cross_app_workflow_tool_fails_as_unsupported_profile_before_any_io() -> None:
    from tests.workflow_test_utils import build_test_run_context

    context = DifyRunContext.model_validate(build_test_run_context(app_id="source")["_dify"])
    tool = context.model_copy(update={"workflow_tool_invocation_id": "server-created-frame"})
    with pytest.raises(RuntimeError) as failure:
        ensure_supported_workflow_owner(tool, "root-app")
    assert failure.value.code == "unsupported_profile"
    ensure_supported_workflow_owner(context, "root-app")  # ordinary Workflow/Chatflow is unaffected
    ensure_supported_workflow_owner(tool, "source")
