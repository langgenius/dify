from types import SimpleNamespace

from core.app.apps.workflow.app_generator import WorkflowAppGenerator
from core.app.entities.app_invoke_entities import InvokeFrom
from dify_graph.entities.workflow_execution import WorkflowRunRerunMetadata, WorkflowRunRerunScope


def test_rerun_delegates_to_generate_with_rerun_specific_flags() -> None:
    generator = WorkflowAppGenerator()
    captured: dict[str, object] = {}

    def _fake_generate(**kwargs):
        captured.update(kwargs)
        return {"ok": True}

    generator._generate = _fake_generate  # type: ignore[method-assign]

    rerun_metadata = WorkflowRunRerunMetadata(
        rerun_from_workflow_run_id="source-run-id",
        rerun_from_node_id="target-node-id",
        rerun_overrides=[],
        rerun_scope=WorkflowRunRerunScope(
            target_node_id="target-node-id",
            ancestor_node_ids=[],
            rerun_node_ids=["target-node-id"],
            overrideable_node_ids=[],
        ),
        rerun_chain_root_workflow_run_id="chain-root-id",
    )
    generate_entity = SimpleNamespace(invoke_from=InvokeFrom.DEBUGGER)
    execution_graph_config = {"nodes": [{"id": "target-node-id"}], "edges": []}

    result = generator.rerun(
        app_model=SimpleNamespace(id="app-id"),
        workflow=SimpleNamespace(id="workflow-id"),
        user=SimpleNamespace(id="user-id"),
        application_generate_entity=generate_entity,
        workflow_execution_repository=SimpleNamespace(),
        workflow_node_execution_repository=SimpleNamespace(),
        execution_graph_config=execution_graph_config,
        graph_runtime_state=SimpleNamespace(),
        rerun_metadata=rerun_metadata,
        root_node_id="target-node-id",
        streaming=False,
    )

    assert result == {"ok": True}
    assert captured["execution_graph_config"] == execution_graph_config
    assert captured["root_node_id"] == "target-node-id"
    assert captured["skip_validation"] is True
    assert captured["rerun_metadata"] == rerun_metadata
