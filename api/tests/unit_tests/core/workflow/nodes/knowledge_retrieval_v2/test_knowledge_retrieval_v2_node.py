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
from core.workflow.nodes.knowledge_retrieval_v2.automatic_metadata_filter import KnowledgeFSMetadataExtraction
from core.workflow.nodes.knowledge_retrieval_v2.entities import KnowledgeRetrievalV2NodeData
from core.workflow.nodes.knowledge_retrieval_v2.exc import KnowledgeFSRetrievalConfigurationError
from core.workflow.nodes.knowledge_retrieval_v2.knowledge_retrieval_v2_node import KnowledgeRetrievalV2Node
from core.workflow.system_variables import build_system_variables
from graphon.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from graphon.file import File, FileTransferMethod, FileType
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.rerank_entities import RerankDocument, RerankResult
from graphon.runtime import GraphRuntimeState, VariablePool
from graphon.variables import FileSegment, StringSegment
from services.knowledge_fs.app_admission_service import (
    KnowledgeFSAppAdmissionError,
    KnowledgeFSAppAuthorizationNotReadyError,
    KnowledgeFSAppChannelDisabledError,
    KnowledgeFSAppSpaceUnavailableError,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSMetadataFieldListResponse,
    KnowledgeFSRetrievalTestResponse,
)
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from services.knowledge_fs.query_images import KnowledgeFSWorkflowQueryImageReference
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


def _metadata_fields(*fields: tuple[str, str]) -> KnowledgeFSMetadataFieldListResponse:
    return KnowledgeFSMetadataFieldListResponse.model_validate(
        {
            "items": [
                {
                    "count": 1,
                    "createdAt": "2026-01-01T00:00:00Z",
                    "id": f"field-{name}",
                    "name": name,
                    "rowVersion": 1,
                    "type": field_type,
                    "updatedAt": "2026-01-01T00:00:00Z",
                }
                for name, field_type in fields
            ],
            "nextCursor": None,
        }
    )


class RecordingCapabilityService:
    def __init__(
        self,
        responses: Mapping[str, KnowledgeFSRetrievalTestResponse | Exception],
        metadata_fields: Mapping[str, KnowledgeFSMetadataFieldListResponse | Exception] | None = None,
    ) -> None:
        self.responses = responses
        self.metadata_fields = metadata_fields or {}
        self.calls: list[dict[str, object]] = []
        self.metadata_calls: list[dict[str, object]] = []
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

    def list_metadata_fields(self, **kwargs: object) -> KnowledgeFSMetadataFieldListResponse:
        resource = kwargs["resource"]
        control_space_id = resource.control_space_id  # type: ignore[attr-defined]
        with self._lock:
            self.metadata_calls.append(kwargs)
        response = self.metadata_fields[control_space_id]
        if isinstance(response, Exception):
            raise response
        return response


class RecordingMetadataFilterExtractor:
    def __init__(
        self,
        metadata_map: list[dict[str, object]] | Exception,
        *,
        usage: LLMUsage | None = None,
    ) -> None:
        self.metadata_map = metadata_map
        self.usage = usage or LLMUsage.empty_usage()
        self.calls: list[dict[str, object]] = []

    def extract(self, **kwargs: object) -> KnowledgeFSMetadataExtraction:
        self.calls.append(kwargs)
        if isinstance(self.metadata_map, Exception):
            raise self.metadata_map
        return KnowledgeFSMetadataExtraction(
            metadata_map=list(self.metadata_map),
            usage=self.usage,
            model="gpt-4o-mini",
            provider="openai",
        )


AUTOMATIC_MODEL_CONFIG = {
    "provider": "openai",
    "name": "gpt-4o-mini",
    "mode": "chat",
    "completion_params": {"temperature": 0.7},
}


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


class RecordingRerankModel:
    provider = "system/rerank"
    model_name = "system-rerank"

    def __init__(self, scores: Mapping[str, float] | None = None) -> None:
        self.calls: list[dict[str, object]] = []
        self.scores = scores or {}

    def invoke_rerank(self, **kwargs: object) -> RerankResult:
        self.calls.append(kwargs)
        docs = kwargs["docs"]
        assert isinstance(docs, list)
        threshold = kwargs.get("score_threshold")
        top_n = kwargs.get("top_n")
        ranked = [
            RerankDocument(index=index, text=text, score=self.scores.get(text, 1 - index * 0.01))
            for index, text in enumerate(docs)
        ]
        if isinstance(threshold, float):
            ranked = [document for document in ranked if document.score >= threshold]
        ranked.sort(key=lambda document: (-document.score, document.index))
        if isinstance(top_n, int):
            ranked = ranked[:top_n]
        return RerankResult(model=self.model_name, docs=ranked)


