"""Typed KnowledgeFS BFF facade over operation capabilities and internal transports."""

from __future__ import annotations

from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel, JsonValue

from services.knowledge_fs.capability_broker import KnowledgeFSCapabilityBroker
from services.knowledge_fs.credential_service import KnowledgeFSServiceCredentialProfile
from services.knowledge_fs.product_dto import (
    KnowledgeFSAdmittedQueryRequest,
    KnowledgeFSAnswerTraceResponse,
    KnowledgeFSBackgroundTaskListResponse,
    KnowledgeFSBackgroundTaskResponse,
    KnowledgeFSBadCaseCreatePayload,
    KnowledgeFSBadCaseListResponse,
    KnowledgeFSBadCaseResponse,
    KnowledgeFSBadCaseTraceReferenceResponse,
    KnowledgeFSBadCaseUpdatePayload,
    KnowledgeFSBulkDeletionAcceptedResponse,
    KnowledgeFSBulkDocumentAvailabilityPayload,
    KnowledgeFSBulkDocumentAvailabilityResponse,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSBulkLogicalDocumentDeletePayload,
    KnowledgeFSCatQuery,
    KnowledgeFSCatResponse,
    KnowledgeFSCrawlImportPayload,
    KnowledgeFSCrawlPreviewPageListResponse,
    KnowledgeFSCrawlPreviewSelectionPayload,
    KnowledgeFSDiffQuery,
    KnowledgeFSDiffResponse,
    KnowledgeFSDocumentAvailabilityPayload,
    KnowledgeFSDocumentChunkListResponse,
    KnowledgeFSDocumentChunkResponse,
    KnowledgeFSDocumentCompilationJobResponse,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSDocumentDownloadDescriptor,
    KnowledgeFSDocumentListResponse,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentMultimodalManifest,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSDocumentReindexResponse,
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentRevisionListResponse,
    KnowledgeFSDocumentUploadAcceptedResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSFindQuery,
    KnowledgeFSGoldenQuestionBulkImportPayload,
    KnowledgeFSGoldenQuestionBulkImportRemotePayload,
    KnowledgeFSGoldenQuestionBulkImportRemoteRowPayload,
    KnowledgeFSGoldenQuestionBulkImportResponse,
    KnowledgeFSGoldenQuestionEvidenceMatchPayload,
    KnowledgeFSGoldenQuestionEvidenceMatchRemotePayload,
    KnowledgeFSGoldenQuestionEvidenceMatchResponse,
    KnowledgeFSGoldenQuestionListResponse,
    KnowledgeFSGoldenQuestionPayload,
    KnowledgeFSGoldenQuestionRemotePayload,
    KnowledgeFSGoldenQuestionResponse,
    KnowledgeFSGoldenQuestionUpdateRemotePayload,
    KnowledgeFSGrepQuery,
    KnowledgeFSGrepResponse,
    KnowledgeFSListQuery,
    KnowledgeFSListResponse,
    KnowledgeFSLogicalDocumentDeletePayload,
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSMetadataFieldCreatePayload,
    KnowledgeFSMetadataFieldDeleteResponse,
    KnowledgeFSMetadataFieldListResponse,
    KnowledgeFSMetadataFieldResponse,
    KnowledgeFSMetadataFieldUpdatePayload,
    KnowledgeFSOverviewActivityListResponse,
    KnowledgeFSOverviewAttentionListResponse,
    KnowledgeFSOverviewBaseStatsResponse,
    KnowledgeFSOverviewHealthResponse,
    KnowledgeFSOverviewInventoryResponse,
    KnowledgeFSOverviewQueryOutcomesResponse,
    KnowledgeFSPresignedUploadResponse,
    KnowledgeFSProfileMigrationResponse,
    KnowledgeFSQualityReplayListResponse,
    KnowledgeFSQualityReplayPayload,
    KnowledgeFSQualityReplayResponse,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSQueryResponse,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskListResponse,
    KnowledgeFSResearchTaskPartialListResponse,
    KnowledgeFSResearchTaskPlanPayload,
    KnowledgeFSResearchTaskPlanResponse,
    KnowledgeFSResearchTaskResponse,
    KnowledgeFSRetrievalProfileUpdatePayload,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSettingsResponse,
    KnowledgeFSSettingsUpdateResponse,
    KnowledgeFSSmallFileUploadResponse,
    KnowledgeFSSourceConnectionCreatePayload,
    KnowledgeFSSourceConnectionListResponse,
    KnowledgeFSSourceConnectionRefreshPayload,
    KnowledgeFSSourceConnectionResponse,
    KnowledgeFSSourceCrawlResponse,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceCredentialTestResponse,
    KnowledgeFSSourceDeletePayload,
    KnowledgeFSSourceFilesResponse,
    KnowledgeFSSourceImportFilesPayload,
    KnowledgeFSSourceImportPagesPayload,
    KnowledgeFSSourceImportResponse,
    KnowledgeFSSourceListResponse,
    KnowledgeFSSourcePagesResponse,
    KnowledgeFSSourceProviderListResponse,
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceSyncPolicyResponse,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceWorkflowCancelPayload,
    KnowledgeFSSourceWorkflowImportPayload,
    KnowledgeFSSourceWorkflowResponse,
    KnowledgeFSSpaceUpdatePayload,
    KnowledgeFSStatQuery,
    KnowledgeFSStatResponse,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSTraceListResponse,
    KnowledgeFSTreeQuery,
    KnowledgeFSTreeResponse,
    KnowledgeFSUploadPartPresignPayload,
    KnowledgeFSUploadSessionAbortPayload,
    KnowledgeFSUploadSessionCompletePayload,
    KnowledgeFSUploadSessionCreatePayload,
    KnowledgeFSUploadSessionCreateRemotePayload,
    KnowledgeFSUploadSessionCreateResponse,
    KnowledgeFSUploadSessionMutationResponse,
)
from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, is_product_operation_ready
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRemotePort,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
    KnowledgeFSRemoteBinaryRequest,
    KnowledgeFSRemoteJSONRequest,
    KnowledgeFSRemoteMultipartFile,
    KnowledgeFSRemoteMultipartRequest,
    KnowledgeFSRemoteSSERequest,
    KnowledgeFSRemoteSSEResponse,
)


