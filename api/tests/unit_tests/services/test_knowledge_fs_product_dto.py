from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from services.knowledge_fs.product_dto import (
    KnowledgeFSBackgroundTaskListQuery,
    KnowledgeFSBackgroundTaskListResponse,
    KnowledgeFSBadCaseCreatePayload,
    KnowledgeFSBadCaseUpdatePayload,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSCatQuery,
    KnowledgeFSCatResponse,
    KnowledgeFSDiffQuery,
    KnowledgeFSDiffResponse,
    KnowledgeFSDocumentChunkResponse,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSDocumentReindexResponse,
    KnowledgeFSFindQuery,
    KnowledgeFSGoldenQuestionEvidenceMatchPayload,
    KnowledgeFSGoldenQuestionPayload,
    KnowledgeFSGoldenQuestionResponse,
    KnowledgeFSGrepQuery,
    KnowledgeFSGrepResponse,
    KnowledgeFSListQuery,
    KnowledgeFSListResponse,
    KnowledgeFSOverviewBaseStatsResponse,
    KnowledgeFSOverviewHealthResponse,
    KnowledgeFSOverviewInventoryResponse,
    KnowledgeFSOverviewQueryOutcomesResponse,
    KnowledgeFSOverviewWindowQuery,
    KnowledgeFSPublicFailureResponse,
    KnowledgeFSQualityListQuery,
    KnowledgeFSQualityReplayDetailQuery,
    KnowledgeFSQualityReplayEvidenceDiff,
    KnowledgeFSQualityReplayPayload,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSRerankIntent,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskPartialListResponse,
    KnowledgeFSRetrievalCustomMetadataCondition,
    KnowledgeFSRetrievalCustomMetadataFilter,
    KnowledgeFSRetrievalMetadataFilters,
    KnowledgeFSRetrievalProfileIntent,
    KnowledgeFSRetrievalTestPayload,
    KnowledgeFSRetrievalTestResponse,
    KnowledgeFSScoreThresholdIntent,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSettingsResponse,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceCredentialTestResponse,
    KnowledgeFSSourceImportFailureResponse,
    KnowledgeFSSourceListQuery,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceWorkflowImportPayload,
    KnowledgeFSSourceWorkflowResponse,
    KnowledgeFSSpaceCreatePayload,
    KnowledgeFSSpaceListItemResponse,
    KnowledgeFSStatResponse,
    KnowledgeFSTraceResponse,
    KnowledgeFSTreeResponse,
    KnowledgeFSUploadPartPresignPayload,
    KnowledgeFSUploadSessionCompletePayload,
    KnowledgeFSUploadSessionCreatePayload,
    KnowledgeFSWorkflowFailedRetrievalCapturePayload,
    KnowledgeFSWorkflowFailedRetrievalCaptureResponse,
)


def test_quality_replay_payload_requires_exactly_one_selection_mode() -> None:
    assert KnowledgeFSQualityReplayPayload(selection="all-active").selection == "all-active"
    assert KnowledgeFSQualityReplayPayload(golden_question_ids=["question-1"]).golden_question_ids == ["question-1"]

    with pytest.raises(ValidationError, match="provide exactly one"):
        KnowledgeFSQualityReplayPayload()
    with pytest.raises(ValidationError, match="provide exactly one"):
        KnowledgeFSQualityReplayPayload(selection="all-active", golden_question_ids=["question-1"])


def test_quality_replay_detail_query_requires_a_uuid_evidence_item_id() -> None:
    value = "018f0d60-7a49-7cc2-9c1b-5b36f18f2c50"

    assert str(KnowledgeFSQualityReplayDetailQuery(evidence_item_id=value).evidence_item_id) == value
    with pytest.raises(ValidationError):
        KnowledgeFSQualityReplayDetailQuery(evidence_item_id="not-a-uuid")


def test_quality_replay_evidence_diff_accepts_safe_detail_aliases() -> None:
    diff = KnowledgeFSQualityReplayEvidenceDiff.model_validate(
        {
            "evidenceItems": [
                {
                    "available": True,
                    "documentName": "Permissions.pdf",
                    "matched": False,
                    "ordinal": 1,
                    "pageNumber": 3,
                    "sectionPath": ["Permissions", "Limits"],
                    "text": "Editors cannot promote themselves.",
                }
            ],
            "expectedCount": 1,
            "matchedCount": 0,
            "missingCount": 1,
            "retrievedCount": 10,
        }
    )

    assert diff.evidence_items is not None
    assert diff.evidence_items[0].document_name == "Permissions.pdf"
    assert diff.evidence_items[0].section_path == ["Permissions", "Limits"]


def test_golden_question_evidence_match_requires_exactly_one_lookup_mode() -> None:
    assert KnowledgeFSGoldenQuestionEvidenceMatchPayload(evidence="  permissions  ").evidence == "permissions"
    assert KnowledgeFSGoldenQuestionEvidenceMatchPayload(node_ids=[" node-1 ", "node-1", "node-2"]).node_ids == [
        "node-1",
        "node-2",
    ]

    with pytest.raises(ValidationError, match="Provide exactly one of evidence or node_ids"):
        KnowledgeFSGoldenQuestionEvidenceMatchPayload()
    with pytest.raises(ValidationError, match="Provide exactly one of evidence or node_ids"):
        KnowledgeFSGoldenQuestionEvidenceMatchPayload(evidence="permissions", node_ids=["node-1"])


