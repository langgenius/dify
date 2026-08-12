from __future__ import annotations

import threading
import time
from collections.abc import Mapping
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.workflow.node_factory import resolve_workflow_node_class
from core.workflow.nodes.knowledge_retrieval_v2 import knowledge_retrieval_v2_node as node_module
from core.workflow.nodes.knowledge_retrieval_v2.entities import KnowledgeRetrievalV2NodeData
from core.workflow.nodes.knowledge_retrieval_v2.knowledge_retrieval_v2_node import KnowledgeRetrievalV2Node
from core.workflow.system_variables import build_system_variables
from graphon.enums import WorkflowNodeExecutionStatus
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variables import StringSegment
from services.knowledge_fs.app_admission_service import (
    KnowledgeFSAppAdmissionError,
    KnowledgeFSAppAuthorizationNotReadyError,
    KnowledgeFSAppChannelDisabledError,
    KnowledgeFSAppSpaceUnavailableError,
)
from services.knowledge_fs.product_dto import KnowledgeFSRetrievalTestResponse
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from tests.workflow_test_utils import build_test_graph_init_params


def _response(*, mode: str, score: float, space: str, text: str) -> KnowledgeFSRetrievalTestResponse:
    return KnowledgeFSRetrievalTestResponse.model_validate(
        {
            "items": [
                {
                    "citation": {
                        "artifactHash": "a" * 64,
                        "documentAssetId": f"document-{space}",
                        "documentVersion": 2,
                        "pageNumber": 3,
                        "sectionPath": ["Camera", space],
                    },
                    "nodeId": f"node-{space}",
                    "projectionIds": [f"projection-{space}"],
                    "score": score,
                    "sources": ["dense"],
                    "text": text,
                }
            ],
            "metrics": {"degradationFlags": [f"degraded-{space}"], "totalMs": 12},
            "mode": mode,
            "traceId": f"trace-{space}",
        }
    )


def _empty_response(*, mode: str, space: str) -> KnowledgeFSRetrievalTestResponse:
    return KnowledgeFSRetrievalTestResponse.model_validate(
        {
            "items": [],
            "metrics": {"degradationFlags": [], "totalMs": 4},
            "mode": mode,
            "traceId": f"trace-{space}",
        }
    )


class RecordingCapabilityService:
    def __init__(self, responses: Mapping[str, KnowledgeFSRetrievalTestResponse | Exception]) -> None:
        self.responses = responses
        self.calls: list[dict[str, object]] = []
        self._lock = threading.Lock()

    def run_retrieval(self, **kwargs: object) -> KnowledgeFSRetrievalTestResponse:
        resource = kwargs["resource"]
        control_space_id = resource.control_space_id  # type: ignore[attr-defined]
        with self._lock:
            self.calls.append(kwargs)
        response = self.responses[control_space_id]
        if isinstance(response, Exception):
            raise response
        return response


class RecordingBindingService:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def upsert(self, **kwargs: object) -> object:
        self.calls.append(kwargs)
        return object()


class ConcurrentCapabilityService(RecordingCapabilityService):
    def __init__(self, responses: Mapping[str, KnowledgeFSRetrievalTestResponse | Exception]) -> None:
        super().__init__(responses)
        self.active = 0
        self.max_active = 0

    def run_retrieval(self, **kwargs: object) -> KnowledgeFSRetrievalTestResponse:
        with self._lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(0.02)
            return super().run_retrieval(**kwargs)
        finally:
            with self._lock:
                self.active -= 1