class KnowledgeFSDataFacade:
    def __init__(
        self,
        *,
        broker: KnowledgeFSCapabilityBroker,
        remote: KnowledgeFSProductRemotePort,
    ) -> None:
        self._broker = broker
        self._remote = remote

    def stream_query(
        self,
        *,
        capability_token: str,
        trace_id: str,
        payload: KnowledgeFSAdmittedQueryRequest,
    ) -> KnowledgeFSRemoteSSEResponse:
        operation_id = "createQuery"
        _assert_sse_bff_ready(operation_id)
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        if operation.kfs_path is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS query stream path is unavailable")
        return self._remote.execute_sse(
            KnowledgeFSRemoteSSERequest(
                operation_id=operation_id,
                method=operation.method,
                path=operation.kfs_path,
                capability_token=capability_token,
                trace_id=trace_id,
                payload=payload.model_dump(mode="json", by_alias=True, exclude_none=True),
            )
        )

    def stream_research_task(
        self,
        *,
        capability_token: str,
        trace_id: str,
        task_id: str,
        knowledge_space_id: str,
        cursor: str | None,
        limit: int,
    ) -> KnowledgeFSRemoteSSEResponse:
        operation_id = "streamResearchTask"
        _assert_sse_bff_ready(operation_id)
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        if operation.kfs_path is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS research stream path is unavailable")
        path = _resolve_product_path(
            template=operation.kfs_path,
            knowledge_space_id=knowledge_space_id,
            resource_id=task_id,
            resource_resolver=operation.resource_resolver,
            path_parameters=(),
        )
        query: tuple[tuple[str, str], ...] = (("knowledgeSpaceId", knowledge_space_id), ("limit", str(limit)))
        if cursor is not None:
            query = (*query, ("cursor", cursor))
        return self._remote.execute_sse(
            KnowledgeFSRemoteSSERequest(
                operation_id=operation_id,
                method=operation.method,
                path=path,
                capability_token=capability_token,
                trace_id=trace_id,
                payload=None,
                query=query,
            )
        )

    def get_settings(self, *, tenant_id: str, account_id: str, control_space_id: str) -> KnowledgeFSSettingsResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getSettings",
        )
        return KnowledgeFSSettingsResponse.model_validate(raw)

    def list_knowledge_fs(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        query: KnowledgeFSListQuery,
    ) -> KnowledgeFSListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listKnowledgeFs",
            query=_knowledge_fs_query(
                ("path", query.path),
                ("limit", query.limit),
                ("cursor", query.cursor),
                ("consistencyClass", query.consistency_class),
            ),
        )
        return KnowledgeFSListResponse.model_validate(raw)

    def tree_knowledge_fs(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        query: KnowledgeFSTreeQuery,
    ) -> KnowledgeFSTreeResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="treeKnowledgeFs",
            query=_knowledge_fs_query(
                ("path", query.path),
                ("limit", query.limit),
                ("cursor", query.cursor),
                ("depth", query.depth),
                ("consistencyClass", query.consistency_class),
            ),
        )
        return KnowledgeFSTreeResponse.model_validate(raw)

    def grep_knowledge_fs(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        query: KnowledgeFSGrepQuery,
    ) -> KnowledgeFSGrepResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="grepKnowledgeFs",
            query=_knowledge_fs_query(
                ("path", query.path),
                ("limit", query.limit),
                ("cursor", query.cursor),
                ("q", query.query),
                ("timeoutMs", query.timeout_ms),
                ("consistencyClass", query.consistency_class),
            ),
        )
        return KnowledgeFSGrepResponse.model_validate(raw)

    def find_knowledge_fs(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        query: KnowledgeFSFindQuery,
    ) -> KnowledgeFSListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="findKnowledgeFs",
            query=_knowledge_fs_query(
                ("path", query.path),
                ("limit", query.limit),
                ("cursor", query.cursor),
                ("metadataKey", query.metadata_key),
                ("metadataValue", query.metadata_value),
                ("nameContains", query.name_contains),
                ("resourceType", query.resource_type),
                ("consistencyClass", query.consistency_class),
            ),
        )
        return KnowledgeFSListResponse.model_validate(raw)

    def diff_knowledge_fs(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        query: KnowledgeFSDiffQuery,
    ) -> KnowledgeFSDiffResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="diffKnowledgeFs",
            query=_knowledge_fs_query(
                ("oldPath", query.old_path),
                ("newPath", query.new_path),
                ("mode", query.mode),
                ("semantic", query.semantic),
                ("consistencyClass", query.consistency_class),
            ),
        )
        return KnowledgeFSDiffResponse.model_validate(raw)

    def cat_knowledge_fs(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        query: KnowledgeFSCatQuery,
    ) -> KnowledgeFSCatResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="catKnowledgeFs",
            query=_knowledge_fs_query(
                ("path", query.path),
                ("limit", query.limit),
                ("cursor", query.cursor),
                ("consistencyClass", query.consistency_class),
            ),
        )
        return KnowledgeFSCatResponse.model_validate(raw)

    def stat_knowledge_fs(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        query: KnowledgeFSStatQuery,
    ) -> KnowledgeFSStatResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="statKnowledgeFs",
            query=_knowledge_fs_query(
                ("path", query.path),
                ("consistencyClass", query.consistency_class),
            ),
        )
        return KnowledgeFSStatResponse.model_validate(raw)

    def get_overview_stats(
        self, *, tenant_id: str, account_id: str, control_space_id: str
    ) -> KnowledgeFSOverviewBaseStatsResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getOverviewStats",
        )
        return KnowledgeFSOverviewBaseStatsResponse.model_validate(raw)

    def get_overview_query_outcomes(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        window: Literal["24h", "7d", "30d"],
    ) -> KnowledgeFSOverviewQueryOutcomesResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getOverviewQueryOutcomes",
            query=(("window", window),),
        )
        return KnowledgeFSOverviewQueryOutcomesResponse.model_validate(raw)

    def get_overview_inventory(
        self, *, tenant_id: str, account_id: str, control_space_id: str
    ) -> KnowledgeFSOverviewInventoryResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getOverviewInventory",
        )
        return KnowledgeFSOverviewInventoryResponse.model_validate(raw)

    def list_overview_attention(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        include_dismissed: bool,
        limit: int,
    ) -> KnowledgeFSOverviewAttentionListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listOverviewAttention",
            query=(("includeDismissed", str(include_dismissed).lower()), ("limit", str(limit))),
        )
        return KnowledgeFSOverviewAttentionListResponse.model_validate(raw)

    def list_overview_activity(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        action: str | None,
        actor_id: str | None,
        actor_type: str | None,
        cursor: str | None,
        from_at: str | None,
        limit: int,
        resource_type: str | None,
        result: str | None,
        to_at: str | None,
    ) -> KnowledgeFSOverviewActivityListResponse:
        query = tuple(
            (key, value)
            for key, value in (
                ("action", action),
                ("actorId", actor_id),
                ("actorType", actor_type),
                ("cursor", cursor),
                ("from", from_at),
                ("limit", str(limit)),
                ("resourceType", resource_type),
                ("result", result),
                ("to", to_at),
            )
            if value is not None
        )
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listOverviewActivity",
            query=query,
        )
        return KnowledgeFSOverviewActivityListResponse.model_validate(raw)

    def get_overview_health(
        self, *, tenant_id: str, account_id: str, control_space_id: str
    ) -> KnowledgeFSOverviewHealthResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getOverviewHealth",
        )
        return KnowledgeFSOverviewHealthResponse.model_validate(raw)

    def update_space(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSSpaceUpdatePayload,
    ) -> JsonValue:
        return self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateSpace",
            payload=payload,
        )

    def update_settings(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSSettingsPayload,
    ) -> KnowledgeFSSettingsUpdateResponse:
        current = self.get_settings(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
        )
        has_existing_profile = bool(
            current.active_profile_revisions.embedding is not None
            or current.active_profile_revisions.retrieval is not None
        )
        if has_existing_profile:
            if current.revision != payload.expected_revision:
                raise KnowledgeFSProductRequestRejectedError(status_code=409)
            if payload.embedding is not None and payload.retrieval is not None:
                raise KnowledgeFSProductRequestRejectedError(status_code=422)
            if payload.embedding is not None:
                migration_raw = self._interactive(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    control_space_id=control_space_id,
                    operation_id="updateEmbeddingProfile",
                    payload=payload.embedding,
                )
            elif payload.retrieval is not None:
                retrieval_revision = current.active_profile_revisions.retrieval
                if retrieval_revision is None:
                    raise KnowledgeFSOperationUnavailableError(
                        "KnowledgeFS active retrieval profile revision is unavailable"
                    )
                migration_raw = self._interactive(
                    tenant_id=tenant_id,
                    account_id=account_id,
                    control_space_id=control_space_id,
                    operation_id="updateRetrievalProfile",
                    payload=KnowledgeFSRetrievalProfileUpdatePayload(
                        expectedRevision=retrieval_revision,
                        profile=payload.retrieval,
                    ),
                )
            else:
                raise KnowledgeFSProductRequestRejectedError(status_code=422)
            return KnowledgeFSSettingsUpdateResponse(
                migration=KnowledgeFSProfileMigrationResponse.model_validate(migration_raw),
                settings=current,
            )

        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateSettings",
            payload=payload,
        )
        return KnowledgeFSSettingsUpdateResponse(settings=KnowledgeFSSettingsResponse.model_validate(raw))

    def get_profile_migration(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        migration_id: str,
    ) -> KnowledgeFSProfileMigrationResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getProfileMigration",
            path_parameters=(("migrationId", migration_id),),
        )
        return KnowledgeFSProfileMigrationResponse.model_validate(raw)

    def list_documents(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        cursor: str | None,
    ) -> KnowledgeFSDocumentListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listDocuments",
            query=(("cursor", cursor),) if cursor else (),
        )
        return KnowledgeFSDocumentListResponse.model_validate(raw)

    def list_logical_documents(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        cursor: str | None,
    ) -> KnowledgeFSLogicalDocumentListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listLogicalDocuments",
            query=(("cursor", cursor),) if cursor else (),
        )
        return KnowledgeFSLogicalDocumentListResponse.model_validate(raw)

    def get_logical_document(
        self, *, tenant_id: str, account_id: str, control_space_id: str, document_id: str
    ) -> KnowledgeFSLogicalDocumentResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getLogicalDocument",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
        )
        return KnowledgeFSLogicalDocumentResponse.model_validate(raw)

    def prepare_logical_document_download(
        self, *, tenant_id: str, account_id: str, control_space_id: str, document_id: str
    ) -> KnowledgeFSDocumentDownloadDescriptor:
        """Resolve the readable active revision of a logical document to its stored asset."""
        logical_document = self.get_logical_document(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            document_id=document_id,
        )
        active = logical_document.active
        if active is None:
            raise KnowledgeFSProductResourceNotFoundError("Logical document has no active revision")
        asset = self.get_document(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            document_id=active.document_asset_id,
        )
        if asset.version != active.document_asset_version:
            raise KnowledgeFSProductResourceNotFoundError("Logical document active asset version is unavailable")
        return KnowledgeFSDocumentDownloadDescriptor(
            document_id=logical_document.id,
            filename=asset.filename,
            mime_type=asset.mime_type,
            object_key=asset.object_key,
            sha256=asset.sha256,
            size_bytes=asset.size_bytes,
        )

    def update_logical_document_availability(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        document_id: str,
        payload: KnowledgeFSDocumentAvailabilityPayload,
    ) -> KnowledgeFSLogicalDocumentResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateLogicalDocumentAvailability",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
            payload=payload,
        )
        return KnowledgeFSLogicalDocumentResponse.model_validate(raw)

    def bulk_update_logical_document_availability(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSBulkDocumentAvailabilityPayload,
    ) -> KnowledgeFSBulkDocumentAvailabilityResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="bulkUpdateLogicalDocumentAvailability",
            payload=payload,
        )
        return KnowledgeFSBulkDocumentAvailabilityResponse.model_validate(raw)

    def delete_logical_document(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        document_id: str,
        payload: KnowledgeFSLogicalDocumentDeletePayload,
        idempotency_key: str,
    ) -> KnowledgeFSDurableDeletionAcceptedResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="deleteLogicalDocument",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
            payload=payload,
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSDurableDeletionAcceptedResponse.model_validate(raw)

    def bulk_delete_logical_documents(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSBulkLogicalDocumentDeletePayload,
        idempotency_key: str,
    ) -> KnowledgeFSBulkDeletionAcceptedResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="bulkDeleteLogicalDocuments",
            payload=payload,
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSBulkDeletionAcceptedResponse.model_validate(raw)

    def create_document(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        body_reader: Callable[[int], KnowledgeFSRemoteMultipartFile],
    ) -> KnowledgeFSDocumentUploadAcceptedResponse:
        operation_id = "createDocument"
        _assert_multipart_bff_ready(operation_id)
        issued = self._broker.issue_interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
        )
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        upload = body_reader(operation.max_request_bytes)
        if not upload.filename or not upload.content_type or not isinstance(upload.body, bytes) or not upload.body:
            raise KnowledgeFSProductRequestRejectedError(status_code=422)
        if len(upload.body) > operation.max_request_bytes:
            raise KnowledgeFSProductRequestRejectedError(status_code=413)
        if operation.kfs_path is None:
            raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {operation_id}")
        path = _resolve_product_path(
            template=operation.kfs_path,
            knowledge_space_id=issued.knowledge_space_id,
            resource_id=None,
            resource_resolver=operation.resource_resolver,
            path_parameters=(),
        )
        raw = self._remote.execute_multipart(
            KnowledgeFSRemoteMultipartRequest(
                operation_id=operation_id,
                method=operation.method,
                path=path,
                namespace_id=tenant_id,
                knowledge_space_id=issued.knowledge_space_id,
                capability_token=issued.token,
                trace_id=issued.trace_id,
                file=upload,
            )
        )
        return KnowledgeFSDocumentUploadAcceptedResponse.model_validate(raw)

    def create_upload_session(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSUploadSessionCreatePayload,
        idempotency_key: str,
    ) -> KnowledgeFSUploadSessionCreateResponse:
        remote_payload = KnowledgeFSUploadSessionCreateRemotePayload(
            **payload.model_dump(mode="python"),
            idempotencyKey=idempotency_key,
        )
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="createUploadSession",
            payload=remote_payload,
        )
        return KnowledgeFSUploadSessionCreateResponse.model_validate(raw)

    def presign_upload_session_part(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        upload_session_id: str,
        part_number: int,
        payload: KnowledgeFSUploadPartPresignPayload,
    ) -> KnowledgeFSPresignedUploadResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="presignUploadSessionPart",
            resource_id=upload_session_id,
            payload=payload,
            bind_space_in_body=True,
            path_parameters=(("partNumber", str(part_number)),),
        )
        return KnowledgeFSPresignedUploadResponse.model_validate(raw)

    def complete_upload_session(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        upload_session_id: str,
        payload: KnowledgeFSUploadSessionCompletePayload,
    ) -> KnowledgeFSUploadSessionMutationResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="completeUploadSession",
            resource_id=upload_session_id,
            payload=payload,
            bind_space_in_body=True,
        )
        return KnowledgeFSUploadSessionMutationResponse.model_validate(raw)

    def abort_upload_session(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        upload_session_id: str,
        payload: KnowledgeFSUploadSessionAbortPayload,
    ) -> KnowledgeFSUploadSessionMutationResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="abortUploadSession",
            resource_id=upload_session_id,
            payload=payload,
            bind_space_in_body=True,
        )
        return KnowledgeFSUploadSessionMutationResponse.model_validate(raw)

    def upload_small_file(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        upload_session_id: str,
        body_reader: Callable[[int], bytes],
    ) -> KnowledgeFSSmallFileUploadResponse:
        operation_id = "uploadSmallFile"
        _assert_binary_bff_ready(operation_id)
        issued = self._broker.issue_interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
            resource_id=upload_session_id,
        )
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        body = body_reader(operation.max_request_bytes)
        if not isinstance(body, bytes) or not body:
            raise KnowledgeFSProductRequestRejectedError(status_code=422)
        if len(body) > operation.max_request_bytes:
            raise KnowledgeFSProductRequestRejectedError(status_code=413)
        if operation.kfs_path is None:
            raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {operation_id}")
        path = _resolve_product_path(
            template=operation.kfs_path,
            knowledge_space_id=issued.knowledge_space_id,
            resource_id=upload_session_id,
            resource_resolver=operation.resource_resolver,
            path_parameters=(),
        )
        raw = self._remote.execute_binary(
            KnowledgeFSRemoteBinaryRequest(
                operation_id=operation_id,
                method=operation.method,
                path=path,
                namespace_id=tenant_id,
                knowledge_space_id=issued.knowledge_space_id,
                capability_token=issued.token,
                trace_id=issued.trace_id,
                body=body,
                query=(("knowledgeSpaceId", issued.knowledge_space_id),),
            )
        )
        return KnowledgeFSSmallFileUploadResponse.model_validate(raw)

    def get_document(
        self, *, tenant_id: str, account_id: str, control_space_id: str, document_id: str
    ) -> KnowledgeFSDocumentResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getDocument",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
        )
        return KnowledgeFSDocumentResponse.model_validate(raw)

    def get_document_outline(
        self, *, tenant_id: str, account_id: str, control_space_id: str, document_id: str
    ) -> KnowledgeFSDocumentOutlineResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getDocumentOutline",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
        )
        return KnowledgeFSDocumentOutlineResponse.model_validate(raw)

    def get_document_multimodal_manifest(
        self, *, tenant_id: str, account_id: str, control_space_id: str, document_id: str
    ) -> KnowledgeFSDocumentMultimodalManifest:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getDocumentMultimodalManifest",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
        )
        return KnowledgeFSDocumentMultimodalManifest.model_validate(raw)

    def list_document_revisions(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        document_id: str,
        cursor: str | None = None,
    ) -> KnowledgeFSDocumentRevisionListResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listDocumentRevisions",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
            query=(("cursor", cursor),) if cursor else (),
        )
        return KnowledgeFSDocumentRevisionListResponse.model_validate(raw)

    def update_document_metadata(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        document_id: str,
        payload: KnowledgeFSDocumentMetadataPayload,
    ) -> KnowledgeFSLogicalDocumentResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateDocumentMetadata",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
            payload=payload,
        )
        return KnowledgeFSLogicalDocumentResponse.model_validate(raw)

    def list_metadata_fields(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        cursor: str | None = None,
        limit: int = 100,
    ) -> KnowledgeFSMetadataFieldListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listMetadataFields",
            query=_knowledge_fs_query(("cursor", cursor), ("limit", limit)),
        )
        return KnowledgeFSMetadataFieldListResponse.model_validate(raw)

    def create_metadata_field(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSMetadataFieldCreatePayload,
    ) -> KnowledgeFSMetadataFieldResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="createMetadataField",
            payload=payload,
        )
        return KnowledgeFSMetadataFieldResponse.model_validate(raw)

    def update_metadata_field(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        field_id: str,
        payload: KnowledgeFSMetadataFieldUpdatePayload,
    ) -> KnowledgeFSMetadataFieldResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateMetadataField",
            path_parameters=(("fieldId", field_id),),
            payload=payload,
        )
        return KnowledgeFSMetadataFieldResponse.model_validate(raw)

    def delete_metadata_field(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        field_id: str,
        expected_row_version: int,
    ) -> KnowledgeFSMetadataFieldDeleteResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="deleteMetadataField",
            path_parameters=(("fieldId", field_id),),
            query=(("expectedRowVersion", str(expected_row_version)),),
        )
        return KnowledgeFSMetadataFieldDeleteResponse.model_validate(raw)

    def list_document_chunks(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        document_id: str,
        revision: int,
        cursor: str | None = None,
        query_text: str | None = None,
    ) -> KnowledgeFSDocumentChunkListResponse:
        query = tuple((name, value) for name, value in (("cursor", cursor), ("query", query_text)) if value)
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listDocumentChunks",
            resource_id=document_id,
            path_parameters=(("documentId", document_id), ("revision", str(revision))),
            query=query,
        )
        return KnowledgeFSDocumentChunkListResponse.model_validate(raw)

    def get_document_chunk(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        document_id: str,
        revision: int,
        chunk_id: str,
    ) -> KnowledgeFSDocumentChunkResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getDocumentChunk",
            resource_id=document_id,
            path_parameters=(
                ("documentId", document_id),
                ("revision", str(revision)),
                ("chunkId", chunk_id),
            ),
        )
        return KnowledgeFSDocumentChunkResponse.model_validate(raw)

    def delete_document(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        document_id: str,
        payload: KnowledgeFSDocumentDeletePayload,
        idempotency_key: str,
    ) -> KnowledgeFSDurableDeletionAcceptedResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="deleteDocument",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
            payload=payload,
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSDurableDeletionAcceptedResponse.model_validate(raw)

    def bulk_delete_documents(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSBulkDocumentDeletePayload,
        idempotency_key: str,
    ) -> KnowledgeFSBulkDeletionAcceptedResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="bulkDeleteDocuments",
            payload=payload,
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSBulkDeletionAcceptedResponse.model_validate(raw)

    def reindex_documents(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSDocumentReindexPayload,
    ) -> KnowledgeFSDocumentReindexResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="reindexDocuments",
            payload=payload,
        )
        return KnowledgeFSDocumentReindexResponse.model_validate(raw)

    def get_compilation_job(
        self, *, tenant_id: str, account_id: str, control_space_id: str, job_id: str
    ) -> KnowledgeFSDocumentCompilationJobResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getCompilationJob",
            resource_id=job_id,
        )
        return KnowledgeFSDocumentCompilationJobResponse.model_validate(raw)

    def cancel_compilation_job(
        self, *, tenant_id: str, account_id: str, control_space_id: str, job_id: str
    ) -> KnowledgeFSDocumentCompilationJobResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="cancelCompilationJob",
            resource_id=job_id,
        )
        return KnowledgeFSDocumentCompilationJobResponse.model_validate(raw)

    def retry_compilation_job(
        self, *, tenant_id: str, account_id: str, control_space_id: str, job_id: str
    ) -> KnowledgeFSDocumentCompilationJobResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="retryCompilationJob",
            resource_id=job_id,
        )
        return KnowledgeFSDocumentCompilationJobResponse.model_validate(raw)

    def get_bulk_job(
        self, *, tenant_id: str, account_id: str, control_space_id: str, job_id: str
    ) -> KnowledgeFSBulkJobResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getBulkJob",
            resource_id=job_id,
        )
        return KnowledgeFSBulkJobResponse.model_validate(raw)

    def list_background_tasks(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        cursor: str | None = None,
        limit: int = 50,
    ) -> KnowledgeFSBackgroundTaskListResponse:
        query = (("limit", str(limit)),) + ((("cursor", cursor),) if cursor else ())
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listBackgroundTasks",
            query=query,
        )
        return KnowledgeFSBackgroundTaskListResponse.model_validate(raw)

    def cancel_background_task(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        task_kind: Literal["document", "document_bulk", "source"],
        task_id: str,
    ) -> KnowledgeFSBackgroundTaskResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="cancelBackgroundTask",
            resource_id=task_id,
            path_parameters=(("taskKind", task_kind), ("taskId", task_id)),
        )
        return KnowledgeFSBackgroundTaskResponse.model_validate(raw)

    def retry_background_task(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        task_kind: Literal["document", "document_bulk", "source"],
        task_id: str,
    ) -> KnowledgeFSBackgroundTaskResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="retryBackgroundTask",
            resource_id=task_id,
            path_parameters=(("taskKind", task_kind), ("taskId", task_id)),
        )
        return KnowledgeFSBackgroundTaskResponse.model_validate(raw)

    def list_sources(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        cursor: str | None = None,
        limit: int = 50,
    ) -> KnowledgeFSSourceListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listSources",
            query=(
                *((("cursor", cursor),) if cursor else ()),
                ("limit", str(limit)),
            ),
        )
        return KnowledgeFSSourceListResponse.model_validate(raw)

    def create_source(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSSourceCreatePayload,
    ) -> KnowledgeFSSourceResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="createSource",
            payload=payload,
        )
        return KnowledgeFSSourceResponse.model_validate(raw)

    def get_source(
        self, *, tenant_id: str, account_id: str, control_space_id: str, source_id: str
    ) -> KnowledgeFSSourceResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return KnowledgeFSSourceResponse.model_validate(raw)

    def update_source(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        payload: KnowledgeFSSourceUpdatePayload,
    ) -> KnowledgeFSSourceResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=payload,
        )
        return KnowledgeFSSourceResponse.model_validate(raw)

    def delete_source(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        payload: KnowledgeFSSourceDeletePayload,
        documents: Literal["cascade", "keep"],
        idempotency_key: str,
    ) -> KnowledgeFSDurableDeletionAcceptedResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="deleteSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=payload,
            query=(("documents", documents),),
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSDurableDeletionAcceptedResponse.model_validate(raw)

    def test_source(
        self, *, tenant_id: str, account_id: str, control_space_id: str, source_id: str
    ) -> KnowledgeFSSourceCredentialTestResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="testSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return KnowledgeFSSourceCredentialTestResponse.model_validate(raw)

    def sync_source(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        idempotency_key: str,
    ) -> KnowledgeFSSourceWorkflowResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="syncSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSSourceWorkflowResponse.model_validate(raw)

    def list_source_providers(
        self, *, tenant_id: str, account_id: str, control_space_id: str
    ) -> KnowledgeFSSourceProviderListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listSourceProviders",
        )
        return KnowledgeFSSourceProviderListResponse.model_validate(raw)

    def create_source_connection(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSSourceConnectionCreatePayload,
    ) -> KnowledgeFSSourceConnectionResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="createSourceConnection",
            payload=payload,
        )
        return KnowledgeFSSourceConnectionResponse.model_validate(raw)

    def list_source_connections(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        cursor: str | None,
        limit: int,
    ) -> KnowledgeFSSourceConnectionListResponse:
        query = (("limit", str(limit)),) + ((("cursor", cursor),) if cursor else ())
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listSourceConnections",
            query=query,
        )
        return KnowledgeFSSourceConnectionListResponse.model_validate(raw)

    def refresh_source_connection(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        connection_id: str,
        payload: KnowledgeFSSourceConnectionRefreshPayload,
    ) -> KnowledgeFSSourceConnectionResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="refreshSourceConnection",
            payload=payload,
            path_parameters=(("connectionId", connection_id),),
        )
        return KnowledgeFSSourceConnectionResponse.model_validate(raw)

    def preview_source_crawl(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        idempotency_key: str,
    ) -> KnowledgeFSSourceWorkflowResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="previewSourceCrawl",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSSourceWorkflowResponse.model_validate(raw)

    def import_selected_source_crawl(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        payload: KnowledgeFSCrawlImportPayload,
        idempotency_key: str,
    ) -> KnowledgeFSSourceWorkflowResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="importSelectedSourceCrawl",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=payload,
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSSourceWorkflowResponse.model_validate(raw)

    def import_source_workflow(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        payload: KnowledgeFSSourceWorkflowImportPayload,
        idempotency_key: str,
    ) -> KnowledgeFSSourceWorkflowResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="importSourceWorkflow",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=payload,
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSSourceWorkflowResponse.model_validate(raw)

    def get_source_sync_policy(
        self, *, tenant_id: str, account_id: str, control_space_id: str, source_id: str
    ) -> KnowledgeFSSourceSyncPolicyResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getSourceSyncPolicy",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return KnowledgeFSSourceSyncPolicyResponse.model_validate(raw)

    def update_source_sync_policy(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        payload: KnowledgeFSSourceSyncPolicyPayload,
    ) -> KnowledgeFSSourceSyncPolicyResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateSourceSyncPolicy",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=payload,
        )
        return KnowledgeFSSourceSyncPolicyResponse.model_validate(raw)

    def get_source_workflow(
        self, *, tenant_id: str, account_id: str, control_space_id: str, run_id: str
    ) -> KnowledgeFSSourceWorkflowResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getSourceWorkflow",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
        )
        return KnowledgeFSSourceWorkflowResponse.model_validate(raw)

    def cancel_source_workflow(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        run_id: str,
        payload: KnowledgeFSSourceWorkflowCancelPayload,
    ) -> KnowledgeFSSourceWorkflowResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="cancelSourceWorkflow",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
            payload=payload,
        )
        return KnowledgeFSSourceWorkflowResponse.model_validate(raw)

    def retry_source_workflow(
        self, *, tenant_id: str, account_id: str, control_space_id: str, run_id: str
    ) -> KnowledgeFSSourceWorkflowResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="retrySourceWorkflow",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
        )
        return KnowledgeFSSourceWorkflowResponse.model_validate(raw)

    def list_crawl_preview_pages(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        run_id: str,
        cursor: str | None,
        limit: int,
    ) -> KnowledgeFSCrawlPreviewPageListResponse:
        query = (("limit", str(limit)),) + ((("cursor", cursor),) if cursor else ())
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listCrawlPreviewPages",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
            query=query,
        )
        return KnowledgeFSCrawlPreviewPageListResponse.model_validate(raw)

    def select_crawl_preview_pages(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        run_id: str,
        payload: KnowledgeFSCrawlPreviewSelectionPayload,
        idempotency_key: str,
    ) -> KnowledgeFSSourceWorkflowResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="selectCrawlPreviewPages",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
            payload=payload,
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSSourceWorkflowResponse.model_validate(raw)

    def crawl_source(
        self, *, tenant_id: str, account_id: str, control_space_id: str, source_id: str
    ) -> KnowledgeFSSourceCrawlResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="crawlSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return KnowledgeFSSourceCrawlResponse.model_validate(raw)

    def list_source_pages(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        cursor: str | None = None,
        limit: int = 50,
    ) -> KnowledgeFSSourcePagesResponse:
        query = (("limit", str(limit)),) + ((("cursor", cursor),) if cursor else ())
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listSourcePages",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            query=query,
        )
        return KnowledgeFSSourcePagesResponse.model_validate(raw)

    def import_source_pages(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        payload: KnowledgeFSSourceImportPagesPayload,
    ) -> KnowledgeFSSourceImportResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="importSourcePages",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=payload,
        )
        return KnowledgeFSSourceImportResponse.model_validate(raw)

    def list_source_files(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        query: tuple[tuple[str, str], ...] = (),
    ) -> KnowledgeFSSourceFilesResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listSourceFiles",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            query=query,
        )
        return KnowledgeFSSourceFilesResponse.model_validate(raw)

    def import_source_files(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        source_id: str,
        payload: KnowledgeFSSourceImportFilesPayload,
    ) -> KnowledgeFSSourceImportResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="importSourceFiles",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=payload,
        )
        return KnowledgeFSSourceImportResponse.model_validate(raw)

    def create_query(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSQueryCreatePayload,
    ) -> KnowledgeFSQueryResponse:
        _ = (tenant_id, account_id, control_space_id, payload)
        raise KnowledgeFSOperationUnavailableError(
            "Buffered KnowledgeFS query creation is deprecated; use the queries/admission direct flow"
        )

    def create_research_task(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSResearchTaskCreatePayload,
    ) -> KnowledgeFSResearchTaskResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="createResearchTask",
            payload=payload,
            bind_space_in_body=True,
        )
        return KnowledgeFSResearchTaskResponse.model_validate(raw)

    def plan_research_task(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSResearchTaskPlanPayload,
    ) -> KnowledgeFSResearchTaskPlanResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="planResearchTask",
            payload=payload,
            bind_space_in_body=True,
        )
        return KnowledgeFSResearchTaskPlanResponse.model_validate(raw)

    def get_research_task(
        self, *, tenant_id: str, account_id: str, control_space_id: str, task_id: str
    ) -> KnowledgeFSResearchTaskResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getResearchTask",
            resource_id=task_id,
        )
        return KnowledgeFSResearchTaskResponse.model_validate(raw)

    def list_research_task_partials(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        task_id: str,
        cursor: str | None = None,
        limit: int = 25,
    ) -> KnowledgeFSResearchTaskPartialListResponse:
        query = (("limit", str(limit)),) + ((("cursor", cursor),) if cursor else ())
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listResearchTaskPartials",
            resource_id=task_id,
            query=query,
        )
        return KnowledgeFSResearchTaskPartialListResponse.model_validate(raw)

    def cancel_research_task(
        self, *, tenant_id: str, account_id: str, control_space_id: str, task_id: str
    ) -> KnowledgeFSResearchTaskResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="cancelResearchTask",
            resource_id=task_id,
        )
        return KnowledgeFSResearchTaskResponse.model_validate(raw)

    def list_research_tasks(
        self, *, tenant_id: str, account_id: str, control_space_id: str, cursor: str | None = None
    ) -> KnowledgeFSResearchTaskListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listResearchTasks",
            query=(("cursor", cursor),) if cursor else (),
        )
        return KnowledgeFSResearchTaskListResponse.model_validate(raw)

    def list_traces(
        self, *, tenant_id: str, account_id: str, control_space_id: str, cursor: str | None = None
    ) -> KnowledgeFSTraceListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listTraces",
            query=(("cursor", cursor),) if cursor else (),
        )
        return KnowledgeFSTraceListResponse.model_validate(raw)

    def list_golden_questions(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        cursor: str | None = None,
        limit: int = 50,
    ) -> KnowledgeFSGoldenQuestionListResponse:
        query = (("limit", str(limit)),) + ((("cursor", cursor),) if cursor else ())
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listGoldenQuestions",
            query=query,
        )
        return KnowledgeFSGoldenQuestionListResponse.model_validate(raw)

    def create_golden_question(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSGoldenQuestionPayload,
    ) -> KnowledgeFSGoldenQuestionResponse:
        metadata: dict[str, object] = {
            "annotation": payload.annotation,
            "evidenceText": payload.evidence_text,
            "matchPolicy": payload.match_policy,
        }
        if payload.source_bad_case_id is not None:
            metadata["sourceBadCaseId"] = payload.source_bad_case_id
        remote_payload = KnowledgeFSGoldenQuestionRemotePayload(
            expected_evidence_ids=payload.expected_evidence_ids,
            metadata=metadata,
            question=payload.question,
            tags=payload.tags,
        )
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="createGoldenQuestion",
            payload=remote_payload,
        )
        return KnowledgeFSGoldenQuestionResponse.model_validate(raw)

    def update_golden_question(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        question_id: str,
        payload: KnowledgeFSGoldenQuestionPayload,
    ) -> KnowledgeFSGoldenQuestionResponse:
        metadata: dict[str, object] = {"annotation": payload.annotation}
        if "evidence_text" in payload.model_fields_set:
            metadata["evidenceText"] = payload.evidence_text
        if "match_policy" in payload.model_fields_set:
            metadata["matchPolicy"] = payload.match_policy
        if payload.source_bad_case_id is not None:
            metadata["sourceBadCaseId"] = payload.source_bad_case_id
        remote_payload = KnowledgeFSGoldenQuestionUpdateRemotePayload(
            expected_evidence_ids=(
                payload.expected_evidence_ids if "expected_evidence_ids" in payload.model_fields_set else None
            ),
            metadata=metadata,
            question=payload.question,
            tags=payload.tags,
        )
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateGoldenQuestion",
            resource_id=question_id,
            path_parameters=(("questionId", question_id),),
            payload=remote_payload,
        )
        return KnowledgeFSGoldenQuestionResponse.model_validate(raw)

    def match_golden_question_evidence(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSGoldenQuestionEvidenceMatchPayload,
    ) -> KnowledgeFSGoldenQuestionEvidenceMatchResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="matchGoldenQuestionEvidence",
            payload=KnowledgeFSGoldenQuestionEvidenceMatchRemotePayload(
                evidence_texts=[payload.evidence] if payload.evidence else None,
                minimum_similarity=payload.minimum_similarity,
                node_ids=payload.node_ids or None,
                top_k=payload.top_k,
            ),
        )
        if not isinstance(raw, dict):
            raise KnowledgeFSProductRemoteError("KnowledgeFS returned an invalid evidence match response")
        if payload.node_ids:
            return KnowledgeFSGoldenQuestionEvidenceMatchResponse.model_validate(
                {
                    "candidates": raw.get("resolvedEvidence", []),
                    "evidence": "",
                    "matched": False,
                }
            )
        items = raw.get("items")
        if not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict):
            raise KnowledgeFSProductRemoteError("KnowledgeFS returned an invalid evidence match response")
        item = items[0]
        return KnowledgeFSGoldenQuestionEvidenceMatchResponse.model_validate(
            {
                "candidates": item.get("candidates", []),
                "evidence": item.get("evidenceText", payload.evidence or ""),
                "matched": item.get("matched", False),
            }
        )

    def bulk_import_golden_questions(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSGoldenQuestionBulkImportPayload,
    ) -> KnowledgeFSGoldenQuestionBulkImportResponse:
        remote_payload = KnowledgeFSGoldenQuestionBulkImportRemotePayload(
            match_policy=payload.match_policy,
            minimum_similarity=payload.minimum_similarity,
            rows=[
                KnowledgeFSGoldenQuestionBulkImportRemoteRowPayload(
                    evidence=row.evidence,
                    metadata={"evidenceText": row.evidence, "importSource": "csv"},
                    question=row.question,
                    tags=row.tags,
                )
                for row in payload.rows
            ],
        )
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="bulkImportGoldenQuestions",
            payload=remote_payload,
        )
        return KnowledgeFSGoldenQuestionBulkImportResponse.model_validate(raw)

    def delete_golden_question(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        question_id: str,
    ) -> None:
        self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="deleteGoldenQuestion",
            resource_id=question_id,
            path_parameters=(("questionId", question_id),),
        )

    def list_bad_cases(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        cursor: str | None = None,
        limit: int = 50,
    ) -> KnowledgeFSBadCaseListResponse:
        query = (("limit", str(limit)),) + ((("cursor", cursor),) if cursor else ())
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listQualityBadCases",
            query=query,
        )
        return KnowledgeFSBadCaseListResponse.model_validate(raw)

    def create_bad_case(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSBadCaseCreatePayload,
    ) -> KnowledgeFSBadCaseResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="createQualityBadCase",
            payload=payload,
        )
        return KnowledgeFSBadCaseResponse.model_validate(raw)

    def get_bad_case(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        bad_case_id: str,
    ) -> KnowledgeFSBadCaseResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getQualityBadCase",
            resource_id=bad_case_id,
            path_parameters=(("badCaseId", bad_case_id),),
        )
        return KnowledgeFSBadCaseResponse.model_validate(raw)

    def update_bad_case(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        bad_case_id: str,
        payload: KnowledgeFSBadCaseUpdatePayload,
    ) -> KnowledgeFSBadCaseResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateQualityBadCase",
            resource_id=bad_case_id,
            path_parameters=(("badCaseId", bad_case_id),),
            payload=payload,
        )
        return KnowledgeFSBadCaseResponse.model_validate(raw)

    def get_bad_case_trace_reference(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        bad_case_id: str,
    ) -> KnowledgeFSBadCaseTraceReferenceResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getQualityBadCaseTraceReference",
            resource_id=bad_case_id,
            path_parameters=(("badCaseId", bad_case_id),),
        )
        return KnowledgeFSBadCaseTraceReferenceResponse.model_validate(raw)

    def create_quality_replay(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSQualityReplayPayload,
        idempotency_key: str,
    ) -> KnowledgeFSQualityReplayResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="createQualityReplay",
            payload=payload,
            headers=(("Idempotency-Key", idempotency_key),),
        )
        return KnowledgeFSQualityReplayResponse.model_validate(raw)

    def list_quality_replays(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        cursor: str | None = None,
        limit: int = 20,
        mode: Literal["deep", "fast", "research"] | None = None,
        state: Literal["queued", "running", "passed", "failed", "canceled"] | None = None,
    ) -> KnowledgeFSQualityReplayListResponse:
        query: tuple[tuple[str, str], ...] = (("limit", str(limit)),)
        if cursor:
            query += (("cursor", cursor),)
        if mode:
            query += (("mode", mode),)
        if state:
            query += (("state", state),)
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listQualityReplays",
            query=query,
        )
        return KnowledgeFSQualityReplayListResponse.model_validate(raw)

    def get_quality_replay(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        run_id: str,
        evidence_item_id: str | None = None,
    ) -> KnowledgeFSQualityReplayResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getQualityReplay",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
            query=(("evidenceItemId", evidence_item_id),) if evidence_item_id else (),
        )
        return KnowledgeFSQualityReplayResponse.model_validate(raw)

    def get_trace(
        self, *, tenant_id: str, account_id: str, control_space_id: str, trace_id: str
    ) -> KnowledgeFSAnswerTraceResponse:
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getTrace",
            resource_id=trace_id,
            path_parameters=(("traceId", trace_id),),
        )
        return KnowledgeFSAnswerTraceResponse.model_validate(raw)

    def list_trace_entries(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        trace_id: str,
        kind: Literal["conflicts", "evidence", "missing"],
        cursor: str | None = None,
        limit: int = 100,
    ) -> KnowledgeFSTraceEntryListResponse:
        operation_id = {
            "conflicts": "listTraceConflicts",
            "evidence": "listTraceEvidence",
            "missing": "listTraceMissing",
        }[kind]
        query = (("limit", str(limit)),) + ((("cursor", cursor),) if cursor else ())
        raw = self._interactive_child(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
            resource_id=trace_id,
            path_parameters=(("traceId", trace_id),),
            query=query,
        )
        return KnowledgeFSTraceEntryListResponse.model_validate(raw)

    def execute_service(
        self,
        *,
        profile: KnowledgeFSServiceCredentialProfile,
        operation_id: str,
        payload: BaseModel | None = None,
        query: tuple[tuple[str, str], ...] = (),
        bind_space_in_body: bool = False,
        resource_id: str | None = None,
        path_parameters: tuple[tuple[str, str], ...] = (),
        headers: tuple[tuple[str, str], ...] = (),
    ) -> JsonValue:
        _assert_json_bff_ready(operation_id)
        issued = self._broker.issue_service(profile=profile, operation_id=operation_id, resource_id=resource_id)
        return self._execute(
            operation_id=operation_id,
            namespace_id=profile.tenant_id,
            knowledge_space_id=profile.knowledge_space_id,
            knowledge_space_revision=profile.knowledge_space_revision,
            capability_token=issued.token,
            trace_id=issued.trace_id,
            payload=payload,
            query=query,
            bind_space_in_body=bind_space_in_body,
            resource_id=resource_id,
            path_parameters=path_parameters,
            headers=headers,
        )

    def _interactive(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        operation_id: str,
        payload: BaseModel | None = None,
        query: tuple[tuple[str, str], ...] = (),
        bind_space_in_body: bool = False,
        resource_id: str | None = None,
        path_parameters: tuple[tuple[str, str], ...] = (),
        headers: tuple[tuple[str, str], ...] = (),
    ) -> JsonValue:
        _assert_json_bff_ready(operation_id)
        issued = self._broker.issue_interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
            resource_id=resource_id,
        )
        return self._execute(
            operation_id=operation_id,
            namespace_id=tenant_id,
            knowledge_space_id=issued.knowledge_space_id,
            knowledge_space_revision=issued.knowledge_space_revision,
            capability_token=issued.token,
            trace_id=issued.trace_id,
            payload=payload,
            query=query,
            bind_space_in_body=bind_space_in_body,
            resource_id=resource_id,
            path_parameters=path_parameters,
            headers=headers,
        )

    def _interactive_child(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        operation_id: str,
        resource_id: str,
        payload: BaseModel | None = None,
        query: tuple[tuple[str, str], ...] = (),
        bind_space_in_body: bool = False,
        path_parameters: tuple[tuple[str, str], ...] = (),
        headers: tuple[tuple[str, str], ...] = (),
    ) -> JsonValue:
        return self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id=operation_id,
            resource_id=resource_id,
            payload=payload,
            query=query,
            bind_space_in_body=bind_space_in_body,
            path_parameters=path_parameters,
            headers=headers,
        )

    def _execute(
        self,
        *,
        operation_id: str,
        namespace_id: str,
        knowledge_space_id: str,
        knowledge_space_revision: int,
        capability_token: str,
        trace_id: str,
        payload: BaseModel | None,
        query: tuple[tuple[str, str], ...],
        bind_space_in_body: bool,
        resource_id: str | None,
        path_parameters: tuple[tuple[str, str], ...],
        headers: tuple[tuple[str, str], ...],
    ) -> JsonValue:
        operation = KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id]
        if operation.kfs_path is None:
            raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {operation_id}")
        path = _resolve_product_path(
            template=operation.kfs_path,
            knowledge_space_id=knowledge_space_id,
            resource_id=resource_id,
            resource_resolver=operation.resource_resolver,
            path_parameters=path_parameters,
        )
        remote_payload: JsonValue | None = (
            payload.model_dump(mode="json", exclude_none=True, by_alias=True) if payload is not None else None
        )
        if operation_id == "updateSpace":
            if knowledge_space_revision <= 0 or not isinstance(payload, KnowledgeFSSpaceUpdatePayload):
                raise KnowledgeFSOperationUnavailableError("KnowledgeFS metadata revision is not available")
            remote_payload = {"expectedRevision": knowledge_space_revision}
            if payload.name is not None:
                remote_payload["name"] = payload.name
            if payload.icon is not None:
                remote_payload["iconRef"] = payload.icon
            if payload.description is not None:
                remote_payload["description"] = payload.description
        if bind_space_in_body:
            if not isinstance(remote_payload, dict):
                raise KnowledgeFSOperationUnavailableError("KnowledgeFS request body binding is unavailable")
            remote_payload["knowledgeSpaceId"] = knowledge_space_id
        if operation.resource_resolver in {"job", "query", "research_task"} and not path.startswith(
            "/knowledge-spaces/"
        ):
            query = (*query, ("knowledgeSpaceId", knowledge_space_id))
        return self._remote.execute_json(
            KnowledgeFSRemoteJSONRequest(
                operation_id=operation_id,
                method=operation.method,
                path=path,
                namespace_id=namespace_id,
                knowledge_space_id=knowledge_space_id,
                capability_token=capability_token,
                trace_id=trace_id,
                payload=remote_payload,
                query=query,
                headers=headers,
            )
        )