def test_settings_response_serializes_rerank_plugin_id_with_its_public_alias() -> None:
    response = KnowledgeFSSettingsResponse.model_validate(
        {
            "revision": 1,
            "configuration_state": "active",
            "active_profile_available": True,
            "active_profile_revisions": {"embedding": 2, "retrieval": 3},
            "capabilities": {
                "deep": True,
                "ingest": True,
                "index": True,
                "source_sync": True,
                "query": True,
                "research": True,
            },
            "embedding": None,
            "issues": [],
            "retrieval": {
                "default_mode": "fast",
                "reasoning_model": {
                    "model": "openrouter/auto",
                    "plugin_id": "langgenius/openrouter",
                    "provider": "openrouter",
                },
                "rerank": {
                    "enabled": True,
                    "model": {
                        "model": "jina-reranker-v3",
                        "pluginId": "langgenius/jina",
                        "provider": "jina",
                    },
                },
                "score_threshold": {"enabled": False, "stage": "rerank", "value": 0.5},
                "top_k": 10,
            },
        }
    )

    assert response.model_dump(mode="json")["retrieval"]["rerank"]["model"] == {
        "model": "jina-reranker-v3",
        "pluginId": "langgenius/jina",
        "provider": "jina",
    }


def test_workflow_failed_retrieval_capture_dto_is_bounded_and_alias_safe() -> None:
    payload = KnowledgeFSWorkflowFailedRetrievalCapturePayload.model_validate(
        {
            "eventId": "019fac9f-bfb0-75ee-9af5-252ebafbac1e",
            "query": "  missing answer  ",
            "mode": "deep",
            "retrievalTraceId": "trace-1",
        }
    )

    assert payload.model_dump(mode="json", by_alias=True) == {
        "eventId": "019fac9f-bfb0-75ee-9af5-252ebafbac1e",
        "query": "missing answer",
        "mode": "deep",
        "retrievalTraceId": "trace-1",
    }
    response = KnowledgeFSWorkflowFailedRetrievalCaptureResponse.model_validate(
        {
            "failedQueryId": "019fac9f-bfb0-75ee-9af5-252ebafbac1c",
            "verdict": "coverage-gap",
        }
    )
    assert response.verdict == "coverage-gap"
    assert response.bad_case_id is None

    unicode_trace = KnowledgeFSWorkflowFailedRetrievalCapturePayload.model_validate(
        {**payload.model_dump(mode="json", by_alias=True), "retrievalTraceId": "追踪-" + "x" * 509}
    )
    assert len(unicode_trace.retrieval_trace_id) == 512

    for invalid in (
        {**payload.model_dump(mode="json", by_alias=True), "eventId": "not-a-uuid"},
        {**payload.model_dump(mode="json", by_alias=True), "query": "   "},
        {**payload.model_dump(mode="json", by_alias=True), "mode": "auto"},
        {**payload.model_dump(mode="json", by_alias=True), "retrievalTraceId": "x" * 513},
    ):
        with pytest.raises(ValidationError):
            KnowledgeFSWorkflowFailedRetrievalCapturePayload.model_validate(invalid)


def test_public_failure_accepts_only_allowlisted_bounded_parameters() -> None:
    failure = KnowledgeFSPublicFailureResponse.model_validate(
        {
            "category": "rate_limit",
            "code": "KNOWLEDGE_FS_RATE_LIMITED",
            "message": "Try again later.",
            "parameters": {"retryAfterSeconds": 30},
            "retryPolicy": "manual",
        }
    )

    assert failure.parameters == {"retryAfterSeconds": 30}
    assert failure.message == "Too many KnowledgeFS operations were requested. Try again later."
    with pytest.raises(ValidationError):
        KnowledgeFSPublicFailureResponse.model_validate(
            {
                "category": "internal",
                "code": "KNOWLEDGE_FS_INTERNAL_ERROR",
                "message": "Safe message",
                "parameters": {"secret": "must-not-cross-the-boundary"},
                "retryPolicy": "never",
            }
        )
    with pytest.raises(ValidationError):
        KnowledgeFSPublicFailureResponse.model_validate(
            {
                "category": "internal",
                "code": "UNREGISTERED_PROVIDER_FAILURE",
                "message": "An unreviewed upstream message",
                "retryPolicy": "manual",
            }
        )
    with pytest.raises(ValidationError):
        KnowledgeFSPublicFailureResponse.model_validate(
            {
                "category": "internal",
                "code": "KNOWLEDGE_FS_INTERNAL_ERROR",
                "message": "Safe message",
                "retryPolicy": "manual",
                "stage": "Authorization: Bearer secret",
            }
        )
    with pytest.raises(ValidationError):
        KnowledgeFSPublicFailureResponse.model_validate(
            {
                "category": "internal",
                "code": "KNOWLEDGE_FS_INTERNAL_ERROR",
                "message": "Safe message",
                "retryPolicy": "manual",
                "traceId": "Authorization: Bearer secret",
            }
        )


