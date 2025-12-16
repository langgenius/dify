"""
Verify that GraphEngine persistence stores parallel grouping metadata on node executions.

Scenario: Start splits to two LLMs in parallel, both feeding into a single shared Answer node (top-level parallel only).
Assertions:
- Both LLM nodes receive execution_metadata.parallel_id and parallel_start_node_id.
- parallel_id is the same for both LLMs; parallel_start_node_id equals each node's id, respectively.
- parallel_mode_run_id exists and is identical across branches of the same split.
- Top-level split has no parent parallel group, so parent_parallel_id/parent_parallel_start_node_id
  are absent (or not set).
- The downstream Answer node inherits the parallel_id and has a parallel_start_node_id
  matching one of the two LLM branch roots.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.entities.app_invoke_entities import InvokeFrom, WorkflowAppGenerateEntity
from core.workflow.constants import SYSTEM_VARIABLE_NODE_ID
from core.workflow.entities import WorkflowNodeExecution
from core.workflow.enums import (
    SystemVariableKey,
    WorkflowNodeExecutionMetadataKey,
    WorkflowType,
)
from core.workflow.graph_engine import GraphEngine
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_engine.layers.persistence import (
    PersistenceWorkflowInfo,
    WorkflowPersistenceLayer,
)
from models import AppMode
from tests.unit_tests.core.workflow.graph_engine.test_table_runner import TableTestRunner

# -------------------- In-memory repositories for the test --------------------


@dataclass
class _InMemoryWorkflowExecutionRepo:
    items: dict[str, Any] = field(default_factory=dict)

    def save(self, execution):  # type: ignore[override]
        self.items[execution.id_] = execution


@dataclass
class _InMemoryWorkflowNodeExecutionRepo:
    items: dict[str, WorkflowNodeExecution] = field(default_factory=dict)
    by_run: dict[str, list[str]] = field(default_factory=dict)

    def save(self, execution: WorkflowNodeExecution):  # type: ignore[override]
        self.items[execution.id] = execution
        rid = execution.workflow_execution_id or ""
        self.by_run.setdefault(rid, [])
        if execution.id not in self.by_run[rid]:
            self.by_run[rid].append(execution.id)

    def save_execution_data(self, execution: WorkflowNodeExecution):  # type: ignore[override]
        # We already keep the object by reference; nothing special needed.
        self.items[execution.id] = execution

    def get_by_workflow_run(
        self, workflow_run_id: str, order_config: Any | None = None
    ) -> Sequence[WorkflowNodeExecution]:  # type: ignore[override]
        ids = self.by_run.get(workflow_run_id, [])
        return [self.items[i] for i in ids]


# ----------------------------- Test case ------------------------------------


def test_persistence_stores_parallel_metadata():
    # Prepare graph/runtime from fixture (Start -> parallel LLMs -> answers)
    runner = TableTestRunner()
    fixture = runner.workflow_runner.load_fixture("multilingual_parallel_llm_streaming_workflow")
    graph, graph_runtime_state = runner.workflow_runner.create_graph_from_fixture(
        fixture, query="hi", use_mock_factory=True
    )

    # Inject a workflow_execution_id required by persistence layer
    run_id = str(uuid4())
    # variable_pool expects the serialized alias name 'workflow_run_id'
    graph_runtime_state.variable_pool.add((SYSTEM_VARIABLE_NODE_ID, SystemVariableKey.WORKFLOW_EXECUTION_ID), run_id)

    # Build GraphEngine
    engine = GraphEngine(
        workflow_id="wf-parallel-meta-test",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
    )

    # Persistence layer with in-memory repos
    wx_repo = _InMemoryWorkflowExecutionRepo()
    nx_repo = _InMemoryWorkflowNodeExecutionRepo()

    app_entity = WorkflowAppGenerateEntity(
        task_id=str(uuid4()),
        app_config=WorkflowUIBasedAppConfig(
            app_id="test",
            tenant_id="test",
            app_mode=AppMode.AGENT_CHAT,
            workflow_id="wf-parallel-meta-test",
        ),
        file_upload_config=None,
        inputs={},
        files=(),
        user_id="u1",
        stream=False,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        extras={},
        workflow_execution_id=run_id,
    )

    info = PersistenceWorkflowInfo(
        workflow_id="wf-parallel-meta-test",
        workflow_type=WorkflowType.WORKFLOW,
        version="1",
        graph_data=fixture.get("workflow", {}).get("graph", {}),
    )

    layer = WorkflowPersistenceLayer(
        application_generate_entity=app_entity,
        workflow_info=info,
        workflow_execution_repository=wx_repo,  # type: ignore[arg-type]
        workflow_node_execution_repository=nx_repo,  # type: ignore[arg-type]
        trace_manager=None,
    )

    engine.layer(layer)

    # Run engine to completion
    _ = list(engine.run())

    # Collect node executions and filter interesting nodes by type via saved metadata
    saved_execs = nx_repo.get_by_workflow_run(run_id)
    assert saved_execs, "no node executions persisted"

    # Build a quick index by node_id
    by_node: dict[str, WorkflowNodeExecution] = {e.node_id: e for e in saved_execs}

    # Identify the two LLM nodes by looking for outputs containing 'text'
    llm_nodes = [e for e in saved_execs if e.node_type.value == "llm"]
    assert len(llm_nodes) == 2, f"expected 2 LLM nodes, got {len(llm_nodes)}"

    # Both LLMs must have parallel_id and parallel_start_node_id
    pids = set()
    run_ids = set()
    for e in llm_nodes:
        meta: Mapping[str, Any] = e.metadata or {}
        assert WorkflowNodeExecutionMetadataKey.PARALLEL_ID in meta
        assert WorkflowNodeExecutionMetadataKey.PARALLEL_START_NODE_ID in meta
        pids.add(meta[WorkflowNodeExecutionMetadataKey.PARALLEL_ID])
        run_ids.add(meta.get(WorkflowNodeExecutionMetadataKey.PARALLEL_MODE_RUN_ID))
        # branch start id equals node id
        assert meta[WorkflowNodeExecutionMetadataKey.PARALLEL_START_NODE_ID] == e.node_id
        # top-level split: parent_* should be absent
        assert WorkflowNodeExecutionMetadataKey.PARENT_PARALLEL_ID not in meta
        assert WorkflowNodeExecutionMetadataKey.PARENT_PARALLEL_START_NODE_ID not in meta

    # Both branches share same parallel_id and same parallel_mode_run_id
    assert len(pids) == 1, f"parallel_id differs across branches: {pids}"
    assert len(run_ids) == 1, f"parallel_mode_run_id differs across branches: {run_ids}"
    assert None not in run_ids, f"parallel_mode_run_id missing (None) in some branches: {run_ids}"

    # Downstream Answer node should inherit the same parallel_id and correct branch root id
    answer_nodes = [e for e in saved_execs if e.node_type.value == "answer"]
    assert len(answer_nodes) == 1
    e = answer_nodes[0]
    meta: Mapping[str, Any] = e.metadata or {}
    assert WorkflowNodeExecutionMetadataKey.PARALLEL_ID in meta
    assert WorkflowNodeExecutionMetadataKey.PARALLEL_START_NODE_ID in meta
    # Must match the LLM branch's parallel_id
    assert meta[WorkflowNodeExecutionMetadataKey.PARALLEL_ID] in pids
    # The branch start node id must be one of the two LLM ids
    llm_ids = {n.node_id for n in llm_nodes}
    assert meta[WorkflowNodeExecutionMetadataKey.PARALLEL_START_NODE_ID] in llm_ids