class RecordingRerankModelManager:
    def __init__(self, model: RecordingRerankModel | None = None) -> None:
        self.model = model or RecordingRerankModel()
        self.default_calls: list[tuple[str, object]] = []
        self.explicit_calls: list[dict[str, object]] = []

    def get_default_model_instance(self, tenant_id: str, model_type: object) -> RecordingRerankModel:
        self.default_calls.append((tenant_id, model_type))
        return self.model

    def get_model_instance(self, **kwargs: object) -> RecordingRerankModel:
        self.explicit_calls.append(kwargs)
        return self.model


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
    node_data_overrides: Mapping[str, object] | None = None,
    rerank_model_manager: RecordingRerankModelManager | None = None,
    metadata_filter_extractor: RecordingMetadataFilterExtractor | None = None,
) -> KnowledgeRetrievalV2Node:
    node_data: dict[str, object] = {
        "control_space_ids": spaces,
        "metadata_filters": {"documentTypes": [" handbook ", "handbook"]},
        "mode": mode,
        "query_variable_selector": ["start", "query"],
        "title": "KnowledgeFS Retrieval",
        "top_n": top_n,
        "type": "knowledge-retrieval-v2",
    }
    node_data.update(node_data_overrides or {})
    return KnowledgeRetrievalV2Node(
        node_id="retrieval-v2",
        data=KnowledgeRetrievalV2NodeData.model_validate(node_data),
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
        rerank_model_manager=rerank_model_manager or RecordingRerankModelManager(),  # type: ignore[arg-type]
        metadata_filter_extractor=metadata_filter_extractor,
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
    with pytest.raises(ValidationError):
        KnowledgeRetrievalV2NodeData.model_validate(
            {
                "control_space_ids": ["space-a"],
                "query_variable_selector": ["start", "query"],
                "score_threshold": 1.01,
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


def test_multi_space_retrieval_uses_one_system_reranker_and_returns_mixed_metrics() -> None:
    service = RecordingCapabilityService(
        {
            "space-a": _response(mode="fast", score=0.7, space="space-a", text="A"),
            "space-b": _response(mode="deep", score=0.9, space="space-b", text="B"),
            "space-c": _response(mode="fast", score=0.7, space="space-c", text="C"),
        }
    )
    rerank_model = RecordingRerankModel({"A": 0.72, "B": 0.96, "C": 0.71})
    rerank_manager = RecordingRerankModelManager(rerank_model)
    result = _node(
        service=service,
        spaces=["space-a", "space-b", "space-c"],
        top_n=2,
        rerank_model_manager=rerank_manager,
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert [item["content"] for item in result.outputs["result"].value] == ["B", "A"]
    assert [item["metadata"]["score"] for item in result.outputs["result"].value] == [0.96, 0.72]
    assert [item["metadata"]["space_score"] for item in result.outputs["result"].value] == [0.9, 0.7]
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
        "workflow_rerank": {
            "applied": True,
            "candidate_count": 3,
            "duration_ms": pytest.approx(result.outputs["metrics"].value["workflow_rerank"]["duration_ms"]),
            "model": "system-rerank",
            "output_count": 2,
            "provider": "system/rerank",
            "score_threshold": None,
            "source": "system-default",
            "top_k": 2,
        },
    }
    assert len(rerank_model.calls) == 1
    assert rerank_manager.default_calls
    assert rerank_manager.explicit_calls == []
    assert all(call["payload"].include_text is True for call in service.calls)  # type: ignore[attr-defined]
    assert all(
        call["payload"].filters.document_types == ["handbook"]  # type: ignore[attr-defined]
        for call in service.calls
    )


def test_workflow_query_image_is_forwarded_to_every_space_with_independent_degradation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_state = _runtime_state()
    runtime_state.variable_pool.add(
        ["start", "image"],
        FileSegment(
            value=File(
                file_type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference="00000000-0000-4000-8000-000000000001",
                filename="diagram.png",
                mime_type="image/png",
                size=12,
            )
        ),
    )
    monkeypatch.setattr(
        node_module,
        "issue_workflow_query_image_reference",
        lambda **_kwargs: KnowledgeFSWorkflowQueryImageReference(
            upload_file_id="00000000-0000-4000-8000-000000000001",
            access_grant="short-lived-grant",
            byte_size=12,
            mime_type="image/png",
        ),
    )
    service = RecordingCapabilityService(
        {
            "vision-space": _response(mode="fast", score=0.9, space="vision-space", text="visual"),
            "text-space": _response(mode="fast", score=0.8, space="text-space", text="text"),
        }
    )

    result = _node(
        service=service,
        spaces=["vision-space", "text-space"],
        runtime_state=runtime_state,
        node_data_overrides={"query_attachment_selector": ["start", "image"]},
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert len(service.calls) == 2
    for call in service.calls:
        assert call["payload"].model_dump(by_alias=True, exclude_none=True)["queryImages"] == [  # type: ignore[attr-defined]
            {
                "accessGrant": "short-lived-grant",
                "uploadFileId": "00000000-0000-4000-8000-000000000001",
            }
        ]
    assert result.inputs == {
        "query": "camera",
        "query_images": [{"filename": "diagram.png", "mime_type": "image/png", "size": 12}],
    }
    assert "short-lived-grant" not in str(result.inputs)
    assert result.outputs["metrics"].value["degradation_flags"] == [
        "degraded-vision-space",
        "degraded-text-space",
    ]


def test_workflow_query_attachment_selector_is_part_of_the_variable_mapping() -> None:
    data = KnowledgeRetrievalV2NodeData.model_validate(
        {
            "control_space_ids": ["space-a"],
            "query_attachment_selector": ["start", "image"],
            "query_variable_selector": ["start", "query"],
            "title": "KnowledgeFS Retrieval",
            "type": "knowledge-retrieval-v2",
        }
    )

    assert KnowledgeRetrievalV2Node._extract_variable_selector_to_variable_mapping(
        graph_config={}, node_id="node-1", node_data=data
    ) == {
        "node-1.query": ["start", "query"],
        "node-1.queryAttachment": ["start", "image"],
    }


def test_node_data_requires_a_query_text_or_a_query_image_variable() -> None:
    image_only = KnowledgeRetrievalV2NodeData.model_validate(
        {
            "control_space_ids": ["space-a"],
            "query_attachment_selector": ["start", "image"],
            "title": "KnowledgeFS Retrieval",
            "type": "knowledge-retrieval-v2",
        }
    )
    assert image_only.query_variable_selector is None
    assert image_only.query_attachment_selector == ["start", "image"]
    assert KnowledgeRetrievalV2Node._extract_variable_selector_to_variable_mapping(
        graph_config={}, node_id="node-1", node_data=image_only
    ) == {"node-1.queryAttachment": ["start", "image"]}

    text_only = KnowledgeRetrievalV2NodeData.model_validate(
        {
            "control_space_ids": ["space-a"],
            "query_attachment_selector": [],
            "query_variable_selector": ["start", "query"],
            "title": "KnowledgeFS Retrieval",
            "type": "knowledge-retrieval-v2",
        }
    )
    assert text_only.query_attachment_selector is None

    for selectors in (
        {},
        {"query_variable_selector": []},
        {"query_variable_selector": [], "query_attachment_selector": []},
    ):
        with pytest.raises(ValidationError, match="query text or a query image"):
            KnowledgeRetrievalV2NodeData.model_validate(
                {
                    "control_space_ids": ["space-a"],
                    "title": "KnowledgeFS Retrieval",
                    "type": "knowledge-retrieval-v2",
                    **selectors,
                }
            )


def test_image_only_query_retrieves_without_text_and_skips_the_text_reranker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runtime_state = _runtime_state("")
    runtime_state.variable_pool.add(
        ["start", "image"],
        FileSegment(
            value=File(
                file_type=FileType.IMAGE,
                transfer_method=FileTransferMethod.LOCAL_FILE,
                reference="00000000-0000-4000-8000-000000000001",
                filename="diagram.png",
                mime_type="image/png",
                size=12,
            )
        ),
    )
    monkeypatch.setattr(
        node_module,
        "issue_workflow_query_image_reference",
        lambda **_kwargs: KnowledgeFSWorkflowQueryImageReference(
            upload_file_id="00000000-0000-4000-8000-000000000001",
            access_grant="short-lived-grant",
            byte_size=12,
            mime_type="image/png",
        ),
    )
    service = RecordingCapabilityService(
        {
            "space-a": _response(mode="fast", score=0.6, space="a", text="A"),
            "space-b": _response(mode="fast", score=0.9, space="b", text="B"),
        }
    )
    rerank_model_manager = RecordingRerankModelManager()

    result = _node(
        service=service,
        spaces=["space-a", "space-b"],
        runtime_state=runtime_state,
        node_data_overrides={
            "metadata_filtering_mode": "automatic",
            "query_attachment_selector": ["start", "image"],
            "query_variable_selector": None,
        },
        rerank_model_manager=rerank_model_manager,
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED, result.error
    assert result.inputs["query"] == ""
    assert result.inputs["query_images"] == [{"filename": "diagram.png", "mime_type": "image/png", "size": 12}]
    for call in service.calls:
        payload = call["payload"].model_dump(by_alias=True, exclude_none=True)  # type: ignore[attr-defined]
        assert "query" not in payload or payload["query"] == ""
        assert payload["queryImages"][0]["uploadFileId"] == "00000000-0000-4000-8000-000000000001"
    # No text to rerank or to extract metadata conditions from: neither model is invoked.
    assert rerank_model_manager.default_calls == []
    assert rerank_model_manager.explicit_calls == []
    metrics = result.outputs["metrics"].value
    assert metrics["workflow_rerank"]["applied"] is False
    assert metrics["workflow_rerank"]["reason"] == "image_only_query"
    assert [item["metadata"]["score"] for item in result.outputs["result"].value] == [0.9, 0.6]


def test_empty_query_without_images_fails_closed_as_a_configuration_error() -> None:
    result = _node(
        service=RecordingCapabilityService({"space-a": _response(mode="fast", score=0.8, space="a", text="A")}),
        spaces=["space-a"],
        runtime_state=_runtime_state("   "),
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "KnowledgeFSRetrievalConfigurationError"
    assert result.error is not None
    assert "query text or at least one query image" in result.error


def test_manual_user_metadata_conditions_are_resolved_and_sent_with_legacy_filters() -> None:
    runtime_state = _runtime_state()
    runtime_state.variable_pool.add(["start", "department"], StringSegment(value="finance"))
    service = RecordingCapabilityService({"space-a": _response(mode="fast", score=0.7, space="space-a", text="A")})

    result = _node(
        service=service,
        spaces=["space-a"],
        runtime_state=runtime_state,
        node_data_overrides={
            "metadata_filtering_mode": "manual",
            "metadata_filtering_conditions": {
                "logical_operator": "and",
                "conditions": [
                    {
                        "comparison_operator": "is",
                        "id": "condition-1",
                        "metadata_id": "knowledge-fs:string:department",
                        "metadata_type": "string",
                        "name": "department",
                        "value": "{{#start.department#}}",
                    }
                ],
            },
        },
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    payload = service.calls[0]["payload"]
    assert payload.filters.document_types == ["handbook"]  # type: ignore[attr-defined]
    assert payload.filters.custom_metadata.model_dump(by_alias=True, exclude_none=True) == {  # type: ignore[attr-defined]
        "conditions": [
            {
                "comparisonOperator": "is",
                "fieldType": "string",
                "name": "department",
                "value": "finance",
            }
        ],
        "logicalOperator": "and",
    }


def test_disabled_user_metadata_conditions_do_not_change_existing_retrievals() -> None:
    service = RecordingCapabilityService({"space-a": _response(mode="fast", score=0.7, space="space-a", text="A")})

    _node(
        service=service,
        spaces=["space-a"],
        node_data_overrides={
            "metadata_filtering_mode": "disabled",
            "metadata_filtering_conditions": {
                "logical_operator": "and",
                "conditions": [
                    {
                        "comparison_operator": "is",
                        "id": "condition-1",
                        "metadata_type": "string",
                        "name": "department",
                        "value": "finance",
                    }
                ],
            },
        },
    )._run()

    payload = service.calls[0]["payload"]
    assert payload.filters.custom_metadata is None  # type: ignore[attr-defined]


def test_automatic_metadata_conditions_are_extracted_from_the_shared_catalog_and_sent() -> None:
    service = RecordingCapabilityService(
        {
            "space-a": _response(mode="fast", score=0.7, space="space-a", text="A"),
            "space-b": _response(mode="fast", score=0.6, space="space-b", text="B"),
        },
        metadata_fields={
            "space-a": _metadata_fields(("department", "string"), ("year", "number"), ("published_at", "time")),
            "space-b": _metadata_fields(("department", "string"), ("year", "string"), ("published_at", "time")),
        },
    )
    usage = LLMUsage.empty_usage().model_copy(update={"prompt_tokens": 30, "completion_tokens": 12, "total_tokens": 42})
    extractor = RecordingMetadataFilterExtractor(
        [
            {"metadata_field_name": " department ", "metadata_field_value": "finance", "comparison_operator": "="},
            {"metadata_field_name": "year", "metadata_field_value": "2024", "comparison_operator": "="},
            {"metadata_field_name": "published_at", "metadata_field_value": "2024-01-01", "comparison_operator": ">="},
            {"metadata_field_name": "owner", "metadata_field_value": "alice", "comparison_operator": "is"},
        ],
        usage=usage,
    )

    result = _node(
        service=service,
        spaces=["space-a", "space-b"],
        metadata_filter_extractor=extractor,
        node_data_overrides={
            "metadata_filtering_mode": "automatic",
            "metadata_model_config": AUTOMATIC_MODEL_CONFIG,
        },
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert len(extractor.calls) == 1
    assert extractor.calls[0]["query"] == "camera"
    assert extractor.calls[0]["field_names"] == ["department", "published_at"]
    assert extractor.calls[0]["model_config"].name == "gpt-4o-mini"  # type: ignore[attr-defined]
    assert [call["caller_kind"] for call in service.metadata_calls] == [
        node_module.KnowledgeFSAppSpaceJoinType.WORKFLOW,
        node_module.KnowledgeFSAppSpaceJoinType.WORKFLOW,
    ]
    for call in service.calls:
        payload = call["payload"]
        assert payload.filters.document_types == ["handbook"]  # type: ignore[attr-defined]
        assert payload.filters.custom_metadata.model_dump(by_alias=True, exclude_none=True) == {  # type: ignore[attr-defined]
            "conditions": [
                {
                    "comparisonOperator": "is",
                    "fieldType": "string",
                    "name": "department",
                    "value": "finance",
                },
                {
                    "comparisonOperator": "after",
                    "fieldType": "time",
                    "name": "published_at",
                    "value": "2024-01-01",
                },
            ],
            "logicalOperator": "or",
        }
    assert result.outputs["metrics"].value["metadata_filtering"] == {
        "applied": True,
        "condition_count": 2,
        "extracted_count": 4,
        "field_names": ["department", "published_at"],
        "mode": "automatic",
        "model": "gpt-4o-mini",
        "provider": "openai",
    }
    assert result.llm_usage.total_tokens == 42
    assert result.metadata[WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS] == 42


def test_automatic_metadata_filter_reuses_the_configured_logical_operator_and_coerces_numbers() -> None:
    service = RecordingCapabilityService(
        {"space-a": _response(mode="fast", score=0.7, space="space-a", text="A")},
        metadata_fields={"space-a": _metadata_fields(("year", "number"), ("department", "string"))},
    )
    extractor = RecordingMetadataFilterExtractor(
        [
            {"metadata_field_name": "year", "metadata_field_value": "2024", "comparison_operator": ">="},
            {"metadata_field_name": "year", "metadata_field_value": "not-a-number", "comparison_operator": "<"},
            {"metadata_field_name": "department", "metadata_field_value": None, "comparison_operator": "not empty"},
            {"metadata_field_name": "department", "metadata_field_value": "x", "comparison_operator": "matches"},
        ]
    )

    result = _node(
        service=service,
        spaces=["space-a"],
        metadata_filter_extractor=extractor,
        node_data_overrides={
            "metadata_filtering_mode": "automatic",
            "metadata_model_config": AUTOMATIC_MODEL_CONFIG,
            "metadata_filtering_conditions": {"logical_operator": "and", "conditions": []},
        },
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    payload = service.calls[0]["payload"]
    assert payload.filters.custom_metadata.model_dump(by_alias=True, exclude_none=True) == {  # type: ignore[attr-defined]
        "conditions": [
            {"comparisonOperator": "≥", "fieldType": "number", "name": "year", "value": 2024},
            {"comparisonOperator": "not empty", "fieldType": "string", "name": "department"},
        ],
        "logicalOperator": "and",
    }
    assert result.outputs["metrics"].value["metadata_filtering"]["condition_count"] == 2
    assert result.outputs["metrics"].value["metadata_filtering"]["extracted_count"] == 4


def test_automatic_metadata_filter_skips_extraction_without_shared_fields() -> None:
    service = RecordingCapabilityService(
        {
            "space-a": _response(mode="fast", score=0.7, space="space-a", text="A"),
            "space-b": _response(mode="fast", score=0.6, space="space-b", text="B"),
        },
        metadata_fields={
            "space-a": _metadata_fields(("department", "string")),
            "space-b": _metadata_fields(("department", "number")),
        },
    )
    extractor = RecordingMetadataFilterExtractor([])

    result = _node(
        service=service,
        spaces=["space-a", "space-b"],
        metadata_filter_extractor=extractor,
        node_data_overrides={
            "metadata_filtering_mode": "automatic",
            "metadata_model_config": AUTOMATIC_MODEL_CONFIG,
        },
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert extractor.calls == []
    assert all(call["payload"].filters.custom_metadata is None for call in service.calls)  # type: ignore[attr-defined]
    assert result.outputs["metrics"].value["metadata_filtering"] == {
        "applied": False,
        "condition_count": 0,
        "extracted_count": 0,
        "field_names": [],
        "mode": "automatic",
        "reason": "no_shared_metadata_fields",
    }
    assert result.metadata == {}


def test_automatic_metadata_filter_fails_open_when_the_llm_extraction_breaks() -> None:
    service = RecordingCapabilityService(
        {"space-a": _response(mode="fast", score=0.7, space="space-a", text="A")},
        metadata_fields={"space-a": _metadata_fields(("department", "string"))},
    )
    extractor = RecordingMetadataFilterExtractor(RuntimeError("llm timeout"))

    result = _node(
        service=service,
        spaces=["space-a"],
        metadata_filter_extractor=extractor,
        node_data_overrides={
            "metadata_filtering_mode": "automatic",
            "metadata_model_config": AUTOMATIC_MODEL_CONFIG,
        },
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert service.calls[0]["payload"].filters.custom_metadata is None  # type: ignore[attr-defined]
    assert result.outputs["metrics"].value["metadata_filtering"] == {
        "applied": False,
        "condition_count": 0,
        "extracted_count": 0,
        "field_names": ["department"],
        "mode": "automatic",
        "model": "gpt-4o-mini",
        "provider": "openai",
        "reason": "extraction_failed",
    }


def test_automatic_metadata_filter_reports_no_conditions_when_the_llm_finds_none() -> None:
    service = RecordingCapabilityService(
        {"space-a": _response(mode="fast", score=0.7, space="space-a", text="A")},
        metadata_fields={"space-a": _metadata_fields(("department", "string"))},
    )

    result = _node(
        service=service,
        spaces=["space-a"],
        metadata_filter_extractor=RecordingMetadataFilterExtractor([]),
        node_data_overrides={
            "metadata_filtering_mode": "automatic",
            "metadata_model_config": AUTOMATIC_MODEL_CONFIG,
        },
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert service.calls[0]["payload"].filters.custom_metadata is None  # type: ignore[attr-defined]
    assert result.outputs["metrics"].value["metadata_filtering"]["reason"] == "no_conditions_extracted"


def test_automatic_metadata_filter_fails_closed_on_missing_model_or_catalog_rejection() -> None:
    extractor = RecordingMetadataFilterExtractor([])
    missing_model = _node(
        service=RecordingCapabilityService(
            {"space-a": _response(mode="fast", score=0.7, space="space-a", text="A")},
            metadata_fields={"space-a": _metadata_fields(("department", "string"))},
        ),
        spaces=["space-a"],
        metadata_filter_extractor=extractor,
        node_data_overrides={"metadata_filtering_mode": "automatic"},
    )._run()
    unavailable_model = _node(
        service=RecordingCapabilityService(
            {"space-a": _response(mode="fast", score=0.7, space="space-a", text="A")},
            metadata_fields={"space-a": _metadata_fields(("department", "string"))},
        ),
        spaces=["space-a"],
        metadata_filter_extractor=RecordingMetadataFilterExtractor(
            KnowledgeFSRetrievalConfigurationError("metadata model unavailable")
        ),
        node_data_overrides={
            "metadata_filtering_mode": "automatic",
            "metadata_model_config": AUTOMATIC_MODEL_CONFIG,
        },
    )._run()
    catalog_rejected_service = RecordingCapabilityService(
        {"space-a": _response(mode="fast", score=0.7, space="space-a", text="A")},
        metadata_fields={"space-a": KnowledgeFSAppChannelDisabledError("KnowledgeFS workflow channel is disabled")},
    )
    catalog_rejected = _node(
        service=catalog_rejected_service,
        spaces=["space-a"],
        metadata_filter_extractor=extractor,
        node_data_overrides={
            "metadata_filtering_mode": "automatic",
            "metadata_model_config": AUTOMATIC_MODEL_CONFIG,
        },
    )._run()

    assert missing_model.status == WorkflowNodeExecutionStatus.FAILED
    assert missing_model.error_type == "KnowledgeFSRetrievalConfigurationError"
    assert missing_model.error == "KnowledgeFS automatic metadata filtering requires a metadata filtering model"
    assert unavailable_model.status == WorkflowNodeExecutionStatus.FAILED
    assert unavailable_model.error_type == "KnowledgeFSRetrievalConfigurationError"
    assert unavailable_model.error == "metadata model unavailable"
    assert catalog_rejected.status == WorkflowNodeExecutionStatus.FAILED
    assert catalog_rejected.error_type == "KnowledgeFSRetrievalBindingError"
    assert catalog_rejected.error is not None
    assert catalog_rejected.error.startswith("[knowledge_fs_workflow_access_disabled] ")
    assert catalog_rejected_service.calls == []
    assert extractor.calls == []


def test_automatic_metadata_catalog_follows_pagination_cursors() -> None:
    class PagedCapabilityService(RecordingCapabilityService):
        def list_metadata_fields(self, **kwargs: object) -> KnowledgeFSMetadataFieldListResponse:
            self.metadata_calls.append(kwargs)
            if kwargs["cursor"] is None:
                page = _metadata_fields(("department", "string"))
                return page.model_copy(update={"next_cursor": "cursor-2"})
            return _metadata_fields(("year", "number"))

    service = PagedCapabilityService({"space-a": _response(mode="fast", score=0.7, space="space-a", text="A")})
    extractor = RecordingMetadataFilterExtractor([])

    result = _node(
        service=service,
        spaces=["space-a"],
        metadata_filter_extractor=extractor,
        node_data_overrides={
            "metadata_filtering_mode": "automatic",
            "metadata_model_config": AUTOMATIC_MODEL_CONFIG,
        },
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert [call["cursor"] for call in service.metadata_calls] == [None, "cursor-2"]
    assert [call["limit"] for call in service.metadata_calls] == [100, 100]
    assert extractor.calls[0]["field_names"] == ["department", "year"]


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
    assert result.outputs["metrics"].value["workflow_rerank"] == {
        "applied": False,
        "candidate_count": 0,
        "duration_ms": 0.0,
        "output_count": 0,
        "score_threshold": None,
        "source": "system-default",
        "top_k": 10,
    }
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


def test_custom_workflow_reranker_applies_threshold_and_top_k_without_recording_a_raw_miss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dispatched: list[dict[str, object]] = []
    monkeypatch.setattr(
        node_module,
        "enqueue_workflow_failed_retrieval_capture",
        lambda **kwargs: dispatched.append(kwargs),
    )
    rerank_model = RecordingRerankModel({"A": 0.81, "B": 0.59, "C": 0.92})
    rerank_manager = RecordingRerankModelManager(rerank_model)
    result = _node(
        service=RecordingCapabilityService(
            {
                "space-a": _response(mode="fast", score=0.99, space="a", text="A"),
                "space-b": _response(mode="fast", score=0.20, space="b", text="B"),
                "space-c": _response(mode="fast", score=0.10, space="c", text="C"),
            }
        ),
        spaces=["space-a", "space-b", "space-c"],
        top_n=2,
        rerank_model_manager=rerank_manager,
        node_data_overrides={
            "reranking_model": {"provider": "cohere", "model": "rerank-v3.5"},
            "score_threshold": 0.8,
        },
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert [item["content"] for item in result.outputs["result"].value] == ["C", "A"]
    assert [item["metadata"]["score"] for item in result.outputs["result"].value] == [0.92, 0.81]
    assert rerank_manager.default_calls == []
    assert rerank_manager.explicit_calls == [
        {
            "tenant_id": "tenant-1",
            "provider": "cohere",
            "model_type": node_module.ModelType.RERANK,
            "model": "rerank-v3.5",
        }
    ]
    assert result.outputs["metrics"].value["workflow_rerank"]["source"] == "custom"
    assert dispatched == []


def test_threshold_filtered_results_are_not_recorded_as_a_raw_retrieval_miss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dispatched: list[dict[str, object]] = []
    monkeypatch.setattr(
        node_module,
        "enqueue_workflow_failed_retrieval_capture",
        lambda **kwargs: dispatched.append(kwargs),
    )
    result = _node(
        service=RecordingCapabilityService({"space-a": _response(mode="fast", score=0.91, space="a", text="A")}),
        spaces=["space-a"],
        rerank_model_manager=RecordingRerankModelManager(RecordingRerankModel({"A": 0.42})),
        node_data_overrides={"score_threshold": 0.8},
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert result.outputs["result"].value == []
    assert result.outputs["metrics"].value["workflow_rerank"]["output_count"] == 0
    assert dispatched == []


def test_missing_system_reranker_is_an_actionable_configuration_failure() -> None:
    class MissingDefaultRerankManager(RecordingRerankModelManager):
        def get_default_model_instance(self, tenant_id: str, model_type: object) -> RecordingRerankModel:
            _ = tenant_id, model_type
            raise node_module.ProviderTokenNotInitError("Default rerank model is missing")

    result = _node(
        service=RecordingCapabilityService({"space-a": _response(mode="fast", score=0.91, space="a", text="A")}),
        spaces=["space-a"],
        rerank_model_manager=MissingDefaultRerankManager(),
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "KnowledgeFSRetrievalConfigurationError"
    assert result.error == "Workflow rerank model is not configured or is unavailable"


def test_invalid_global_rerank_indices_fail_closed_as_a_contract_error() -> None:
    class InvalidRerankModel(RecordingRerankModel):
        def invoke_rerank(self, **kwargs: object) -> RerankResult:
            self.calls.append(kwargs)
            return RerankResult(
                model=self.model_name,
                docs=[RerankDocument(index=2, text="unknown", score=0.9)],
            )

    result = _node(
        service=RecordingCapabilityService({"space-a": _response(mode="fast", score=0.91, space="a", text="A")}),
        spaces=["space-a"],
        rerank_model_manager=RecordingRerankModelManager(InvalidRerankModel()),
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert result.error_type == "KnowledgeFSRetrievalContractError"
    assert result.error == "Workflow rerank model returned invalid document indices"


def test_balanced_pool_does_not_let_one_space_fill_the_global_rerank_budget() -> None:
    def response_with_items(space: str, count: int) -> KnowledgeFSRetrievalTestResponse:
        base = _response(mode="fast", score=0.9, space=space, text=f"{space}-0").model_dump(by_alias=True)
        template = base["items"][0]
        base["items"] = [
            {
                **template,
                "nodeId": f"node-{space}-{index}",
                "score": 1 - index * 0.001,
                "text": f"{space}-{index}",
            }
            for index in range(count)
        ]
        return KnowledgeFSRetrievalTestResponse.model_validate(base)

    rerank_model = RecordingRerankModel()
    result = _node(
        service=RecordingCapabilityService(
            {
                "space-a": response_with_items("a", 50),
                "space-b": response_with_items("b", 3),
            }
        ),
        spaces=["space-a", "space-b"],
        top_n=10,
        rerank_model_manager=RecordingRerankModelManager(rerank_model),
    )._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert rerank_model.calls[0]["docs"][:6] == ["a-0", "b-0", "a-1", "b-1", "a-2", "b-2"]
    assert len(rerank_model.calls[0]["docs"]) == 40


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
