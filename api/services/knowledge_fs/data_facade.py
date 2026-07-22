"""Typed KnowledgeFS BFF facade over operation capabilities and bounded transports."""

from __future__ import annotations

from collections.abc import Callable, Generator
from contextlib import contextmanager
from typing import Literal

from pydantic import BaseModel, JsonValue

from services.knowledge_fs.capability_broker import KnowledgeFSCapabilityBroker
from services.knowledge_fs.credential_service import KnowledgeFSServiceCredentialProfile
from services.knowledge_fs.operation_admission import KnowledgeFSOperationAdmissionService
from services.knowledge_fs.product_dto import (
    KnowledgeFSAnswerTraceResponse,
    KnowledgeFSBulkDeletionAcceptedResponse,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSDocumentChunkListResponse,
    KnowledgeFSDocumentChunkResponse,
    KnowledgeFSDocumentCompilationJobResponse,
    KnowledgeFSDocumentCreatePayload,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSDocumentListResponse,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSDocumentReindexResponse,
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentRevisionListResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSQueryResponse,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskListResponse,
    KnowledgeFSResearchTaskPartialListResponse,
    KnowledgeFSResearchTaskPlanPayload,
    KnowledgeFSResearchTaskPlanResponse,
    KnowledgeFSResearchTaskResponse,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSettingsResponse,
    KnowledgeFSSmallFileUploadResponse,
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
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSpaceUpdatePayload,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSTraceListResponse,
)
from services.knowledge_fs.product_operations import KNOWLEDGE_FS_PRODUCT_OPERATIONS, is_product_operation_ready
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemotePort,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSRemoteBinaryRequest,
    KnowledgeFSRemoteJSONRequest,
)


class KnowledgeFSDataFacade:
    def __init__(
        self,
        *,
        admission: KnowledgeFSOperationAdmissionService,
        broker: KnowledgeFSCapabilityBroker,
        remote: KnowledgeFSProductRemotePort,
    ) -> None:
        self._admission = admission
        self._broker = broker
        self._remote = remote

    def get_settings(self, *, tenant_id: str, account_id: str, control_space_id: str) -> KnowledgeFSSettingsResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="getSettings",
        )
        return KnowledgeFSSettingsResponse.model_validate(raw)

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
    ) -> KnowledgeFSSettingsResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="updateSettings",
            payload=payload,
        )
        return KnowledgeFSSettingsResponse.model_validate(raw)

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

    def create_document(
        self,
        *,
        tenant_id: str,
        account_id: str,
        control_space_id: str,
        payload: KnowledgeFSDocumentCreatePayload,
    ) -> KnowledgeFSDocumentResponse:
        _ = (tenant_id, account_id, control_space_id, payload)
        raise KnowledgeFSOperationUnavailableError(
            "Buffered KnowledgeFS document creation is deprecated; use the P6 direct-upload capability flow"
        )

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
        with self._admitted(tenant_id=tenant_id, operation_id=operation_id):
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

    def list_sources(
        self, *, tenant_id: str, account_id: str, control_space_id: str, cursor: str | None = None
    ) -> KnowledgeFSSourceListResponse:
        raw = self._interactive(
            tenant_id=tenant_id,
            account_id=account_id,
            control_space_id=control_space_id,
            operation_id="listSources",
            query=(("cursor", cursor),) if cursor else (),
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
        with self._admitted(tenant_id=profile.tenant_id, operation_id=operation_id):
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
        with self._admitted(tenant_id=tenant_id, operation_id=operation_id):
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

    @contextmanager
    def _admitted(self, *, tenant_id: str, operation_id: str) -> Generator[None]:
        charge = self._admission.reserve(tenant_id=tenant_id, operation_id=operation_id)
        try:
            yield
        except BaseException:
            charge.refund()
            raise
        else:
            charge.commit()

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


def _assert_ready(operation_id: str) -> None:
    if not is_product_operation_ready(operation_id):
        raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {operation_id}")


def _assert_json_bff_ready(operation_id: str) -> None:
    _assert_ready(operation_id)
    if KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id].transport != "json":
        raise KnowledgeFSOperationUnavailableError(
            f"KnowledgeFS operation requires a direct transport and cannot use the buffered BFF: {operation_id}"
        )


def _assert_binary_bff_ready(operation_id: str) -> None:
    _assert_ready(operation_id)
    if KNOWLEDGE_FS_PRODUCT_OPERATIONS[operation_id].transport != "binary":
        raise KnowledgeFSOperationUnavailableError(
            f"KnowledgeFS operation does not allow the bounded binary BFF: {operation_id}"
        )


__all__ = ["KnowledgeFSDataFacade"]