def test_public_failure_replaces_a_registered_code_message_with_a_safe_bff_fallback() -> None:
    failure = KnowledgeFSPublicFailureResponse.model_validate(
        {
            "category": "configuration",
            "code": "MODEL_CREDENTIAL_INVALID",
            "message": "Authorization: Bearer credential-secret",
            "retryPolicy": "after_configuration",
        }
    )

    assert failure.message == ("The KnowledgeFS operation requires a configuration change before it can continue.")
    assert "credential-secret" not in failure.model_dump_json()


def test_document_reindex_response_preserves_disabled_items() -> None:
    response = KnowledgeFSDocumentReindexResponse.model_validate(
        {
            "bulkJobId": "bulk-job-1",
            "items": [{"documentId": "document-1", "status": "disabled"}],
            "total": 1,
        }
    )

    assert response.model_dump(mode="json") == {
        "bulk_job_id": "bulk-job-1",
        "items": [
            {
                "asset": None,
                "compilation_job": None,
                "document_id": "document-1",
                "status": "disabled",
                "status_url": None,
            }
        ],
        "total": 1,
    }


def test_space_create_initial_source_is_a_backward_compatible_discriminated_union() -> None:
    website = KnowledgeFSSpaceCreatePayload.model_validate(
        {
            "name": "Docs",
            "slug": "docs",
            "initial_source": {
                "kind": "website_crawl",
                "name": "Website",
                "provider": "firecrawl",
                "root_url": "https://docs.example.com",
                "crawl_options": {},
                "selection": [{"source_url": "https://docs.example.com/start"}],
            },
        }
    )
    assert website.initial_source is not None
    assert website.initial_source.kind == "website_crawl"

    document = KnowledgeFSSpaceCreatePayload.model_validate(
        {
            "name": "Docs",
            "slug": "docs",
            "initial_source": {
                "kind": "online_document",
                "name": "Wiki",
                "pluginId": "langgenius/notion_datasource",
                "provider": "notion",
                "datasource": "pages",
                "credentialId": "credential-1",
                "selection": [
                    {
                        "pageId": "page-1",
                        "providerItemId": "notion:page-1",
                        "type": "page",
                        "workspaceId": "workspace-1",
                    }
                ],
            },
        }
    )
    assert document.initial_source is not None
    assert document.initial_source.kind == "online_document"
    assert document.initial_source.credential_id == "credential-1"


def test_connector_initial_source_requires_an_exact_credential_binding() -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSSpaceCreatePayload.model_validate(
            {
                "name": "Docs",
                "slug": "docs",
                "initial_source": {
                    "kind": "online_drive",
                    "name": "Drive",
                    "pluginId": "langgenius/google_drive",
                    "provider": "google_drive",
                    "datasource": "google_drive",
                    "selection": [
                        {
                            "id": "file-1",
                            "name": "Plan.pdf",
                            "providerItemId": "google-drive:file-1",
                        }
                    ],
                },
            }
        )


def test_retrieval_test_payload_uses_bounded_kfs_filters_and_resolved_modes() -> None:
    payload = KnowledgeFSRetrievalTestPayload.model_validate(
        {
            "filters": {
                "documentTypes": [" handbook ", "handbook"],
                "nodeKinds": ["section"],
                "tags": [" camera ", "camera"],
            },
            "includeText": True,
            "mode": "deep",
            "query": "  camera evidence  ",
        }
    )

    assert payload.query == "camera evidence"
    assert payload.filters == KnowledgeFSRetrievalMetadataFilters(
        document_types=["handbook"],
        node_kinds=["section"],
        tags=["camera"],
    )
    assert payload.model_dump(mode="json", by_alias=True, exclude_none=True) == {
        "filters": {
            "documentTypes": ["handbook"],
            "nodeKinds": ["section"],
            "tags": ["camera"],
        },
        "includeText": True,
        "mode": "deep",
        "query": "camera evidence",
    }
    with pytest.raises(ValidationError):
        KnowledgeFSRetrievalTestPayload(query="camera", mode="auto")  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        KnowledgeFSRetrievalMetadataFilters(tags=[f"tag-{index}" for index in range(101)])


