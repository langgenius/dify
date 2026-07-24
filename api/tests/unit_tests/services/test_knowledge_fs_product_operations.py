from __future__ import annotations

import json
from pathlib import Path

from services.knowledge_fs.product_operations import (
    KNOWLEDGE_FS_PRODUCT_OPERATIONS,
    is_product_operation_ready,
    is_product_operation_registered,
    knowledge_fs_product_operation_gaps,
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
        "bulkDeleteDocuments",
        "cancelBackgroundTask",
        "cancelCompilationJob",
        "cancelResearchTask",
        "completeUploadSession",
        "crawlSource",
        "createQuery",
        "createResearchTask",
        "createSource",
        "createUploadSession",
        "deleteDocument",
        "deleteSource",
        "getBulkJob",
        "getCompilationJob",
        "getDocument",
        "getDocumentChunk",
        "getDocumentOutline",
        "getOverviewHealth",
        "getOverviewInventory",
        "getOverviewQueryOutcomes",
        "getOverviewStats",
        "getResearchTask",
        "getSettings",
        "getSource",
        "getSpace",
        "getTrace",
        "importSourceFiles",
        "importSourcePages",
        "listDocumentChunks",
        "listDocumentRevisions",
        "listDocuments",
        "listBackgroundTasks",
        "listResearchTaskPartials",
        "listResearchTasks",
        "listSources",
        "listSourceFiles",
        "listSourcePages",
        "listTraceConflicts",
        "listTraceEvidence",
        "listTraceMissing",
        "listTraces",
        "planResearchTask",
        "presignUploadSessionPart",
        "reindexDocuments",
        "retryBackgroundTask",
        "retryCompilationJob",
        "streamResearchTask",
        "testSource",
        "updateDocumentMetadata",
        "updateSettings",
        "updateSource",
        "updateSpace",
        "uploadSmallFile",
    }
    assert registered_ids == ready_ids | {"createDocument"}
    for operation_id in registered_ids:
        product_operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        assert product_operation.capability_operation_id is not None
        capability_operation = KNOWLEDGE_FS_CAPABILITY_OPERATIONS[product_operation.capability_operation_id]
        assert product_operation.method == capability_operation.method
        assert product_operation.kfs_path == capability_operation.path
        assert product_operation.action == capability_operation.action
        assert product_operation.resource_resolver == capability_operation.resource_type
        assert product_operation.permission == product_operation.rbac_permission
        assert product_operation.billing_cost > 0
        assert product_operation.rate_limit_cost > 0
        assert product_operation.rate_limit_bucket in {"direct", "import", "job", "query", "read", "write"}
        assert product_operation.max_request_bytes >= 0
        assert product_operation.max_response_bytes >= 0
        if product_operation.transport == "json":
            assert product_operation.stream_kind == "json"
            assert product_operation.max_response_bytes > 0

    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS["reindexDocuments"].rate_limit_bucket == "import"
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS["createResearchTask"].rate_limit_bucket == "query"
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS["getCompilationJob"].rate_limit_bucket == "job"
    assert KNOWLEDGE_FS_PRODUCT_OPERATIONS["uploadSmallFile"].max_request_bytes == 8 * 1024 * 1024


def test_manifest_gaps_remain_explicit_and_stable() -> None:
    expected = ("createDocument",)
    assert knowledge_fs_product_operation_gaps() == expected
    manifest_path = Path(__file__).resolve().parents[3] / "knowledge-fs-product-operation-gaps.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["schemaVersion"] == 2
    assert tuple(item["productOperationId"] for item in manifest["gaps"]) == expected
    gap = manifest["gaps"][0]
    assert gap["kfsOperationId"] == "uploadDocument"
    assert gap["reasonCode"] == "NON_HOMOMORPHIC_MULTIPART_TRANSPORT"
    assert gap["replacementProductOperationIds"] == [
        "createUploadSession",
        "presignUploadSessionPart",
        "uploadSmallFile",
        "completeUploadSession",
        "abortUploadSession",
    ]
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
