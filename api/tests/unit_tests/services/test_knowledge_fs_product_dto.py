from __future__ import annotations

import pytest
from pydantic import ValidationError

from services.knowledge_fs.product_dto import (
    KnowledgeFSBackgroundTaskListQuery,
    KnowledgeFSBackgroundTaskListResponse,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSOverviewBaseStatsResponse,
    KnowledgeFSOverviewHealthResponse,
    KnowledgeFSOverviewInventoryResponse,
    KnowledgeFSOverviewQueryOutcomesResponse,
    KnowledgeFSOverviewWindowQuery,
)


def test_background_task_dtos_accept_the_knowledge_fs_wire_shape() -> None:
    response = KnowledgeFSBackgroundTaskListResponse.model_validate(
        {
            "items": [
                {
                    "canCancel": False,
                    "canRetry": True,
                    "completedAt": "2026-07-23T12:02:00.000Z",
                    "createdAt": "2026-07-23T12:00:00.000Z",
                    "documentId": "document-1",
                    "documentRevision": 2,
                    "errorCode": "EMBEDDING_FAILED",
                    "errorMessage": "embedding failed",
                    "id": "task-1",
                    "knowledgeSpaceId": "space-1",
                    "operation": "document_reindex",
                    "progressCompleted": 8,
                    "progressFailed": 1,
                    "progressPercent": 75,
                    "progressTotal": 12,
                    "state": "failed",
                    "taskKind": "document_bulk",
                    "updatedAt": "2026-07-23T12:02:00.000Z",
                }
            ],
            "nextCursor": "cursor-2",
        }
    )

    assert response.next_cursor == "cursor-2"
    assert response.data[0].task_kind == "document_bulk"
    assert response.data[0].progress_completed == 8
    assert response.data[0].can_retry is True


@pytest.mark.parametrize("payload", [{"limit": 0}, {"limit": 101}, {"cursor": ""}])
def test_background_task_query_rejects_invalid_limits_and_empty_cursors(
    payload: dict[str, object],
) -> None:
    assert KnowledgeFSBackgroundTaskListQuery().limit == 50

    with pytest.raises(ValidationError):
        KnowledgeFSBackgroundTaskListQuery.model_validate(payload)


def test_bulk_job_dto_accepts_canceled_items_and_terminal_status() -> None:
    response = KnowledgeFSBulkJobResponse.model_validate(
        {
            "canceledItems": 2,
            "completedItems": 3,
            "createdAt": "2026-07-23T12:00:00.000Z",
            "failedItemIds": [],
            "failedItems": 0,
            "id": "bulk-1",
            "knowledgeSpaceId": "space-1",
            "status": "canceled",
            "totalItems": 5,
            "type": "document_reindex",
            "updatedAt": "2026-07-23T12:02:00.000Z",
        }
    )

    assert response.canceled_items == 2
    assert response.status == "canceled"


def test_overview_dtos_accept_the_knowledge_fs_wire_shape() -> None:
    stats = KnowledgeFSOverviewBaseStatsResponse.model_validate(
        {
            "current": {
                "freshSourceCount": 2,
                "knowledgeCount": 13,
                "latestSourceSyncAt": "2026-07-23T11:00:00.000Z",
                "linkedAppCount": 0,
                "sourceCount": 3,
                "staleSourceCount": 1,
            },
            "generatedAt": "2026-07-23T12:00:00.000Z",
            "knowledgeSpaceId": "space-1",
            "windows": {
                "24h": {
                    "answerRate": 0.8,
                    "answeredQueryCount": 8,
                    "queryCount": 10,
                    "since": "2026-07-22T12:00:00.000Z",
                },
                "7d": {
                    "answerRate": 0.75,
                    "answeredQueryCount": 75,
                    "queryCount": 100,
                    "since": "2026-07-16T12:00:00.000Z",
                },
                "30d": {
                    "answerRate": 0.7,
                    "answeredQueryCount": 210,
                    "queryCount": 300,
                    "since": "2026-06-23T12:00:00.000Z",
                },
            },
        }
    )
    outcomes = KnowledgeFSOverviewQueryOutcomesResponse.model_validate(
        {
            "buckets": [
                {
                    "answered": 8,
                    "endAt": "2026-07-23T12:00:00.000Z",
                    "lowConfidence": 1,
                    "noEvidence": 1,
                    "queryCount": 10,
                    "startAt": "2026-07-23T11:00:00.000Z",
                }
            ],
            "current": {
                "answerRate": 0.8,
                "answered": 8,
                "lowConfidence": 1,
                "noEvidence": 1,
                "queryCount": 10,
            },
            "generatedAt": "2026-07-23T12:00:00.000Z",
            "knowledgeSpaceId": "space-1",
            "previous": {
                "answerRate": 0.5,
                "answered": 4,
                "lowConfidence": 2,
                "noEvidence": 2,
                "queryCount": 8,
            },
            "previousSince": "2026-07-21T12:00:00.000Z",
            "since": "2026-07-22T12:00:00.000Z",
            "window": "24h",
        }
    )
    inventory = KnowledgeFSOverviewInventoryResponse.model_validate(
        {
            "generatedAt": "2026-07-23T12:00:00.000Z",
            "graphEntities": {"addedLast7d": 34, "total": 1208},
            "graphRelations": {"addedLast7d": 89, "total": 3441},
            "indexCoverage": {"indexed": 454, "percentage": 98.27, "total": 462},
            "knowledgeSpaceId": "space-1",
            "sourceCategories": {
                "crawl": 4,
                "onlineDocuments": 3,
                "onlineDrives": 2,
                "uploads": 1,
            },
        }
    )
    health = KnowledgeFSOverviewHealthResponse.model_validate(
        {
            "components": {
                "index": {"codes": [], "state": "healthy"},
                "ingestion": {"codes": [], "state": "healthy"},
                "profilePublication": {"codes": [], "state": "healthy"},
                "queryAvailability": {"codes": [], "state": "healthy"},
                "sourceFreshness": {"codes": [], "state": "healthy"},
                "workerReadiness": {"codes": [], "state": "healthy"},
            },
            "generatedAt": "2026-07-23T12:00:00.000Z",
            "knowledgeSpaceId": "space-1",
            "state": "healthy",
        }
    )

    assert stats.current.knowledge_count == 13
    assert outcomes.current.low_confidence == 1
    assert inventory.index_coverage.indexed == 454
    assert health.components.profile_publication.state == "healthy"
    assert KnowledgeFSOverviewWindowQuery().window == "24h"
    with pytest.raises(ValidationError):
        KnowledgeFSOverviewWindowQuery.model_validate({"window": "1h"})