def test_retrieval_test_payload_serializes_typed_custom_metadata_conditions() -> None:
    payload = KnowledgeFSRetrievalTestPayload.model_validate(
        {
            "filters": {
                "customMetadata": {
                    "conditions": [
                        {
                            "comparisonOperator": "is",
                            "fieldType": "string",
                            "name": "department",
                            "value": "finance",
                        },
                        {
                            "comparisonOperator": ">",
                            "fieldType": "number",
                            "name": "priority",
                            "value": 3,
                        },
                    ],
                    "logicalOperator": "and",
                }
            },
            "query": "policy",
        }
    )

    assert payload.filters == KnowledgeFSRetrievalMetadataFilters(
        custom_metadata=KnowledgeFSRetrievalCustomMetadataFilter(
            logical_operator="and",
            conditions=[
                KnowledgeFSRetrievalCustomMetadataCondition(
                    comparison_operator="is",
                    field_type="string",
                    name="department",
                    value="finance",
                ),
                KnowledgeFSRetrievalCustomMetadataCondition(
                    comparison_operator=">",
                    field_type="number",
                    name="priority",
                    value=3,
                ),
            ],
        )
    )
    assert payload.model_dump(mode="json", by_alias=True, exclude_none=True)["filters"] == {
        "customMetadata": {
            "conditions": [
                {
                    "comparisonOperator": "is",
                    "fieldType": "string",
                    "name": "department",
                    "value": "finance",
                },
                {
                    "comparisonOperator": ">",
                    "fieldType": "number",
                    "name": "priority",
                    "value": 3,
                },
            ],
            "logicalOperator": "and",
        }
    }

    with pytest.raises(ValidationError, match="reserved"):
        KnowledgeFSRetrievalCustomMetadataCondition(
            comparison_operator="is",
            field_type="string",
            name="system",
            value="internal",
        )
    with pytest.raises(ValidationError, match="valid timestamp"):
        KnowledgeFSRetrievalCustomMetadataCondition(
            comparison_operator="after",
            field_type="time",
            name="reviewed_at",
            value=10**30,
        )