def _resolve_product_path(
    *,
    template: str,
    knowledge_space_id: str,
    resource_id: str | None,
    resource_resolver: str,
    path_parameters: tuple[tuple[str, str], ...],
) -> str:
    bindings = {name: _path_segment(value) for name, value in path_parameters}
    if template.startswith("/knowledge-spaces/{id}") or resource_resolver in {"knowledge_space", "namespace"}:
        bindings["id"] = _path_segment(knowledge_space_id)
    elif "{id}" in template:
        if resource_id is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS child resource is required")
        bindings["id"] = _path_segment(resource_id)
    path = template
    for name, value in bindings.items():
        path = path.replace(f"{{{name}}}", value)
    if "{" in path or "}" in path:
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS product path resolver is not registered")
    return path


def _path_segment(value: str) -> str:
    normalized = value.strip()
    if (
        not normalized
        or len(normalized) > 1_000
        or normalized in {".", ".."}
        or any(character in normalized for character in ("/", "%", "?", "#", "\\"))
    ):
        raise KnowledgeFSOperationUnavailableError("KnowledgeFS product path parameter is invalid")
    return normalized


def _knowledge_fs_query(*items: tuple[str, object | None]) -> tuple[tuple[str, str], ...]:
    def serialize(value: object) -> str:
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)

    return tuple((name, serialize(value)) for name, value in items if value is not None)