def _runtime_state(query: object = "camera") -> GraphRuntimeState:
    pool = VariablePool.from_bootstrap(
        system_variables=build_system_variables(user_id="user-1", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    pool.add(["start", "query"], StringSegment(value=query) if isinstance(query, str) else query)
    return GraphRuntimeState(variable_pool=pool, start_at=time.perf_counter())


def _node(
    *,
    service: RecordingCapabilityService,
    spaces: list[str],
    top_n: int = 10,
    mode: str | None = None,
    runtime_state: GraphRuntimeState | None = None,
    binding_service: RecordingBindingService | None = None,
    invoke_from: InvokeFrom = InvokeFrom.DEBUGGER,
    user_from: UserFrom = UserFrom.ACCOUNT,
) -> KnowledgeRetrievalV2Node:
    return KnowledgeRetrievalV2Node(
        node_id="retrieval-v2",
        data=KnowledgeRetrievalV2NodeData.model_validate(
            {
                "control_space_ids": spaces,
                "metadata_filters": {"documentTypes": [" handbook ", "handbook"]},
                "mode": mode,
                "query_variable_selector": ["start", "query"],
                "title": "KnowledgeFS Retrieval",
                "top_n": top_n,
                "type": "knowledge-retrieval-v2",
            }
        ),
        graph_init_params=build_test_graph_init_params(
            tenant_id="tenant-1",
            app_id="app-1",
            user_id="user-1",
            invoke_from=invoke_from,
            user_from=user_from,
        ),
        graph_runtime_state=runtime_state or _runtime_state(),
        capability_service=service,  # type: ignore[arg-type]
        binding_service=binding_service,  # type: ignore[arg-type]
    )


def test_node_data_normalizes_space_ids_and_rejects_auto_or_unbounded_spaces() -> None:
    data = KnowledgeRetrievalV2NodeData.model_validate(
        {
            "control_space_ids": [" space-a ", "space-a", "space-b"],
            "query_variable_selector": ["start", "query"],
            "title": "KnowledgeFS Retrieval",
            "type": "knowledge-retrieval-v2",
        }
    )

    assert data.control_space_ids == ["space-a", "space-b"]
    with pytest.raises(ValidationError):
        KnowledgeRetrievalV2NodeData.model_validate(
            {
                "control_space_ids": ["space-a"],
                "mode": "auto",
                "query_variable_selector": ["start", "query"],
                "title": "KnowledgeFS Retrieval",
                "type": "knowledge-retrieval-v2",
            }
        )
    assert resolve_workflow_node_class(node_type="knowledge-retrieval-v2", node_version="1") is KnowledgeRetrievalV2Node
    with pytest.raises(ValidationError):
        KnowledgeRetrievalV2NodeData.model_validate(
            {
                "control_space_ids": [f"space-{index}" for index in range(11)],
                "query_variable_selector": ["start", "query"],
                "title": "KnowledgeFS Retrieval",
                "type": "knowledge-retrieval-v2",
            }
        )


def test_exported_dsl_fixture_keeps_the_v2_node_contract() -> None:
    tests_directory = next(parent for parent in Path(__file__).resolve().parents if parent.name == "tests")
    fixture = yaml.safe_load(
        (tests_directory / "fixtures" / "workflow" / "knowledge_retrieval_v2_workflow.yml").read_text()
    )
    retrieval_node = next(
        node for node in fixture["workflow"]["graph"]["nodes"] if node["data"]["type"] == "knowledge-retrieval-v2"
    )

    node_data = KnowledgeRetrievalV2NodeData.model_validate(retrieval_node["data"])

    assert node_data.control_space_ids == ["019f0000-0000-7000-8000-000000000001"]
    assert node_data.query_variable_selector == ["start", "query"]
    assert node_data.metadata_filters is not None
    assert node_data.metadata_filters.node_kinds == ["section"]
    assert node_data.top_n == 5


def test_multi_space_retrieval_preserves_final_scores_and_returns_mixed_metrics() -> None:
    service = RecordingCapabilityService(
        {
            "space-a": _response(mode="fast", score=0.7, space="space-a", text="A"),
            "space-b": _response(mode="deep", score=0.9, space="space-b", text="B"),
            "space-c": _response(mode="fast", score=0.7, space="space-c", text="C"),
        }
    )
    result = _node(service=service, spaces=["space-a", "space-b", "space-c"], top_n=2)._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert [item["content"] for item in result.outputs["result"].value] == ["B", "A"]
    assert [item["metadata"]["score"] for item in result.outputs["result"].value] == [0.9, 0.7]
    assert result.outputs["metrics"].value == {
        "candidate_counts": {"space-a": 1, "space-b": 1, "space-c": 1},
        "degradation_flags": ["degraded-space-a", "degraded-space-b", "degraded-space-c"],
        "effective_modes": ["fast", "deep"],
        "mode": "mixed",
        "per_space": [
            {
                "candidate_count": 1,
                "control_space_id": "space-a",
                "degradation_flags": ["degraded-space-a"],
                "mode": "fast",
                "total_ms": 12.0,
                "trace_id": "trace-space-a",
            },
            {
                "candidate_count": 1,
                "control_space_id": "space-b",
                "degradation_flags": ["degraded-space-b"],
                "mode": "deep",
                "total_ms": 12.0,
                "trace_id": "trace-space-b",
            },
            {
                "candidate_count": 1,
                "control_space_id": "space-c",
                "degradation_flags": ["degraded-space-c"],
                "mode": "fast",
                "total_ms": 12.0,
                "trace_id": "trace-space-c",
            },
        ],
        "requested_mode": "space-default",
        "total_ms": pytest.approx(result.outputs["metrics"].value["total_ms"]),
    }
    assert all(call["payload"].include_text is True for call in service.calls)  # type: ignore[attr-defined]
    assert all(
        call["payload"].filters.document_types == ["handbook"]  # type: ignore[attr-defined]
        for call in service.calls
    )


def test_empty_retrieval_is_successful_and_dispatches_quality_capture(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dispatched: list[dict[str, object]] = []
    monkeypatch.setattr(
        node_module,
        "enqueue_workflow_failed_retrieval_capture",
        lambda **kwargs: dispatched.append(kwargs),
    )

    result = _node(
        service=RecordingCapabilityService({"space-a": _empty_response(mode="fast", space="empty")}),
        spaces=["space-a"],
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["result"].value == []
    assert result.outputs["metrics"].value["candidate_counts"] == {"space-a": 0}
    assert dispatched == [
        {
            "tenant_id": "tenant-1",
            "app_id": "app-1",
            "control_space_id": "space-a",
            "query": "camera",
            "mode": "fast",
            "retrieval_trace_id": "trace-empty",
        }
    ]


def test_quality_capture_runs_per_space_only_when_the_merged_result_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dispatched: list[dict[str, object]] = []
    monkeypatch.setattr(
        node_module,
        "enqueue_workflow_failed_retrieval_capture",
        lambda **kwargs: dispatched.append(kwargs),
    )
    partial_result = _node(
        service=RecordingCapabilityService(
            {
                "space-a": _empty_response(mode="fast", space="a"),
                "space-b": _response(mode="fast", score=0.8, space="b", text="evidence"),
            }
        ),
        spaces=["space-a", "space-b"],
    )._run()

    assert partial_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert dispatched == []

    empty_result = _node(
        service=RecordingCapabilityService(
            {
                "space-a": _empty_response(mode="fast", space="a"),
                "space-b": _empty_response(mode="deep", space="b"),
            }
        ),
        spaces=["space-a", "space-b"],
    )._run()

    assert empty_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert [call["control_space_id"] for call in dispatched] == ["space-a", "space-b"]
    assert [call["retrieval_trace_id"] for call in dispatched] == ["trace-a", "trace-b"]


def test_quality_capture_dispatch_failure_never_fails_an_empty_retrieval(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_dispatch(**_kwargs: object) -> None:
        raise RuntimeError("broker unavailable")

    monkeypatch.setattr(node_module, "enqueue_workflow_failed_retrieval_capture", fail_dispatch)

    result = _node(
        service=RecordingCapabilityService({"space-a": _empty_response(mode="fast", space="a")}),
        spaces=["space-a"],
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["result"].value == []


def test_node_fails_closed_for_binding_rejection_and_invalid_query_type() -> None:
    rejected = _node(
        service=RecordingCapabilityService(
            {"space-a": KnowledgeFSAppAdmissionError("KnowledgeFS app binding is not enabled")}
        ),
        spaces=["space-a"],
    )._run()
    invalid_query = _node(
        service=RecordingCapabilityService({"space-a": _response(mode="fast", score=0.8, space="a", text="A")}),
        spaces=["space-a"],
        runtime_state=_runtime_state(123),
    )._run()
    oversized_query = _node(
        service=RecordingCapabilityService({"space-a": _response(mode="fast", score=0.8, space="a", text="A")}),
        spaces=["space-a"],
        runtime_state=_runtime_state("x" * 16_001),
    )._run()

    assert rejected.status == WorkflowNodeExecutionStatus.FAILED
    assert rejected.error_type == "KnowledgeFSRetrievalBindingError"
    assert rejected.error is not None
    assert rejected.error.startswith("[knowledge_fs_binding_not_enabled] ")
    assert rejected.error == (
        "[knowledge_fs_binding_not_enabled] KnowledgeFS Space space-a is not bound to this workflow"
    )
    assert invalid_query.status == WorkflowNodeExecutionStatus.FAILED
    assert invalid_query.error_type == "KnowledgeFSRetrievalConfigurationError"
    assert oversized_query.status == WorkflowNodeExecutionStatus.FAILED
    assert oversized_query.error_type == "KnowledgeFSRetrievalConfigurationError"


@pytest.mark.parametrize(
    ("admission_error", "reason_marker", "expected_message"),
    [
        (
            KnowledgeFSAppChannelDisabledError("KnowledgeFS workflow channel is disabled"),
            "knowledge_fs_workflow_access_disabled",
            "[knowledge_fs_workflow_access_disabled] Workflow access is disabled for KnowledgeFS Space space-a; "
            "ask a workspace owner to enable the Workflow channel",
        ),
        (
            KnowledgeFSAppSpaceUnavailableError("KnowledgeFS control-space is not active or provisioned"),
            "knowledge_fs_space_unavailable",
            "[knowledge_fs_space_unavailable] KnowledgeFS Space space-a is not ready for workflow retrieval; "
            "select an active, provisioned Space",
        ),
        (
            KnowledgeFSAppAuthorizationNotReadyError("KnowledgeFS authorization state is not ready"),
            "knowledge_fs_authorization_not_ready",
            "[knowledge_fs_authorization_not_ready] KnowledgeFS Space space-a permissions are not ready; "
            "ask a workspace owner to finish KnowledgeFS permission setup",
        ),
    ],
)
def test_node_maps_typed_admission_rejections_to_actionable_binding_errors(
    admission_error: KnowledgeFSAppAdmissionError,
    reason_marker: str,
    expected_message: str,
) -> None:
    result = _node(
        service=RecordingCapabilityService({"space-a": admission_error}),
        spaces=["space-a"],
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.outputs == {}
    assert result.error_type == "KnowledgeFSRetrievalBindingError"
    assert result.error is not None
    assert result.error.startswith(f"[{reason_marker}] ")
    assert result.error == expected_message


def test_node_fails_closed_when_any_selected_space_is_unavailable() -> None:
    result = _node(
        service=RecordingCapabilityService(
            {
                "space-a": _response(mode="fast", score=0.8, space="a", text="A"),
                "space-b": KnowledgeFSOperationUnavailableError("operation unavailable"),
            }
        ),
        spaces=["space-a", "space-b"],
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.outputs == {}
    assert result.error_type == "KnowledgeFSRetrievalUnavailableError"


def test_debugger_run_upserts_selected_bindings_but_published_run_never_does() -> None:
    responses = {
        "space-a": _response(mode="fast", score=0.8, space="a", text="A"),
        "space-b": _response(mode="fast", score=0.7, space="b", text="B"),
    }
    draft_bindings = RecordingBindingService()
    published_bindings = RecordingBindingService()

    draft_result = _node(
        service=RecordingCapabilityService(responses),
        spaces=["space-a", "space-b"],
        binding_service=draft_bindings,
    )._run()
    published_result = _node(
        service=RecordingCapabilityService(responses),
        spaces=["space-a", "space-b"],
        binding_service=published_bindings,
        invoke_from=InvokeFrom.WEB_APP,
        user_from=UserFrom.END_USER,
    )._run()

    assert draft_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert [call["control_space_id"] for call in draft_bindings.calls] == ["space-a", "space-b"]
    assert published_result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert published_bindings.calls == []


def test_multi_space_calls_are_concurrent_but_never_exceed_the_bound() -> None:
    spaces = [f"space-{index}" for index in range(8)]
    service = ConcurrentCapabilityService(
        {space: _response(mode="fast", score=0.8, space=space, text=space) for space in spaces}
    )

    result = _node(service=service, spaces=spaces)._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert service.max_active == 4