@pytest.mark.parametrize(
    ("condition", "message"),
    [
        ({"comparison_operator": "contains", "field_type": "number", "name": "priority", "value": 3}, "invalid"),
        ({"comparison_operator": ">", "field_type": "number", "name": "priority"}, "required"),
        ({"comparison_operator": ">", "field_type": "number", "name": "priority", "value": "3"}, "numeric"),
        ({"comparison_operator": "is", "field_type": "string", "name": "department", "value": 3}, "string"),
        ({"comparison_operator": "after", "field_type": "time", "name": "reviewed_at", "value": "later"}, "timestamp"),
        ({"comparison_operator": "is", "field_type": "string", "name": "department", "value": "x" * 513}, "512"),
        ({"comparison_operator": ">", "field_type": "number", "name": "priority", "value": float("inf")}, "finite"),
    ],
)
def test_retrieval_custom_metadata_condition_rejects_invalid_values(condition: dict[str, object], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        KnowledgeFSRetrievalCustomMetadataCondition.model_validate(condition)


def test_retrieval_test_response_validates_evidence_text_and_metrics() -> None:
    response = KnowledgeFSRetrievalTestResponse.model_validate(
        {
            "items": [
                {
                    "citation": {
                        "artifactHash": "a" * 64,
                        "documentAssetId": "document-1",
                        "documentVersion": 1,
                        "pageNumber": 3,
                        "sectionPath": ["Camera", "Sensor"],
                    },
                    "nodeId": "node-1",
                    "projectionIds": ["projection-1"],
                    "score": 1.2,
                    "sources": ["dense", "fts"],
                    "text": "Camera evidence",
                }
            ],
            "metrics": {"degradationFlags": [], "denseCandidates": 3, "totalMs": 12},
            "mode": "fast",
            "traceId": "trace-1",
        }
    )

    assert response.items[0].citation.section_path == ["Camera", "Sensor"]
    assert response.items[0].score == 1.2
    assert response.items[0].text == "Camera evidence"
    assert response.metrics.total_ms == 12


def test_query_payloads_accept_either_text_or_upload_file_images() -> None:
    upload_file_id = "00000000-0000-4000-8000-000000000001"

    image_query = KnowledgeFSQueryCreatePayload.model_validate({"queryImages": [{"uploadFileId": upload_file_id}]})
    mixed_research = KnowledgeFSResearchTaskCreatePayload.model_validate(
        {"query": "find this", "queryImages": [{"uploadFileId": upload_file_id}]}
    )

    assert image_query.query is None
    assert image_query.query_images[0].upload_file_id == upload_file_id
    assert mixed_research.query == "find this"
    with pytest.raises(ValidationError, match="At least one"):
        KnowledgeFSQueryCreatePayload.model_validate({})
    with pytest.raises(ValidationError, match="UUID"):
        KnowledgeFSQueryCreatePayload.model_validate({"queryImages": [{"uploadFileId": "bad"}]})
    with pytest.raises(ValidationError, match="duplicate"):
        KnowledgeFSQueryCreatePayload.model_validate(
            {
                "queryImages": [
                    {"uploadFileId": upload_file_id},
                    {"uploadFileId": upload_file_id},
                ]
            }
        )


def test_trace_response_translates_historical_retrieval_statistics() -> None:
    trace = KnowledgeFSTraceResponse.model_validate(
        {
            "completed": True,
            "createdAt": "2026-08-06T08:00:00.000Z",
            "durationMs": 1250,
            "id": "trace-1",
            "mode": "fast",
            "profile": {},
            "query": "How does retrieval work?",
            "resultCount": 4,
            "scores": {},
            "stages": [],
        }
    )

    assert trace.duration_ms == 1250
    assert trace.result_count == 4


def test_knowledge_fs_queries_validate_independent_command_contracts() -> None:
    listing = KnowledgeFSListQuery(path="/knowledge", limit=100)
    grep = KnowledgeFSGrepQuery(path="/knowledge/docs", query="  TODO  ")
    finding = KnowledgeFSFindQuery(path="/knowledge", resource_type="document")
    diff = KnowledgeFSDiffQuery(
        old_path="/knowledge/docs/old.md",
        new_path="/knowledge/docs/new.md",
        semantic=True,
    )
    cat = KnowledgeFSCatQuery(path="/workspaces/current")

    assert listing.limit == 100
    assert grep.query == "TODO"
    assert finding.resource_type == "document"
    assert diff.semantic is True
    assert cat.limit is None

    with pytest.raises(ValidationError):
        KnowledgeFSListQuery(path="/invalid", limit=20)
    with pytest.raises(ValidationError):
        KnowledgeFSGrepQuery(path="/knowledge", query=" ")
    with pytest.raises(ValidationError):
        KnowledgeFSListQuery(path="/knowledge", limit=101)


def test_knowledge_fs_responses_translate_each_kfs_wire_shape() -> None:
    entry = {
        "kind": "resource",
        "metadata": {"owner": "docs"},
        "name": "readme.md",
        "path": "/knowledge/docs/readme.md",
        "resourceType": "document",
        "targetId": "document-1",
        "version": 2,
    }
    listing = KnowledgeFSListResponse.model_validate(
        {
            "consistencyClass": "path-consistent",
            "items": [entry],
            "nextCursor": "cursor-1",
            "path": "/knowledge/docs",
            "truncated": True,
        }
    )
    tree = KnowledgeFSTreeResponse.model_validate(
        {
            "path": "/knowledge",
            "root": {
                "kind": "directory",
                "metadata": {},
                "name": "knowledge",
                "path": "/knowledge",
                "children": [entry],
            },
            "truncated": False,
        }
    )
    grep = KnowledgeFSGrepResponse.model_validate(
        {
            "matches": [
                {
                    "endOffset": 8,
                    "kind": "segment",
                    "metadata": {},
                    "path": "/knowledge/docs/readme.md",
                    "segmentId": "segment-1",
                    "snippet": "TODO",
                    "startOffset": 4,
                }
            ],
            "path": "/knowledge",
            "truncated": False,
        }
    )
    diff = KnowledgeFSDiffResponse.model_validate(
        {
            "mode": "line",
            "newPath": "/knowledge/docs/new.md",
            "oldPath": "/knowledge/docs/old.md",
            "operations": [{"kind": "insert", "newStart": 1, "newEnd": 1, "text": "new"}],
            "stats": {"delete": 0, "equal": 0, "insert": 1},
        }
    )
    cat = KnowledgeFSCatResponse.model_validate(
        {
            "contentType": "text/markdown",
            "path": "/knowledge/docs/readme.md",
            "text": "hello",
            "truncated": False,
        }
    )
    stat = KnowledgeFSStatResponse.model_validate(
        {
            "metadata": {},
            "path": "/knowledge/docs/readme.md",
            "resourceType": "document",
            "sizeBytes": 5,
            "targetId": "document-1",
        }
    )

    assert listing.model_dump(mode="json")["next_cursor"] == "cursor-1"
    assert tree.root.children
    assert tree.root.children[0].target_id == "document-1"
    assert grep.matches[0].start_offset == 4
    assert diff.new_path == "/knowledge/docs/new.md"
    assert cat.content_type == "text/markdown"
    assert stat.size_bytes == 5


def test_research_task_partials_preserve_the_generated_answer() -> None:
    response = KnowledgeFSResearchTaskPartialListResponse.model_validate(
        {
            "items": [
                {
                    "answer": "The warranty is two years.",
                    "evidenceBundle": {"evidence": []},
                    "knowledgeSpaceId": "space-1",
                    "researchTaskJobId": "research-1",
                    "sequence": 1,
                }
            ]
        }
    )

    assert response.model_dump(mode="json", exclude_none=True) == {
        "data": [
            {
                "answer": "The warranty is two years.",
                "evidence_bundle": {"evidence": []},
                "knowledge_space_id": "space-1",
                "research_task_job_id": "research-1",
                "sequence": 1,
            }
        ]
    }


def test_space_list_item_serializes_naive_database_timestamps_as_utc() -> None:
    response = KnowledgeFSSpaceListItemResponse.model_validate(
        {
            "control_space_id": "control-space-1",
            "created_at": datetime(2026, 7, 28, 6, 58, 18),
            "knowledge_space_id": "knowledge-space-1",
            "linked_apps": 2,
            "owner_account_id": "account-1",
            "permission_keys": ["knowledge_space_read"],
            "resource_version": 1,
            "state": "active",
            "technical_status": "available",
            "updated_at": datetime(2026, 7, 28, 6, 59, 16),
            "visibility": "only_me",
        }
    )

    payload = response.model_dump(mode="json")

    assert payload["created_at"] == "2026-07-28T06:58:18Z"
    assert payload["linked_apps"] == 2
    assert payload["updated_at"] == "2026-07-28T06:59:16Z"


def test_space_list_item_converts_aware_database_timestamps_to_utc() -> None:
    response = KnowledgeFSSpaceListItemResponse.model_validate(
        {
            "control_space_id": "control-space-1",
            "created_at": datetime(2026, 7, 28, 6, 58, 18, tzinfo=UTC),
            "knowledge_space_id": "knowledge-space-1",
            "linked_apps": 0,
            "owner_account_id": "account-1",
            "permission_keys": ["knowledge_space_read"],
            "resource_version": 1,
            "state": "active",
            "technical_status": "available",
            "updated_at": datetime(2026, 7, 28, 6, 59, 16, tzinfo=timezone(timedelta(hours=8))),
            "visibility": "only_me",
        }
    )

    assert response.updated_at == datetime(2026, 7, 27, 22, 59, 16, tzinfo=UTC)


def test_document_chunk_preserves_structured_section_metadata() -> None:
    response = KnowledgeFSDocumentChunkResponse.model_validate(
        {
            "createdAt": "2026-07-21T10:00:00Z",
            "documentId": "document-1",
            "documentRevision": 3,
            "enabled": True,
            "id": "chunk-1",
            "kind": "table",
            "knowledgeSpaceId": "space-1",
            "ordinal": 1,
            "parseElementIds": ["parse-element-1", "parse-element-2"],
            "sectionPath": ["Invoices", "Tax breakdown"],
            "text": "Tax table content",
            "tokenCount": 3,
            "userMetadata": {},
        }
    )

    assert response.model_dump(mode="json")["kind"] == "table"
    assert response.model_dump(mode="json")["parse_element_ids"] == ["parse-element-1", "parse-element-2"]
    assert response.model_dump(mode="json")["section_path"] == ["Invoices", "Tax breakdown"]
    assert "parse_element_ids" in KnowledgeFSDocumentChunkResponse.model_json_schema()["required"]

    with pytest.raises(ValidationError):
        KnowledgeFSDocumentChunkResponse.model_validate(
            {
                "createdAt": "2026-07-21T10:00:00Z",
                "documentId": "document-1",
                "documentRevision": 3,
                "enabled": True,
                "id": "chunk-1",
                "knowledgeSpaceId": "space-1",
                "ordinal": 1,
                "text": "Legacy chunk",
                "tokenCount": 2,
                "userMetadata": {},
            }
        )


def test_document_outline_preserves_recursive_nodes_and_serializes_nested_aliases() -> None:
    response = KnowledgeFSDocumentOutlineResponse.model_validate(
        {
            "artifactHash": "artifact-hash",
            "createdAt": "2026-08-07T10:00:00Z",
            "documentAssetId": "019f4b4d-3af1-7360-a8b8-0ce7384d23a4",
            "id": "019f4b4d-3af1-7360-a8b8-0ce7384d23a5",
            "knowledgeSpaceId": "019f4b4d-3af1-7360-a8b8-0ce7384d23a6",
            "metadata": {},
            "nodes": [
                {
                    "childNodeIds": ["child-1"],
                    "children": [
                        {
                            "id": "child-1",
                            "level": 2,
                            "metadata": {},
                            "sectionPath": ["Guide", "Setup"],
                            "summary": "Explains the setup requirements.",
                            "title": "Setup",
                            "tocSource": "parser-heading",
                        }
                    ],
                    "id": "root-1",
                    "level": 1,
                    "metadata": {},
                    "sectionPath": ["Guide"],
                    "summary": "Introduces the guide.",
                    "title": "Guide",
                    "tocSource": "parser-heading",
                }
            ],
            "outlineVersion": "document-outline-v1",
            "parseArtifactId": "019f4b4d-3af1-7360-a8b8-0ce7384d23a7",
            "version": 1,
        }
    )

    payload = response.model_dump(mode="json")

    assert response.nodes[0].children[0].summary == "Explains the setup requirements."
    assert payload["nodes"][0]["child_node_ids"] == ["child-1"]
    assert payload["nodes"][0]["children"][0]["section_path"] == ["Guide", "Setup"]


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (KnowledgeFSRerankIntent, {"enabled": True}),
        (KnowledgeFSRerankIntent, {"enabled": False}),
        (KnowledgeFSScoreThresholdIntent, {"enabled": True}),
        (
            KnowledgeFSRetrievalProfileIntent,
            {
                "defaultMode": "fast",
                "reasoningModel": {"pluginId": "plugin-1", "provider": "provider-1", "model": "model-1"},
                "rerank": {"enabled": False},
                "scoreThreshold": {"enabled": True, "value": 0.5},
                "topK": 10,
            },
        ),
        (KnowledgeFSSettingsPayload, {"expectedRevision": 1}),
        (KnowledgeFSDocumentReindexPayload, {}),
        (KnowledgeFSDocumentReindexPayload, {"all": True, "documentIds": ["document-1"]}),
        (
            KnowledgeFSSourceCreatePayload,
            {
                "connectionId": "connection-1",
                "credentials": {"token": "secret"},
                "name": "Source",
                "type": "connector",
                "uri": "notion://source",
            },
        ),
        (KnowledgeFSSourceUpdatePayload, {}),
    ],
)
def test_product_dto_cross_field_validators_reject_ambiguous_payloads(
    model: type[object],
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(payload)  # type: ignore[attr-defined]


def test_product_dto_cross_field_validators_accept_unambiguous_payloads() -> None:
    assert KnowledgeFSDocumentReindexPayload.model_validate({"all": True}).all is True


def test_upload_session_dtos_validate_and_serialize_the_kfs_wire_shape() -> None:
    create = KnowledgeFSUploadSessionCreatePayload.model_validate(
        {
            "checksumSha256Base64": "whole-checksum",
            "contentType": "application/pdf",
            "expectedSizeBytes": 12,
            "fileName": "guide.pdf",
        }
    )
    presign = KnowledgeFSUploadPartPresignPayload.model_validate(
        {
            "checksumSha256Base64": "part-checksum",
            "contentLength": 12,
        }
    )
    complete = KnowledgeFSUploadSessionCompletePayload.model_validate(
        {
            "parts": [
                {
                    "checksumSha256Base64": "part-checksum",
                    "etag": "etag-1",
                    "partNumber": 1,
                }
            ]
        }
    )

    assert create.model_dump(mode="json", by_alias=True) == {
        "checksumSha256Base64": "whole-checksum",
        "contentType": "application/pdf",
        "expectedSizeBytes": 12,
        "fileName": "guide.pdf",
    }
    assert presign.model_dump(mode="json", by_alias=True)["contentLength"] == 12
    assert complete.model_dump(mode="json", by_alias=True)["parts"][0]["partNumber"] == 1


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (
            KnowledgeFSUploadSessionCreatePayload,
            {
                "checksumSha256Base64": "checksum",
                "contentType": "application/pdf",
                "expectedSizeBytes": 0,
                "fileName": "guide.pdf",
            },
        ),
        (
            KnowledgeFSUploadPartPresignPayload,
            {"checksumSha256Base64": "checksum", "contentLength": 0},
        ),
        (
            KnowledgeFSUploadSessionCompletePayload,
            {"parts": [{"etag": "etag", "partNumber": 0}]},
        ),
    ],
)
def test_upload_session_dtos_reject_invalid_sizes_and_part_numbers(
    model: type[object],
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(payload)  # type: ignore[attr-defined]


def test_quality_dtos_normalize_tags_and_read_annotation_metadata() -> None:
    golden = KnowledgeFSGoldenQuestionPayload(
        question="Question",
        tags=[" tag-1 ", "", "tag-1"],
    )
    bad_case = KnowledgeFSBadCaseCreatePayload(
        reason="Reason",
        tags=[" tag-1 ", "", "tag-1"],
        trace_id="trace-1",
    )
    response = KnowledgeFSGoldenQuestionResponse.model_validate(
        {
            "id": "question-1",
            "question": "Question",
            "metadata": {"annotation": "Annotation"},
            "tags": ["tag-1"],
            "createdAt": "2026-07-28T06:58:18Z",
            "updatedAt": "2026-07-28T06:59:16Z",
        }
    )

    assert golden.tags == ["tag-1"]
    assert golden.annotation == ""
    assert KnowledgeFSGoldenQuestionPayload(annotation="   ", question="Question").annotation == ""
    assert bad_case.tags == ["tag-1"]
    assert response.annotation == "Annotation"
    with pytest.raises(ValidationError):
        KnowledgeFSGoldenQuestionResponse.model_validate("invalid")


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


@pytest.mark.parametrize("payload", [{"limit": 0}, {"limit": 201}, {"cursor": ""}])
def test_source_list_query_matches_the_knowledge_fs_pagination_contract(
    payload: dict[str, object],
) -> None:
    assert KnowledgeFSSourceListQuery().limit == 50

    with pytest.raises(ValidationError):
        KnowledgeFSSourceListQuery.model_validate(payload)


@pytest.mark.parametrize("payload", [{"limit": 0}, {"limit": 101}, {"cursor": ""}])
def test_quality_list_query_matches_the_knowledge_fs_pagination_contract(
    payload: dict[str, object],
) -> None:
    assert KnowledgeFSQualityListQuery().limit == 50

    with pytest.raises(ValidationError):
        KnowledgeFSQualityListQuery.model_validate(payload)


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (KnowledgeFSGoldenQuestionPayload, {"annotation": "Annotation", "question": "   "}),
        (KnowledgeFSBadCaseCreatePayload, {"reason": "   ", "trace_id": "trace-1"}),
        (
            KnowledgeFSBadCaseUpdatePayload,
            {"expected_revision": 1, "reason": "   ", "status": "open"},
        ),
    ],
)
def test_quality_payloads_reject_whitespace_only_required_text(
    model: type[object],
    payload: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(payload)  # type: ignore[attr-defined]


def test_source_workflow_import_payload_preserves_each_provider_item_contract() -> None:
    document = KnowledgeFSSourceWorkflowImportPayload.model_validate(
        {
            "kind": "online-document-import",
            "items": [
                {
                    "lastEditedTime": "2026-07-28T00:00:00Z",
                    "name": "Runbook",
                    "pageId": "page-1",
                    "providerItemId": "notion-page-1",
                    "type": "page",
                    "workspaceId": "workspace-1",
                }
            ],
        }
    )
    drive = KnowledgeFSSourceWorkflowImportPayload.model_validate(
        {
            "kind": "online-drive-import",
            "items": [
                {
                    "bucket": "knowledge",
                    "id": "files/runbook.pdf",
                    "mimeType": "application/pdf",
                    "name": "runbook.pdf",
                    "providerItemId": "s3-files-runbook",
                }
            ],
        }
    )

    assert document.model_dump(mode="json", by_alias=True, exclude_none=True) == {
        "kind": "online-document-import",
        "items": [
            {
                "lastEditedTime": "2026-07-28T00:00:00Z",
                "name": "Runbook",
                "pageId": "page-1",
                "providerItemId": "notion-page-1",
                "type": "page",
                "workspaceId": "workspace-1",
            }
        ],
    }
    assert drive.model_dump(mode="json", by_alias=True, exclude_none=True) == {
        "kind": "online-drive-import",
        "items": [
            {
                "bucket": "knowledge",
                "id": "files/runbook.pdf",
                "mimeType": "application/pdf",
                "name": "runbook.pdf",
                "providerItemId": "s3-files-runbook",
            }
        ],
    }

    with pytest.raises(ValidationError):
        KnowledgeFSSourceWorkflowImportPayload.model_validate(
            {
                "kind": "online-drive-import",
                "items": [
                    {
                        "pageId": "page-1",
                        "providerItemId": "notion-page-1",
                        "type": "page",
                        "workspaceId": "workspace-1",
                    }
                ],
            }
        )


def test_source_workflow_response_exposes_only_validated_terminal_failures() -> None:
    payload: dict[str, object] = {
        "checkpoint": "provider-read",
        "createdAt": "2030-01-01T00:00:00Z",
        "executionAttempts": 1,
        "id": "workflow-1",
        "knowledgeSpaceId": "space-1",
        "kind": "sync",
        "lastErrorCode": "SOURCE_OPERATION_FAILED",
        "lastErrorMessage": "Authorization: Bearer provider-secret",
        "maxExecutionAttempts": 3,
        "progressCompleted": 0,
        "progressFailed": 1,
        "progressSkipped": 0,
        "state": "failed",
        "updatedAt": "2030-01-01T00:01:00Z",
    }

    legacy = KnowledgeFSSourceWorkflowResponse.model_validate(payload)
    assert legacy.last_error_code is None
    assert "provider-secret" not in legacy.model_dump_json()

    response = KnowledgeFSSourceWorkflowResponse.model_validate(
        {
            **payload,
            "failure": {
                "category": "dependency",
                "code": "SOURCE_OPERATION_FAILED",
                "message": "Authorization: Bearer provider-secret",
                "retryPolicy": "manual",
                "stage": "provider-read",
            },
        }
    )
    assert response.last_error_code == "SOURCE_OPERATION_FAILED"
    assert response.failure is not None
    assert response.failure.message == "A service required by KnowledgeFS is temporarily unavailable."
    assert "provider-secret" not in response.model_dump_json()


def test_source_result_dtos_never_forward_untrusted_success_payload_messages() -> None:
    credential = KnowledgeFSSourceCredentialTestResponse.model_validate(
        {
            "code": "SOURCE_CREDENTIAL_TEST_FAILED",
            "error": "Authorization: Bearer credential-test-secret",
            "failure": {
                "category": "configuration",
                "code": "SOURCE_CREDENTIAL_TEST_FAILED",
                "message": "Authorization: Bearer credential-test-secret",
                "retryPolicy": "after_configuration",
            },
            "valid": False,
        }
    )
    assert credential.error == "The KnowledgeFS operation requires a configuration change before it can continue."
    assert "credential-test-secret" not in credential.model_dump_json()

    legacy_import = KnowledgeFSSourceImportFailureResponse.model_validate(
        {
            "code": "SOURCE_DOCUMENT_MATERIALIZATION_FAILED",
            "error": "signed-url-secret",
            "filename": "runbook.pdf",
        }
    )
    assert legacy_import.error == "KnowledgeFS could not import this source document."
    assert "signed-url-secret" not in legacy_import.model_dump_json()


@pytest.mark.parametrize(
    ("kind", "item"),
    [
        (
            "online-document-import",
            {
                "lastEditedTime": "x" * 129,
                "pageId": "page-1",
                "providerItemId": "notion-page-1",
                "type": "page",
                "workspaceId": "workspace-1",
            },
        ),
        (
            "online-document-import",
            {
                "pageId": "x" * 1_025,
                "providerItemId": "notion-page-1",
                "type": "page",
                "workspaceId": "workspace-1",
            },
        ),
        (
            "online-drive-import",
            {
                "id": "x" * 1_025,
                "name": "runbook.pdf",
                "providerItemId": "s3-files-runbook",
            },
        ),
    ],
)
def test_source_workflow_import_payload_rejects_values_beyond_runtime_bounds(
    kind: str,
    item: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSSourceWorkflowImportPayload.model_validate({"kind": kind, "items": [item]})


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