def _assert_ready(operation_id: str) -> None:
    if not is_product_operation_ready(operation_id):
        raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {operation_id}")


def _assert_json_bff_ready(operation_id: str) -> None:
    _assert_ready(operation_id)
    if KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id].transport != "json":
        raise KnowledgeFSOperationUnavailableError(
            f"KnowledgeFS operation does not allow the buffered JSON BFF: {operation_id}"
        )


def _assert_binary_bff_ready(operation_id: str) -> None:
    _assert_ready(operation_id)
    if KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id].transport != "binary":
        raise KnowledgeFSOperationUnavailableError(
            f"KnowledgeFS operation does not allow the bounded binary BFF: {operation_id}"
        )


def _assert_multipart_bff_ready(operation_id: str) -> None:
    _assert_ready(operation_id)
    if KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id].transport != "multipart":
        raise KnowledgeFSOperationUnavailableError(
            f"KnowledgeFS operation does not allow the bounded multipart BFF: {operation_id}"
        )


def _assert_sse_bff_ready(operation_id: str) -> None:
    _assert_ready(operation_id)
    if KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id].transport != "sse":
        raise KnowledgeFSOperationUnavailableError(
            f"KnowledgeFS operation does not allow the streaming BFF: {operation_id}"
        )


__all__ = ["KnowledgeFSDataFacade"]
