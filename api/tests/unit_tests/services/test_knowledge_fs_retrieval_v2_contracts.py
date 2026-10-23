from __future__ import annotations

import math
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from graphon.model_runtime.entities.rerank_entities import RerankDocument, RerankResult
from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from services.knowledge_fs.knowledge_retrieval_v2 import knowledge_retrieval_v2_node as node_module
from services.knowledge_fs.knowledge_retrieval_v2.entities import (
    KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE,
    KnowledgeRetrievalV2NodeData,
)
from services.knowledge_fs.knowledge_retrieval_v2.exc import KnowledgeFSRetrievalContractError
from services.knowledge_fs.knowledge_retrieval_v2.knowledge_retrieval_v2_node import KnowledgeRetrievalV2Node
from services.knowledge_fs.knowledge_retrieval_v2.validation import (
    collect_control_space_ids,
    missing_control_space_ids,
    validate_control_space_references,
)
from services.knowledge_fs.retrieval_contracts import KnowledgeFSRetrievalTestItemResponse


def _node_data(**overrides: object) -> dict[str, object]:
    return {
        "type": KNOWLEDGE_RETRIEVAL_V2_NODE_TYPE,
        "title": "Agent Knowledge Retrieval",
        "control_space_ids": ["space-a"],
        "query_variable_selector": ["start", "query"],
        **overrides,
    }


def _graph(*nodes: object) -> dict[str, object]:
    return {"nodes": list(nodes)}


def _item(
    *, text: str | None, section_path: list[str], node_id: str = "node-a"
) -> KnowledgeFSRetrievalTestItemResponse:
    return KnowledgeFSRetrievalTestItemResponse.model_validate(
        {
            "citation": {
                "artifactHash": "a" * 64,
                "documentAssetId": "document-a",
                "documentTitle": "a.pdf",
                "documentVersion": 1,
                "knowledgeSpaceName": "Space A",
                "logicalDocumentId": "logical-a",
                "logicalDocumentRevision": 1,
                "pageNumber": 1,
                "sectionPath": section_path,
            },
            "nodeId": node_id,
            "projectionIds": ["projection-a"],
            "score": 0.5,
            "sources": ["dense"],
            "text": text,
        }
    )


def _candidates(count: int) -> list[node_module._WorkflowRerankCandidate]:
    return [
        node_module._WorkflowRerankCandidate(
            control_space_id="space-a",
            item=_item(text=f"text {index}", section_path=[], node_id=f"node-{index}"),
            item_index=index,
            space_index=0,
        )
        for index in range(count)
    ]


