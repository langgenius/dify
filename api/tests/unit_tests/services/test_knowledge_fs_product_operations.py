from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.knowledge_fs.product_operations import (
    KNOWLEDGE_FS_PRODUCT_OPERATIONS,
    is_product_operation_ready,
    is_product_operation_registered,
    knowledge_fs_product_operation_gaps,
    product_operation_action,
)
from services.knowledge_fs_capability import KNOWLEDGE_FS_CAPABILITY_OPERATIONS


def test_ready_product_operations_exactly_match_capability_method_path_and_action() -> None:
    registered_ids = {
        operation_id
        for operation_id in KNOWLEDGE_FS_PRODUCT_OPERATIONS
        if is_product_operation_registered(operation_id)
    }
    ready_ids = {
        operation_id for operation_id in KNOWLEDGE_FS_PRODUCT_OPERATIONS if is_product_operation_ready(operation_id)
    }

    assert ready_ids == {
        "abortUploadSession",
        "batchSpaceSummaries",
        "bulkUpdateLogicalDocumentAvailability",
        "bulkImportGoldenQuestions",
        "bulkDeleteDocuments",
        "bulkDeleteLogicalDocuments",
        "cancelBackgroundTask",
        "cancelCompilationJob",
        "cancelResearchTask",
        "cancelSourceWorkflow",
        "captureWorkflowFailedRetrieval",
        "catKnowledgeFs",
        "completeUploadSession",
        "crawlSource",
        "createDocument",
        "createGoldenQuestion",
        "createMetadataField",
        "createQuery",
        "createQualityBadCase",
        "createQualityReplay",
        "createResearchTask",
        "createSource",
        "createSourceConnection",
        "createUploadSession",
        "deleteDocument",
        "deleteGoldenQuestion",
        "deleteLogicalDocument",
        "deleteMetadataField",
        "deleteSource",
        "diffKnowledgeFs",
        "findKnowledgeFs",
        "getBulkJob",
        "getCompilationJob",
        "getDocument",
        "getDocumentChunk",
        "getDocumentMultimodalManifest",
        "getDocumentOutline",
        "getQualityBadCase",
        "getQualityBadCaseTraceReference",
        "getQualityReplay",
        "getLogicalDocument",
        "getOverviewHealth",
        "getOverviewInventory",
        "getOverviewQueryOutcomes",
        "getOverviewStats",
        "listOverviewActivity",
        "listOverviewAttention",
        "getProfileMigration",
        "getResearchTask",
        "getSettings",
        "getSource",
        "getSourceSyncPolicy",
        "getSourceWorkflow",
        "getSpace",
        "getTrace",
        "grepKnowledgeFs",
        "importSourceWorkflow",
        "importSelectedSourceCrawl",
        "importSourceFiles",
        "importSourcePages",
        "listDocumentChunks",
        "listDocumentRevisions",
        "listDocuments",
        "listGoldenQuestions",
        "listKnowledgeFs",
        "listLogicalDocuments",
        "listMetadataFields",
        "listBackgroundTasks",
        "listCrawlPreviewPages",
        "listResearchTaskPartials",
        "listResearchTasks",
        "listSources",
        "listQualityBadCases",
        "listQualityReplays",
        "listSourceConnections",
        "listSourceFiles",
        "listSourcePages",
        "listSourceProviders",
        "listTraceConflicts",
        "listTraceEvidence",
        "listTraceMissing",
        "listTraces",
        "matchGoldenQuestionEvidence",
        "planResearchTask",
        "presignUploadSessionPart",
        "previewSourceCrawl",
        "reindexDocuments",
        "refreshSourceConnection",
        "retryBackgroundTask",
        "retryCompilationJob",
        "retrySourceWorkflow",
        "retrieveEvidence",
        "selectCrawlPreviewPages",
        "streamResearchTask",
        "syncSource",
        "testSource",
        "statKnowledgeFs",
        "treeKnowledgeFs",
        "updateDocumentMetadata",
        "updateEmbeddingProfile",
        "updateGoldenQuestion",
        "updateLogicalDocumentAvailability",
        "updateMetadataField",
        "updateQualityBadCase",
        "updateRetrievalProfile",
        "updateSettings",
        "updateSource",
        "updateSourceSyncPolicy",
        "updateSpace",
        "uploadSmallFile",
    }
    assert registered_ids == ready_ids
    for operation_id in registered_ids:
        product_operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        assert product_operation.capability_operation_id is not None
        capability_operation = KNOWLEDGE_FS_CAPABILITY_OPERATIONS[product_operation.capability_operation_id]
        assert product_operation.method == capability_operation.method
        assert product_operation.kfs_path == capability_operation.path
        assert product_operation.action == capability_operation.action
        assert product_operation.resource_resolver == capability_operation.resource_type
        assert product_operation.permission == product_operation.rbac_permission
        assert product_operation.max_request_bytes >= 0
        assert product_operation.max_response_bytes >= 0
        if product_operation.transport == "json":
            assert product_operation.stream_kind == "json"
            assert product_operation.max_response_bytes > 0

    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS["createDocument"].max_request_bytes == 15 * 1024 * 1024
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS["getQualityReplay"].max_request_bytes == 16 * 1024
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS["importSourceWorkflow"].max_request_bytes == 4 * 1024 * 1024
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS["uploadSmallFile"].max_request_bytes == 15 * 1024 * 1024


def test_source_workflow_import_byte_limit_accepts_the_full_schema_bounded_batch() -> None:
    operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS["importSourceWorkflow"]
    max_width = "😀"
    item = {
        "etag": max_width * 1_024,
        "lastEditedTime": max_width * 128,
        "name": max_width * 500,
        "pageId": max_width * 1_024,
        "providerItemId": max_width * 1_024,
        "type": max_width * 128,
        "workspaceId": max_width * 1_024,
    }
    payload = {"kind": "online-document-import", "items": [item] * 200}
    serialized = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()

    assert len(serialized) <= operation.max_request_bytes


def test_manifest_gaps_remain_explicit_and_stable() -> None:
    expected = ()
    assert knowledge_fs_product_operation_gaps() == expected
    manifest_path = Path(__file__).resolve().parents[3] / "knowledge-fs-product-operation-gaps.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["schemaVersion"] == 2
    assert tuple(item["productOperationId"] for item in manifest["gaps"]) == expected
    assert manifest["internalKfsOperationExclusions"] == [
        {
            "kfsOperationId": "activateDifyWorkspaceIntegration",
            "reasonCode": "INTERNAL_CONTROL_PLANE_ONLY",
            "reason": (
                "Workspace activation is an internal cutover control-plane operation and is never exposed as a "
                "product operation."
            ),
        },
        {
            "kfsOperationId": "freezeDifyWorkspaceIntegration",
            "reasonCode": "INTERNAL_CONTROL_PLANE_ONLY",
            "reason": (
                "Workspace maintenance freeze is an internal cutover control-plane operation and is never exposed "
                "as a product operation."
            ),
        },
    ]


def test_unregistered_product_operations_fail_closed() -> None:
    operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS["getSpace"]

    assert operation._replace(capability_operation_id=None).action is None
    assert operation._replace(capability_operation_id="unknown-operation").action is None
    assert is_product_operation_registered("unknown-operation") is False
    with pytest.raises(KeyError, match="unknown-operation"):
        product_operation_action("unknown-operation")