def _active_space(space_id: str, *, tenant_id: str = "tenant-1") -> KnowledgeFSControlSpace:
    space = KnowledgeFSControlSpace(
        tenant_id=tenant_id,
        owner_account_id="account-1",
        provisioning_key=f"provision-{space_id}",
        knowledge_space_id=f"knowledge-{space_id}",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    space.id = space_id
    return space


def test_collect_control_space_ids_ignores_malformed_graphs_and_foreign_nodes() -> None:
    assert collect_control_space_ids({"nodes": "not-a-list"}) == ()
    assert collect_control_space_ids(
        _graph(
            "not-a-node",
            {"data": "not-a-mapping"},
            {"data": {"type": "knowledge-retrieval"}},
            {"data": _node_data(control_space_ids=["space-b", "space-a"])},
        )
    ) == ("space-b", "space-a")


def test_reference_validation_skips_the_database_without_v2_nodes() -> None:
    # A graph without KnowledgeFS nodes must not need a session at all.
    assert missing_control_space_ids(session=Session(), tenant_id="tenant-1", graph=_graph()) == ()
    validate_control_space_references(session=Session(), tenant_id="tenant-1", graph=_graph())


def test_reference_validation_rejects_spaces_outside_the_tenant(sqlite_session: Session) -> None:
    sqlite_session.add_all([_active_space("space-a"), _active_space("space-b", tenant_id="tenant-2")])
    sqlite_session.flush()
    graph = _graph({"data": _node_data(control_space_ids=["space-a", "space-b"])})

    with pytest.raises(ValueError, match="missing or inactive in this workspace: space-b$"):
        validate_control_space_references(session=sqlite_session, tenant_id="tenant-1", graph=graph)

    validate_control_space_references(
        session=sqlite_session,
        tenant_id="tenant-1",
        graph=_graph({"data": _node_data(control_space_ids=["space-a"])}),
    )


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"control_space_ids": ["space-a", "  "]}, "IDs must be non-empty"),
        ({"query_variable_selector": ["start"]}, "query variable selector must contain at least two parts"),
        ({"query_variable_selector": ["start", " "]}, "query variable selector must be non-empty"),
        ({"query_attachment_selector": ["start"]}, "query attachment selector must contain at least two parts"),
        ({"query_attachment_selector": ["start", " "]}, "query attachment selector must be non-empty"),
    ],
)
def test_node_data_rejects_malformed_identifiers_and_selectors(overrides: dict[str, object], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        KnowledgeRetrievalV2NodeData.model_validate(_node_data(**overrides))


def test_node_data_treats_empty_selectors_as_unbound() -> None:
    node_data = KnowledgeRetrievalV2NodeData.model_validate(
        _node_data(query_variable_selector=[], query_attachment_selector=["start", "image"])
    )

    assert node_data.query_variable_selector is None
    assert node_data.query_attachment_selector == ["start", "image"]
    assert (
        KnowledgeRetrievalV2NodeData.model_validate(_node_data(query_attachment_selector=[])).query_attachment_selector
        is None
    )


def test_variable_mapping_omits_unbound_query_attachment() -> None:
    node_data = KnowledgeRetrievalV2NodeData.model_validate(_node_data())

    assert KnowledgeRetrievalV2Node._extract_variable_selector_to_variable_mapping(
        graph_config={},
        node_id="retrieval",
        node_data=node_data,
    ) == {"retrieval.query": ["start", "query"]}


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("tag", "tag"),
        (1.5, 1.5),
        (3, 3),
        (True, "True"),
        (datetime(2026, 1, 2, tzinfo=UTC), "2026-01-02 00:00:00+00:00"),
    ],
)
def test_manual_metadata_values_are_normalized_to_contract_scalars(value: object, expected: object) -> None:
    assert node_module._normalize_metadata_filter_scalar(value) == expected


def test_rerank_text_falls_back_to_section_path_then_node_id() -> None:
    assert KnowledgeRetrievalV2Node._rerank_text(_item(text="  body  ", section_path=["A"])) == "body"
    assert KnowledgeRetrievalV2Node._rerank_text(_item(text=" ", section_path=[" Camera ", " ", "Lens"])) == (
        "Camera / Lens"
    )
    assert KnowledgeRetrievalV2Node._rerank_text(_item(text=None, section_path=[], node_id="node-z")) == "node-z"


def test_rerank_result_validation_keeps_model_order_and_rejects_bad_scores() -> None:
    candidates = _candidates(2)

    ranked = KnowledgeRetrievalV2Node._validate_rerank_result(
        result=RerankResult(
            model="rerank",
            docs=[RerankDocument(index=1, text="text 1", score=0.9), RerankDocument(index=0, text="text 0", score=0.1)],
        ),
        candidates=candidates,
    )
    assert ranked == [(0.9, candidates[1]), (0.1, candidates[0])]

    with pytest.raises(KnowledgeFSRetrievalContractError, match="non-finite score"):
        KnowledgeRetrievalV2Node._validate_rerank_result(
            result=RerankResult(model="rerank", docs=[RerankDocument(index=0, text="text 0", score=math.nan)]),
            candidates=candidates,
        )
    with pytest.raises(KnowledgeFSRetrievalContractError, match="invalid document indices"):
        KnowledgeRetrievalV2Node._validate_rerank_result(
            result=RerankResult(model="rerank", docs=[RerankDocument(index=-1, text="text", score=0.5)]),
            candidates=candidates,
        )
