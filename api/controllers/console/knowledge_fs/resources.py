"""Typed Console resources for the independent KnowledgeFS product."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import ExitStack
from datetime import UTC
from functools import wraps
from http import HTTPStatus
from typing import Literal
from urllib.parse import quote, urlencode

from flask import Response, jsonify, request, send_file
from flask_restx import Resource
from pydantic import BaseModel, TypeAdapter, ValidationError
from werkzeug.exceptions import Conflict, NotFound, RequestEntityTooLarge, ServiceUnavailable, UnprocessableEntity

from configs import dify_config
from controllers.common.fields import BinaryFileResponse
from controllers.common.schema import (
    query_params_from_model,
    query_params_from_request,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.knowledge_fs.error import (
    KnowledgeFSAccessDeniedHTTPError,
    KnowledgeFSConflictHTTPError,
    KnowledgeFSInvalidRequestHTTPError,
    KnowledgeFSOperationUnavailableHTTPError,
    KnowledgeFSRateLimitHTTPError,
    KnowledgeFSRequestRejectedHTTPError,
    KnowledgeFSRequestTooLargeHTTPError,
    KnowledgeFSResourceNotFoundHTTPError,
    KnowledgeFSSpaceNotFoundHTTPError,
    KnowledgeFSUpstreamUnavailableHTTPError,
)
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    rbac_permission_required,
    setup_required,
)
from core.db.session_factory import session_factory
from libs.helper import dump_response
from libs.login import current_account_with_tenant, login_required
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from repositories.sqlalchemy_knowledge_fs_capability_issuance_auditor import (
    SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor,
)
from services.feature_service import FeatureService
from services.knowledge_fs.app_binding_management import KnowledgeFSAppBindingManagementError
from services.knowledge_fs.control_plane_service import (
    KnowledgeFSControlPlaneInvariantError,
)
from services.knowledge_fs.credential_service import (
    KnowledgeFSCredentialPolicyError,
)
from services.knowledge_fs.download_service import (
    KnowledgeFSDownloadObjectNotFoundError,
    KnowledgeFSDownloadService,
    KnowledgeFSDownloadTooLargeError,
    KnowledgeFSDownloadUnavailableError,
)
from services.knowledge_fs.initial_source_preview import KnowledgeFSInitialSourcePreviewService
from services.knowledge_fs.initial_source_preview_job import (
    KnowledgeFSInitialSourcePreviewJobAlreadyRunningError,
    KnowledgeFSInitialSourcePreviewJobNotFoundError,
    KnowledgeFSInitialSourcePreviewJobService,
)
from services.knowledge_fs.object_storage import (
    KnowledgeFSObjectStorageError,
    KnowledgeFSObjectStorageService,
)
from services.knowledge_fs.product_authorization import (
    KnowledgeFSProductNotFoundError,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSAdmittedQueryRequest,
    KnowledgeFSAnswerTraceResponse,
    KnowledgeFSAppBindingListResponse,
    KnowledgeFSAppBindingPayload,
    KnowledgeFSAppBindingResponse,
    KnowledgeFSAsyncSourceImportPayload,
    KnowledgeFSBackgroundTaskListQuery,
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
    KnowledgeFSCrawlImportPayload,
    KnowledgeFSCrawlPreviewPageListQuery,
    KnowledgeFSCrawlPreviewPageListResponse,
    KnowledgeFSCrawlPreviewSelectionPayload,
    KnowledgeFSCredentialCreatePayload,
    KnowledgeFSCredentialCreateResponse,
    KnowledgeFSCredentialListResponse,
    KnowledgeFSCursorQuery,
    KnowledgeFSDocumentAvailabilityPayload,
    KnowledgeFSDocumentBatchDownloadPayload,
    KnowledgeFSDocumentChunkListQuery,
    KnowledgeFSDocumentChunkListResponse,
    KnowledgeFSDocumentChunkResponse,
    KnowledgeFSDocumentCompilationJobResponse,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSDocumentDownloadDescriptor,
    KnowledgeFSDocumentListResponse,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentMultimodalAssetQuery,
    KnowledgeFSDocumentMultimodalAssetRef,
    KnowledgeFSDocumentMultimodalItem,
    KnowledgeFSDocumentMultimodalItemResponse,
    KnowledgeFSDocumentMultimodalManifest,
    KnowledgeFSDocumentMultimodalManifestResponse,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSDocumentReindexResponse,
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentRevisionListResponse,
    KnowledgeFSDocumentStagedUploadAcceptedResponse,
    KnowledgeFSDocumentStagedUploadPayload,
    KnowledgeFSDocumentUploadAcceptedResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSExternalAccessPayload,
    KnowledgeFSExternalAccessResponse,
    KnowledgeFSGoldenQuestionBulkImportPayload,
    KnowledgeFSGoldenQuestionBulkImportResponse,
    KnowledgeFSGoldenQuestionEvidenceMatchPayload,
    KnowledgeFSGoldenQuestionEvidenceMatchResponse,
    KnowledgeFSGoldenQuestionListResponse,
    KnowledgeFSGoldenQuestionPayload,
    KnowledgeFSGoldenQuestionResponse,
    KnowledgeFSIdempotencyHeader,
    KnowledgeFSInitialSourcePreviewJobCreateResponse,
    KnowledgeFSInitialSourcePreviewJobResponse,
    KnowledgeFSInitialSourcePreviewPayload,
    KnowledgeFSInitialSourcePreviewResponse,
    KnowledgeFSInitialWebsiteSourcePreviewPayload,
    KnowledgeFSJWKSResponse,
    KnowledgeFSLogicalDocumentDeletePayload,
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSMembersReplacePayload,
    KnowledgeFSMetadataFieldCreatePayload,
    KnowledgeFSMetadataFieldDeleteQuery,
    KnowledgeFSMetadataFieldDeleteResponse,
    KnowledgeFSMetadataFieldListQuery,
    KnowledgeFSMetadataFieldListResponse,
    KnowledgeFSMetadataFieldResponse,
    KnowledgeFSMetadataFieldUpdatePayload,
    KnowledgeFSOverviewActivityListQuery,
    KnowledgeFSOverviewActivityListResponse,
    KnowledgeFSOverviewAttentionListQuery,
    KnowledgeFSOverviewAttentionListResponse,
    KnowledgeFSOverviewBaseStatsResponse,
    KnowledgeFSOverviewCountComparisonResponse,
    KnowledgeFSOverviewHealthResponse,
    KnowledgeFSOverviewInventoryResponse,
    KnowledgeFSOverviewQueryOutcomesResponse,
    KnowledgeFSOverviewRateComparisonResponse,
    KnowledgeFSOverviewStatsResponse,
    KnowledgeFSOverviewWindowQuery,
    KnowledgeFSPermissionListResponse,
    KnowledgeFSPresignedUploadResponse,
    KnowledgeFSProfileMigrationResponse,
    KnowledgeFSQualityListQuery,
    KnowledgeFSQualityReplayDetailQuery,
    KnowledgeFSQualityReplayListQuery,
    KnowledgeFSQualityReplayListResponse,
    KnowledgeFSQualityReplayPayload,
    KnowledgeFSQualityReplayResponse,
    KnowledgeFSQueryAdmissionResponse,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSQueryResponse,
    KnowledgeFSQueryStreamCapabilityResponse,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskListResponse,
    KnowledgeFSResearchTaskPartialListResponse,
    KnowledgeFSResearchTaskPartialsQuery,
    KnowledgeFSResearchTaskPlanPayload,
    KnowledgeFSResearchTaskPlanResponse,
    KnowledgeFSResearchTaskResponse,
    KnowledgeFSResearchTaskStreamQuery,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSettingsResponse,
    KnowledgeFSSettingsUpdateResponse,
    KnowledgeFSSmallFileUploadResponse,
    KnowledgeFSSourceConnectionCreatePayload,
    KnowledgeFSSourceConnectionListQuery,
    KnowledgeFSSourceConnectionListResponse,
    KnowledgeFSSourceConnectionRefreshPayload,
    KnowledgeFSSourceConnectionResponse,
    KnowledgeFSSourceCrawlResponse,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceCredentialTestResponse,
    KnowledgeFSSourceDeletePayload,
    KnowledgeFSSourceDeleteQuery,
    KnowledgeFSSourceFilesQuery,
    KnowledgeFSSourceFilesResponse,
    KnowledgeFSSourceImportFilesPayload,
    KnowledgeFSSourceImportPagesPayload,
    KnowledgeFSSourceImportResponse,
    KnowledgeFSSourceListQuery,
    KnowledgeFSSourceListResponse,
    KnowledgeFSSourcePagesQuery,
    KnowledgeFSSourcePagesResponse,
    KnowledgeFSSourceProviderListResponse,
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceSyncPolicyResponse,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceWorkflowCancelPayload,
    KnowledgeFSSourceWorkflowImportPayload,
    KnowledgeFSSourceWorkflowResponse,
    KnowledgeFSSpaceCreatePayload,
    KnowledgeFSSpaceCreateResponse,
    KnowledgeFSSpaceDetailResponse,
    KnowledgeFSSpaceListQuery,
    KnowledgeFSSpaceListResponse,
    KnowledgeFSSpaceTagListResponse,
    KnowledgeFSSpaceTagsReplacePayload,
    KnowledgeFSSpaceUpdatePayload,
    KnowledgeFSStagedUploadResponse,
    KnowledgeFSStreamCapabilityPayload,
    KnowledgeFSStreamCapabilityResponse,
    KnowledgeFSTraceEntriesQuery,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSTraceListResponse,
    KnowledgeFSUploadPartPresignPayload,
    KnowledgeFSUploadSessionAbortPayload,
    KnowledgeFSUploadSessionCompletePayload,
    KnowledgeFSUploadSessionCreatePayload,
    KnowledgeFSUploadSessionCreateResponse,
    KnowledgeFSUploadSessionMutationResponse,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
    KnowledgeFSRemoteMultipartFile,
    KnowledgeFSRemoteSSEResponse,
)
from services.knowledge_fs.query_images import KnowledgeFSQueryImageError, validate_query_image_references
from services.knowledge_fs.runtime import KnowledgeFSRuntime, get_knowledge_fs_runtime
from services.knowledge_fs.source_import_commit_service import (
    commit_source_import,
    retry_or_resume_source_workflow,
)
from services.knowledge_fs.space_tag_service import KnowledgeFSSpaceTagValidationError
from services.knowledge_fs.staged_upload_service import (
    KnowledgeFSStagedUploadConflictError,
    KnowledgeFSStagedUploadInvalidError,
    KnowledgeFSStagedUploadNotFoundError,
    KnowledgeFSStagedUploadService,
    KnowledgeFSStagedUploadTooLargeError,
)
from services.knowledge_fs_capability import (
    KnowledgeFSCapabilityConfigurationError,
    create_configured_knowledge_fs_capability_issuer,
)

register_schema_models(
    console_ns,
    KnowledgeFSAppBindingPayload,
    KnowledgeFSAsyncSourceImportPayload,
    KnowledgeFSBackgroundTaskListQuery,
    KnowledgeFSBadCaseCreatePayload,
    KnowledgeFSBadCaseUpdatePayload,
    KnowledgeFSOverviewWindowQuery,
    KnowledgeFSCredentialCreatePayload,
    KnowledgeFSCursorQuery,
    KnowledgeFSBulkDocumentAvailabilityPayload,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSBulkLogicalDocumentDeletePayload,
    KnowledgeFSDocumentBatchDownloadPayload,
    KnowledgeFSDocumentChunkListQuery,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSDocumentAvailabilityPayload,
    KnowledgeFSDocumentStagedUploadPayload,
    KnowledgeFSLogicalDocumentDeletePayload,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentMultimodalAssetQuery,
    KnowledgeFSMetadataFieldCreatePayload,
    KnowledgeFSMetadataFieldDeleteQuery,
    KnowledgeFSMetadataFieldListQuery,
    KnowledgeFSMetadataFieldUpdatePayload,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSGoldenQuestionBulkImportPayload,
    KnowledgeFSGoldenQuestionEvidenceMatchPayload,
    KnowledgeFSGoldenQuestionPayload,
    KnowledgeFSExternalAccessPayload,
    KnowledgeFSCrawlPreviewPageListQuery,
    KnowledgeFSMembersReplacePayload,
    KnowledgeFSAdmittedQueryRequest,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSQualityListQuery,
    KnowledgeFSQualityReplayDetailQuery,
    KnowledgeFSQualityReplayListQuery,
    KnowledgeFSQualityReplayPayload,
    KnowledgeFSResearchTaskPartialsQuery,
    KnowledgeFSResearchTaskStreamQuery,
    KnowledgeFSResearchTaskPlanPayload,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceConnectionCreatePayload,
    KnowledgeFSSourceConnectionListQuery,
    KnowledgeFSSourceConnectionRefreshPayload,
    KnowledgeFSCrawlImportPayload,
    KnowledgeFSCrawlPreviewSelectionPayload,
    KnowledgeFSInitialSourcePreviewPayload,
    KnowledgeFSInitialWebsiteSourcePreviewPayload,
    KnowledgeFSSourceDeletePayload,
    KnowledgeFSSourceDeleteQuery,
    KnowledgeFSSourceFilesQuery,
    KnowledgeFSSourceImportFilesPayload,
    KnowledgeFSSourceImportPagesPayload,
    KnowledgeFSSourcePagesQuery,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceWorkflowCancelPayload,
    KnowledgeFSSourceWorkflowImportPayload,
    KnowledgeFSSpaceCreatePayload,
    KnowledgeFSSpaceListQuery,
    KnowledgeFSSpaceTagsReplacePayload,
    KnowledgeFSSpaceUpdatePayload,
    KnowledgeFSStreamCapabilityPayload,
    KnowledgeFSTraceEntriesQuery,
    KnowledgeFSUploadPartPresignPayload,
    KnowledgeFSUploadSessionAbortPayload,
    KnowledgeFSUploadSessionCompletePayload,
    KnowledgeFSUploadSessionCreatePayload,
)
register_response_schema_models(
    console_ns,
    BinaryFileResponse,
    KnowledgeFSAnswerTraceResponse,
    KnowledgeFSAppBindingListResponse,
    KnowledgeFSAppBindingResponse,
    KnowledgeFSBackgroundTaskListResponse,
    KnowledgeFSBackgroundTaskResponse,
    KnowledgeFSBadCaseListResponse,
    KnowledgeFSBadCaseResponse,
    KnowledgeFSBadCaseTraceReferenceResponse,
    KnowledgeFSBulkDeletionAcceptedResponse,
    KnowledgeFSBulkDocumentAvailabilityResponse,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSCredentialCreateResponse,
    KnowledgeFSCredentialListResponse,
    KnowledgeFSDocumentListResponse,
    KnowledgeFSDocumentChunkListResponse,
    KnowledgeFSDocumentChunkResponse,
    KnowledgeFSDocumentCompilationJobResponse,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSDocumentMultimodalManifestResponse,
    KnowledgeFSDocumentReindexResponse,
    KnowledgeFSDocumentRevisionListResponse,
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentUploadAcceptedResponse,
    KnowledgeFSDocumentStagedUploadAcceptedResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSGoldenQuestionBulkImportResponse,
    KnowledgeFSGoldenQuestionEvidenceMatchResponse,
    KnowledgeFSGoldenQuestionListResponse,
    KnowledgeFSGoldenQuestionResponse,
    KnowledgeFSExternalAccessResponse,
    KnowledgeFSJWKSResponse,
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSMetadataFieldDeleteResponse,
    KnowledgeFSMetadataFieldListResponse,
    KnowledgeFSMetadataFieldResponse,
    KnowledgeFSPermissionListResponse,
    KnowledgeFSQueryResponse,
    KnowledgeFSQualityReplayListResponse,
    KnowledgeFSQualityReplayResponse,
    KnowledgeFSQueryAdmissionResponse,
    KnowledgeFSQueryStreamCapabilityResponse,
    KnowledgeFSResearchTaskResponse,
    KnowledgeFSResearchTaskPartialListResponse,
    KnowledgeFSResearchTaskPlanResponse,
    KnowledgeFSResearchTaskListResponse,
    KnowledgeFSSettingsResponse,
    KnowledgeFSSettingsUpdateResponse,
    KnowledgeFSProfileMigrationResponse,
    KnowledgeFSSmallFileUploadResponse,
    KnowledgeFSCrawlPreviewPageListResponse,
    KnowledgeFSSourceConnectionListResponse,
    KnowledgeFSSourceConnectionResponse,
    KnowledgeFSSourceListResponse,
    KnowledgeFSSourceCrawlResponse,
    KnowledgeFSSourceCredentialTestResponse,
    KnowledgeFSSourceFilesResponse,
    KnowledgeFSSourceImportResponse,
    KnowledgeFSSourcePagesResponse,
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceProviderListResponse,
    KnowledgeFSSourceSyncPolicyResponse,
    KnowledgeFSSourceWorkflowResponse,
    KnowledgeFSSpaceCreateResponse,
    KnowledgeFSSpaceDetailResponse,
    KnowledgeFSSpaceListResponse,
    KnowledgeFSSpaceTagListResponse,
    KnowledgeFSStreamCapabilityResponse,
    KnowledgeFSStagedUploadResponse,
    KnowledgeFSTraceListResponse,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSOverviewActivityListResponse,
    KnowledgeFSOverviewAttentionListResponse,
    KnowledgeFSOverviewHealthResponse,
    KnowledgeFSOverviewInventoryResponse,
    KnowledgeFSOverviewQueryOutcomesResponse,
    KnowledgeFSOverviewStatsResponse,
    KnowledgeFSPresignedUploadResponse,
    KnowledgeFSInitialSourcePreviewResponse,
    KnowledgeFSInitialSourcePreviewJobCreateResponse,
    KnowledgeFSInitialSourcePreviewJobResponse,
    KnowledgeFSUploadSessionCreateResponse,
    KnowledgeFSUploadSessionMutationResponse,
)


def _console_services() -> KnowledgeFSRuntime:
    if not dify_config.KNOWLEDGE_FS_ENABLED:
        raise NotFound()
    session_maker = session_factory.get_session_maker()
    return get_knowledge_fs_runtime(session_maker)


def _knowledge_fs_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except KnowledgeFSProductNotFoundError as exc:
            raise KnowledgeFSSpaceNotFoundHTTPError() from exc
        except KnowledgeFSOperationUnavailableError as exc:
            raise KnowledgeFSOperationUnavailableHTTPError() from exc
        except KnowledgeFSInitialSourcePreviewJobAlreadyRunningError as exc:
            raise Conflict() from exc
        except KnowledgeFSProductResourceNotFoundError as exc:
            raise KnowledgeFSResourceNotFoundHTTPError(exc.failure) from exc
        except KnowledgeFSStagedUploadNotFoundError as exc:
            raise NotFound() from exc
        except KnowledgeFSStagedUploadConflictError as exc:
            raise Conflict() from exc
        except KnowledgeFSStagedUploadTooLargeError as exc:
            raise RequestEntityTooLarge() from exc
        except KnowledgeFSStagedUploadInvalidError as exc:
            raise UnprocessableEntity() from exc
        except KnowledgeFSProductRemoteError as exc:
            raise KnowledgeFSUpstreamUnavailableHTTPError(exc.failure) from exc
        except KnowledgeFSProductRequestRejectedError as exc:
            if exc.status_code == HTTPStatus.BAD_REQUEST:
                raise KnowledgeFSInvalidRequestHTTPError(exc.failure) from exc
            if exc.status_code == HTTPStatus.CONFLICT:
                raise KnowledgeFSConflictHTTPError(exc.failure) from exc
            if exc.status_code == HTTPStatus.FORBIDDEN:
                raise KnowledgeFSAccessDeniedHTTPError(exc.failure) from exc
            if exc.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE:
                raise KnowledgeFSRequestTooLargeHTTPError(exc.failure) from exc
            if exc.status_code == HTTPStatus.TOO_MANY_REQUESTS:
                raise KnowledgeFSRateLimitHTTPError(exc.failure) from exc
            raise KnowledgeFSRequestRejectedHTTPError(exc.failure) from exc
        except KnowledgeFSQueryImageError as exc:
            if exc.code == "QUERY_IMAGE_NOT_FOUND":
                raise NotFound() from exc
            if exc.code in {"QUERY_IMAGE_COUNT_EXCEEDED", "QUERY_IMAGE_TOO_LARGE", "QUERY_IMAGE_TOTAL_TOO_LARGE"}:
                raise RequestEntityTooLarge() from exc
            raise KnowledgeFSInvalidRequestHTTPError() from exc
        except (
            KnowledgeFSAppBindingManagementError,
            KnowledgeFSCredentialPolicyError,
            KnowledgeFSControlPlaneInvariantError,
            ValidationError,
        ) as exc:
            raise KnowledgeFSInvalidRequestHTTPError() from exc
        except PermissionError as exc:
            raise KnowledgeFSAccessDeniedHTTPError() from exc
        except KnowledgeFSCapabilityConfigurationError as exc:
            raise KnowledgeFSOperationUnavailableHTTPError() from exc

    return decorated


_SMALL_FILE_UPLOAD_PARAMS = {
    "file": {
        "description": "Strictly bounded small-file fallback payload",
        "in": "formData",
        "type": "file",
        "required": True,
    }
}
_DOCUMENT_UPLOAD_PARAMS = {
    "file": {
        "description": "Document file to parse, chunk, and index (maximum 15 MB)",
        "in": "formData",
        "type": "file",
        "required": True,
    }
}
_STAGED_UPLOAD_PARAMS = {
    "file": {
        "description": "Workspace-scoped document bytes staged before KnowledgeFS admission",
        "in": "formData",
        "type": "file",
        "required": True,
    }
}
_IDEMPOTENCY_HEADER_PARAMS = {
    "Idempotency-Key": {
        "description": "Stable key used to make the mutation safe to retry",
        "in": "header",
        "maxLength": 255,
        "minLength": 8,
        "required": True,
        "type": "string",
    }
}
_SMALL_FILE_MULTIPART_OVERHEAD_MAX_BYTES = 64 * 1024
_MAX_STREAM_CAPABILITY_BYTES = 16 * 1024
_MAX_STREAM_TRACE_ID_BYTES = 255
_QUERY_STREAM_PROXY_PATH = "/knowledge-fs/query-stream"
_DOCUMENT_MULTIMODAL_ASSET_MAX_BYTES = 25 * 1024 * 1024
_INLINE_MULTIMODAL_CONTENT_TYPES = frozenset({"image/gif", "image/jpeg", "image/png", "image/webp"})
_BACKGROUND_TASK_KIND_ADAPTER: TypeAdapter[Literal["document", "document_bulk", "source"]] = TypeAdapter(
    Literal["document", "document_bulk", "source"]
)


def _multimodal_asset_ref(
    item: KnowledgeFSDocumentMultimodalItem, variant: str | None = None
) -> KnowledgeFSDocumentMultimodalAssetRef | None:
    asset_ref = item.asset_ref
    if asset_ref is None or variant is None:
        return asset_ref
    selected = asset_ref.variants.get(variant)
    if selected is None:
        return None
    return KnowledgeFSDocumentMultimodalAssetRef(
        content_type=selected.content_type,
        object_key=selected.object_key,
        sha256=selected.sha256,
    )


def _multimodal_asset_url(*, control_space_id: str, document_id: str, item_id: str, variant: str | None = None) -> str:
    path = (
        f"/knowledge-fs/spaces/{quote(control_space_id, safe='')}/documents/"
        f"{quote(document_id, safe='')}/multimodal/{quote(item_id, safe='')}/asset"
    )
    if variant is not None:
        path = f"{path}?{urlencode({'variant': variant})}"
    return _console_api_url(path)


def _public_multimodal_manifest(
    *,
    control_space_id: str,
    document_id: str,
    manifest: KnowledgeFSDocumentMultimodalManifest,
) -> KnowledgeFSDocumentMultimodalManifestResponse:
    if manifest.document_asset_id != document_id:
        raise NotFound("KnowledgeFS document multimodal manifest not found")

    items: list[KnowledgeFSDocumentMultimodalItemResponse] = []
    for item in manifest.items:
        asset_ref = _multimodal_asset_ref(item)
        thumbnail_ref = _multimodal_asset_ref(item, "thumbnail")
        items.append(
            KnowledgeFSDocumentMultimodalItemResponse(
                asset_url=(
                    _multimodal_asset_url(
                        control_space_id=control_space_id,
                        document_id=document_id,
                        item_id=item.id,
                    )
                    if asset_ref and asset_ref.object_key
                    else None
                ),
                caption=item.caption,
                end_offset=item.end_offset,
                id=item.id,
                modality=item.modality,
                ocr_text=item.ocr_text,
                page_number=item.page_number,
                section_path=item.section_path,
                start_offset=item.start_offset,
                text_preview=item.text_preview,
                thumbnail_url=(
                    _multimodal_asset_url(
                        control_space_id=control_space_id,
                        document_id=document_id,
                        item_id=item.id,
                        variant="thumbnail",
                    )
                    if thumbnail_ref and thumbnail_ref.object_key
                    else None
                ),
                title=item.title,
            )
        )

    return KnowledgeFSDocumentMultimodalManifestResponse(
        artifact_hash=manifest.artifact_hash,
        created_at=manifest.created_at,
        document_asset_id=manifest.document_asset_id,
        id=manifest.id,
        items=items,
        manifest_version=manifest.manifest_version,
        updated_at=manifest.updated_at,
        version=manifest.version,
    )


def _multimodal_object_key_is_scoped(
    *, document_id: str, knowledge_space_id: str, object_key: str, tenant_id: str
) -> bool:
    return object_key.startswith(f"{tenant_id}/spaces/{knowledge_space_id}/documents/{document_id}/assets/")


def _read_small_file_body(max_bytes: int) -> bytes:
    content_length = request.content_length
    if content_length is not None and content_length > max_bytes + _SMALL_FILE_MULTIPART_OVERHEAD_MAX_BYTES:
        raise KnowledgeFSProductRequestRejectedError(status_code=413)
    uploads = request.files.getlist("file")
    if set(request.files) != {"file"} or len(uploads) != 1 or request.form:
        raise KnowledgeFSProductRequestRejectedError(status_code=422)
    upload = uploads[0]
    if not upload.filename:
        raise KnowledgeFSProductRequestRejectedError(status_code=422)
    body = upload.stream.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise KnowledgeFSProductRequestRejectedError(status_code=413)
    if not body:
        raise KnowledgeFSProductRequestRejectedError(status_code=422)
    return body


def _stream_capability() -> tuple[str, str]:
    scheme, separator, credential = request.headers.get("Authorization", "").partition(" ")
    token = credential.strip()
    trace_id = request.headers.get("X-Trace-ID", "").strip()
    if (
        separator != " "
        or scheme.lower() != "bearer"
        or not token
        or len(token.encode("utf-8")) > _MAX_STREAM_CAPABILITY_BYTES
        or any(character.isspace() for character in token)
    ):
        raise PermissionError("KnowledgeFS stream capability is invalid")
    if (
        not trace_id
        or len(trace_id.encode("utf-8")) > _MAX_STREAM_TRACE_ID_BYTES
        or any(character in trace_id for character in ("\0", "\r", "\n"))
    ):
        raise KnowledgeFSProductRequestRejectedError(status_code=422)
    return token, trace_id


def _stream_response(upstream: KnowledgeFSRemoteSSEResponse) -> Response:
    headers = dict(upstream.headers)
    if HTTPStatus.OK <= upstream.status_code < HTTPStatus.MULTIPLE_CHOICES:
        headers.setdefault("cache-control", "no-cache")
        headers.setdefault("content-type", "text/event-stream")
        headers.setdefault("x-accel-buffering", "no")

    def generate():
        try:
            yield from upstream.chunks
        finally:
            upstream.close()

    return Response(
        generate(),
        status=upstream.status_code,
        headers=headers,
        direct_passthrough=True,
    )


def _console_api_url(path: str) -> str:
    base_url = str(dify_config.CONSOLE_API_URL or "").strip().rstrip("/")
    if not base_url:
        return f"/console/api{path}"
    if base_url.endswith("/console/api"):
        return f"{base_url}{path}"
    return f"{base_url}/console/api{path}"


def _read_document_upload(max_bytes: int) -> KnowledgeFSRemoteMultipartFile:
    content_length = request.content_length
    if content_length is not None and content_length > max_bytes + _SMALL_FILE_MULTIPART_OVERHEAD_MAX_BYTES:
        raise KnowledgeFSProductRequestRejectedError(status_code=413)
    uploads = request.files.getlist("file")
    if set(request.files) != {"file"} or len(uploads) != 1 or request.form:
        raise KnowledgeFSProductRequestRejectedError(status_code=422)
    upload = uploads[0]
    if not upload.filename:
        raise KnowledgeFSProductRequestRejectedError(status_code=422)
    body = upload.stream.read(max_bytes + 1)
    if len(body) > max_bytes:
        raise KnowledgeFSProductRequestRejectedError(status_code=413)
    if not body:
        raise KnowledgeFSProductRequestRejectedError(status_code=422)
    return KnowledgeFSRemoteMultipartFile(
        filename=upload.filename,
        content_type=upload.mimetype or "application/octet-stream",
        body=body,
    )


def _read_staged_upload(max_bytes: int) -> KnowledgeFSRemoteMultipartFile:
    return _read_document_upload(max_bytes)


def _actor() -> tuple[str, str]:
    account, tenant_id = current_account_with_tenant()
    return account.id, tenant_id


def _staged_uploads() -> KnowledgeFSStagedUploadService:
    session_maker = session_factory.get_session_maker()
    return KnowledgeFSStagedUploadService(session_maker, facade=_console_services().facade)


def _payload[PayloadT: BaseModel](model: type[PayloadT]) -> PayloadT:
    return model.model_validate(console_ns.payload or {})


def _idempotency_key() -> str:
    return KnowledgeFSIdempotencyHeader.model_validate(
        {"idempotency-key": request.headers.get("Idempotency-Key")}
    ).idempotency_key


def _query_pairs(model: BaseModel) -> tuple[tuple[str, str], ...]:
    values = model.model_dump(mode="json", by_alias=True, exclude_none=True)
    return tuple(
        (name, str(value).lower() if isinstance(value, bool) else str(value)) for name, value in values.items()
    )


def _overview_stats_response(
    *,
    stats: KnowledgeFSOverviewBaseStatsResponse,
    outcomes: KnowledgeFSOverviewQueryOutcomesResponse,
    linked_apps: int,
) -> KnowledgeFSOverviewStatsResponse:
    current_queries = outcomes.current.query_count
    previous_queries = outcomes.previous.query_count
    query_change = None if previous_queries == 0 else (current_queries - previous_queries) / previous_queries
    latest_sync = stats.current.latest_source_sync_at
    freshness_seconds = (
        None if latest_sync is None else max(0, int((outcomes.generated_at - latest_sync).total_seconds()))
    )
    return KnowledgeFSOverviewStatsResponse(
        answer_rate=KnowledgeFSOverviewRateComparisonResponse(
            change_percentage_points=(outcomes.current.answer_rate - outcomes.previous.answer_rate) * 100,
            previous_value=outcomes.previous.answer_rate,
            value=outcomes.current.answer_rate,
        ),
        documents=stats.current.knowledge_count,
        fresh_source_count=stats.current.fresh_source_count,
        freshness_seconds=freshness_seconds,
        generated_at=outcomes.generated_at,
        knowledge_space_id=stats.knowledge_space_id,
        latest_source_sync_at=latest_sync,
        linked_apps=linked_apps,
        queries=KnowledgeFSOverviewCountComparisonResponse(
            change_rate=query_change,
            previous_value=previous_queries,
            value=current_queries,
        ),
        source_count=stats.current.source_count,
        stale_source_count=stats.current.stale_source_count,
        window=outcomes.window,
    )


@console_ns.route("/knowledge-fs/source-provider-preview")
class KnowledgeFSInitialSourcePreviewApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSInitialSourcePreviewPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Datasource resources available for an initial Source",
        console_ns.models[KnowledgeFSInitialSourcePreviewResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self):
        account, tenant_id = current_account_with_tenant()
        result = KnowledgeFSInitialSourcePreviewService(session_factory.get_session_maker()).preview(
            tenant_id=tenant_id,
            account=account,
            payload=_payload(KnowledgeFSInitialSourcePreviewPayload),
        )
        return dump_response(KnowledgeFSInitialSourcePreviewResponse, result)


@console_ns.route("/knowledge-fs/source-provider-preview/jobs")
class KnowledgeFSInitialSourcePreviewJobsApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSInitialWebsiteSourcePreviewPayload.__name__])
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "Website datasource preview queued",
        console_ns.models[KnowledgeFSInitialSourcePreviewJobCreateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self):
        account, tenant_id = current_account_with_tenant()
        result = KnowledgeFSInitialSourcePreviewJobService(session_factory.get_session_maker()).start(
            tenant_id=tenant_id,
            account=account,
            payload=_payload(KnowledgeFSInitialWebsiteSourcePreviewPayload),
        )
        return dump_response(KnowledgeFSInitialSourcePreviewJobCreateResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/source-provider-preview/jobs/<string:job_id>")
class KnowledgeFSInitialSourcePreviewJobApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "Website datasource preview status",
        console_ns.models[KnowledgeFSInitialSourcePreviewJobResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, job_id: str):
        account, tenant_id = current_account_with_tenant()
        try:
            result = KnowledgeFSInitialSourcePreviewJobService.get(
                tenant_id=tenant_id,
                account_id=account.id,
                job_id=job_id,
            )
        except KnowledgeFSInitialSourcePreviewJobNotFoundError as exc:
            raise NotFound() from exc
        return dump_response(KnowledgeFSInitialSourcePreviewJobResponse, result)

    @console_ns.response(
        HTTPStatus.OK,
        "Website datasource preview canceled",
        console_ns.models[KnowledgeFSInitialSourcePreviewJobResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, job_id: str):
        account, tenant_id = current_account_with_tenant()
        try:
            result = KnowledgeFSInitialSourcePreviewJobService.cancel(
                tenant_id=tenant_id,
                account_id=account.id,
                job_id=job_id,
            )
        except KnowledgeFSInitialSourcePreviewJobNotFoundError as exc:
            raise NotFound() from exc
        return dump_response(KnowledgeFSInitialSourcePreviewJobResponse, result)


@console_ns.route("/knowledge-fs/uploads")
class KnowledgeFSStagedUploadsApi(Resource):
    @console_ns.doc(consumes=["multipart/form-data"], params=_STAGED_UPLOAD_PARAMS)
    @console_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS document bytes staged in the current workspace",
        console_ns.models[KnowledgeFSStagedUploadResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @_knowledge_fs_errors
    def post(self):
        account, tenant_id = current_account_with_tenant()
        file_size_limit_mb = FeatureService.get_knowledge_file_size_limit(tenant_id)
        upload = _read_staged_upload(file_size_limit_mb * 1024 * 1024)
        result = _staged_uploads().stage(
            tenant_id=tenant_id,
            account=account,
            file_name=upload.filename,
            content_type=upload.content_type,
            body=upload.body,
            file_size_limit_mb=file_size_limit_mb,
        )
        return dump_response(KnowledgeFSStagedUploadResponse, result), HTTPStatus.CREATED


@console_ns.route("/knowledge-fs/uploads/<string:upload_id>")
class KnowledgeFSStagedUploadApi(Resource):
    @console_ns.response(HTTPStatus.NO_CONTENT, "KnowledgeFS staged upload discarded")
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, upload_id: str):
        actor_id, tenant_id = _actor()
        _staged_uploads().abort(tenant_id=tenant_id, account_id=actor_id, upload_id=upload_id)
        return "", HTTPStatus.NO_CONTENT


@console_ns.route("/knowledge-fs/spaces")
class KnowledgeFSSpacesApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSSpaceListQuery))
    @console_ns.response(HTTPStatus.OK, "KnowledgeFS spaces", console_ns.models[KnowledgeFSSpaceListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self):
        actor_id, tenant_id = _actor()
        query = query_params_from_request(KnowledgeFSSpaceListQuery, list_fields=("creator_ids", "tag_ids"))
        result = _console_services().application.list_spaces(
            tenant_id=tenant_id,
            account_id=actor_id,
            page=query.page,
            limit=query.limit,
            creator_ids=query.creator_ids,
            tag_ids=query.tag_ids,
            query=query.query,
        )
        return dump_response(KnowledgeFSSpaceListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSSpaceCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS provisioning accepted",
        console_ns.models[KnowledgeFSSpaceCreateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self):
        actor_id, tenant_id = _actor()
        result = _console_services().application.create_space(
            tenant_id=tenant_id,
            account_id=actor_id,
            payload=_payload(KnowledgeFSSpaceCreatePayload),
        )
        return dump_response(KnowledgeFSSpaceCreateResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/tags")
class KnowledgeFSSpaceTagsApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS space tags",
        console_ns.models[KnowledgeFSSpaceTagListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        tags = _console_services().space_tags.list_tags(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSSpaceTagListResponse, {"data": tags})

    @console_ns.expect(console_ns.models[KnowledgeFSSpaceTagsReplacePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS space tags replaced",
        console_ns.models[KnowledgeFSSpaceTagListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def put(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSSpaceTagsReplacePayload)
        try:
            tags = _console_services().space_tags.replace_tags(
                tenant_id=tenant_id,
                account_id=actor_id,
                control_space_id=control_space_id,
                tag_ids=payload.tag_ids,
            )
        except KnowledgeFSSpaceTagValidationError as exc:
            raise UnprocessableEntity(str(exc)) from exc
        return dump_response(KnowledgeFSSpaceTagListResponse, {"data": tags})


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>")
class KnowledgeFSSpaceApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS space",
        console_ns.models[KnowledgeFSSpaceDetailResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().application.get_space(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSSpaceDetailResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSSpaceUpdatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS space updated",
        console_ns.models[KnowledgeFSSpaceDetailResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().application.update_space(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSSpaceUpdatePayload),
        )
        return dump_response(KnowledgeFSSpaceDetailResponse, result)

    @console_ns.response(HTTPStatus.NO_CONTENT, "KnowledgeFS deletion accepted")
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        _console_services().application.delete_space(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
        )
        return "", HTTPStatus.NO_CONTENT


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/permissions")
class KnowledgeFSSpacePermissionsApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS space permissions",
        console_ns.models[KnowledgeFSPermissionListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().control_plane.list_permissions(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSPermissionListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/members")
class KnowledgeFSSpaceMembersApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSMembersReplacePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS space members replaced",
        console_ns.models[KnowledgeFSPermissionListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def put(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSMembersReplacePayload)
        result = _console_services().control_plane.replace_members(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
            members=payload.members,
        )
        return dump_response(KnowledgeFSPermissionListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/external-access")
class KnowledgeFSSpaceExternalAccessApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS external access",
        console_ns.models[KnowledgeFSExternalAccessResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().control_plane.get_external_access(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSExternalAccessResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSExternalAccessPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS external access updated",
        console_ns.models[KnowledgeFSExternalAccessResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def put(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().control_plane.update_external_access(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSExternalAccessPayload),
        )
        return dump_response(KnowledgeFSExternalAccessResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/app-bindings")
class KnowledgeFSSpaceAppBindingsApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS app bindings",
        console_ns.models[KnowledgeFSAppBindingListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().app_bindings.list(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSAppBindingListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSAppBindingPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS app binding enabled",
        console_ns.models[KnowledgeFSAppBindingResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def put(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().app_bindings.upsert(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSAppBindingPayload),
        )
        return dump_response(KnowledgeFSAppBindingResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/app-bindings/<string:caller_kind>/<string:app_id>")
class KnowledgeFSSpaceAppBindingApi(Resource):
    @console_ns.response(HTTPStatus.NO_CONTENT, "KnowledgeFS app binding revoked")
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str, caller_kind: str, app_id: str):
        actor_id, tenant_id = _actor()
        try:
            parsed_caller_kind = KnowledgeFSAppSpaceJoinType(caller_kind)
        except ValueError as exc:
            raise KnowledgeFSAppBindingManagementError("KnowledgeFS app caller kind is invalid") from exc
        _console_services().app_bindings.revoke(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
            app_id=app_id,
            caller_kind=parsed_caller_kind,
        )
        return "", HTTPStatus.NO_CONTENT


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/credentials")
class KnowledgeFSSpaceCredentialsApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS credentials",
        console_ns.models[KnowledgeFSCredentialListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().credentials.list(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSCredentialListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSCredentialCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS credential created",
        console_ns.models[KnowledgeFSCredentialCreateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().credentials.create(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSCredentialCreatePayload),
        )
        return dump_response(KnowledgeFSCredentialCreateResponse, result), HTTPStatus.CREATED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/credentials/<string:credential_id>")
class KnowledgeFSSpaceCredentialApi(Resource):
    @console_ns.response(HTTPStatus.NO_CONTENT, "KnowledgeFS credential revoked")
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str, credential_id: str):
        actor_id, tenant_id = _actor()
        _console_services().credentials.revoke(
            tenant_id=tenant_id,
            actor_account_id=actor_id,
            control_space_id=control_space_id,
            credential_id=credential_id,
        )
        return "", HTTPStatus.NO_CONTENT


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/settings")
class KnowledgeFSSpaceSettingsApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS settings",
        console_ns.models[KnowledgeFSSettingsResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_settings(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSSettingsResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSSettingsPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS settings updated",
        console_ns.models[KnowledgeFSSettingsUpdateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.update_settings(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSSettingsPayload),
        )
        return dump_response(KnowledgeFSSettingsUpdateResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/settings/migrations/<string:migration_id>")
class KnowledgeFSSpaceSettingsMigrationApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS settings migration",
        console_ns.models[KnowledgeFSProfileMigrationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, migration_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_profile_migration(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            migration_id=migration_id,
        )
        return dump_response(KnowledgeFSProfileMigrationResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/overview/stats")
class KnowledgeFSSpaceOverviewStatsApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSOverviewWindowQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS Overview statistics",
        console_ns.models[KnowledgeFSOverviewStatsResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSOverviewWindowQuery.model_validate(request.args.to_dict())
        services = _console_services()
        stats = services.facade.get_overview_stats(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
        )
        outcomes = services.facade.get_overview_query_outcomes(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            window=query.window,
        )
        result = _overview_stats_response(
            stats=stats,
            outcomes=outcomes,
            linked_apps=services.app_bindings.count_active(
                tenant_id=tenant_id,
                actor_account_id=actor_id,
                control_space_id=control_space_id,
            ),
        )
        return dump_response(KnowledgeFSOverviewStatsResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/overview/query-outcomes")
class KnowledgeFSSpaceOverviewQueryOutcomesApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSOverviewWindowQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS query outcomes",
        console_ns.models[KnowledgeFSOverviewQueryOutcomesResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSOverviewWindowQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.get_overview_query_outcomes(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            window=query.window,
        )
        return dump_response(KnowledgeFSOverviewQueryOutcomesResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/overview/inventory")
class KnowledgeFSSpaceOverviewInventoryApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS inventory",
        console_ns.models[KnowledgeFSOverviewInventoryResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_overview_inventory(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSOverviewInventoryResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/overview/attention")
class KnowledgeFSSpaceOverviewAttentionApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSOverviewAttentionListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS attention findings",
        console_ns.models[KnowledgeFSOverviewAttentionListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSOverviewAttentionListQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_overview_attention(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            include_dismissed=query.include_dismissed,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSOverviewAttentionListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/overview/activity")
class KnowledgeFSSpaceOverviewActivityApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSOverviewActivityListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS activity",
        console_ns.models[KnowledgeFSOverviewActivityListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSOverviewActivityListQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_overview_activity(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            action=query.action,
            actor_id=query.actor_id,
            actor_type=query.actor_type,
            cursor=query.cursor,
            from_at=query.from_at.astimezone(UTC).isoformat().replace("+00:00", "Z") if query.from_at else None,
            limit=query.limit,
            resource_type=query.resource_type,
            result=query.result,
            to_at=query.to_at.astimezone(UTC).isoformat().replace("+00:00", "Z") if query.to_at else None,
        )
        return dump_response(KnowledgeFSOverviewActivityListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/overview/health")
class KnowledgeFSSpaceOverviewHealthApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS health",
        console_ns.models[KnowledgeFSOverviewHealthResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_overview_health(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSOverviewHealthResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/logical-documents")
class KnowledgeFSSpaceLogicalDocumentsApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS logical documents",
        console_ns.models[KnowledgeFSLogicalDocumentListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_logical_documents(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
        )
        return dump_response(KnowledgeFSLogicalDocumentListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSBulkDocumentAvailabilityPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS logical document availability updated",
        console_ns.models[KnowledgeFSBulkDocumentAvailabilityResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.bulk_update_logical_document_availability(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSBulkDocumentAvailabilityPayload),
        )
        return dump_response(KnowledgeFSBulkDocumentAvailabilityResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/logical-documents/bulk")
class KnowledgeFSSpaceBulkLogicalDocumentsApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSBulkLogicalDocumentDeletePayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS logical document deletions accepted",
        console_ns.models[KnowledgeFSBulkDeletionAcceptedResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.bulk_delete_logical_documents(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSBulkLogicalDocumentDeletePayload),
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSBulkDeletionAcceptedResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/logical-documents/download-zip")
class KnowledgeFSSpaceLogicalDocumentsDownloadApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSDocumentBatchDownloadPayload.__name__])
    @console_ns.produces(["application/zip"])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS logical documents ZIP",
        console_ns.models[BinaryFileResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(
        RBACResourceScope.DATASET,
        RBACPermission.DATASET_DOCUMENT_DOWNLOAD,
        resource_required=False,
    )
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSDocumentBatchDownloadPayload)
        descriptors = [
            _console_services().facade.prepare_logical_document_download(
                tenant_id=tenant_id,
                account_id=actor_id,
                control_space_id=control_space_id,
                document_id=document_id,
            )
            for document_id in payload.document_ids
        ]
        service = KnowledgeFSDownloadService()
        try:
            with ExitStack() as stack:
                zip_path = stack.enter_context(service.build_zip_tempfile(descriptors))
                response = send_file(
                    zip_path,
                    mimetype="application/zip",
                    as_attachment=True,
                    download_name="knowledge-documents.zip",
                )
                cleanup = stack.pop_all()
                response.call_on_close(cleanup.close)
                return response
        except KnowledgeFSDownloadTooLargeError as exc:
            raise RequestEntityTooLarge(str(exc)) from exc
        except KnowledgeFSDownloadObjectNotFoundError as exc:
            raise NotFound("KnowledgeFS document object not found") from exc
        except KnowledgeFSDownloadUnavailableError as exc:
            raise ServiceUnavailable("KnowledgeFS object storage is unavailable") from exc


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>/download")
class KnowledgeFSSpaceLogicalDocumentDownloadApi(Resource):
    @console_ns.produces(["application/octet-stream"])
    @console_ns.response(HTTPStatus.OK, "KnowledgeFS logical document", console_ns.models[BinaryFileResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @rbac_permission_required(
        RBACResourceScope.DATASET,
        RBACPermission.DATASET_DOCUMENT_DOWNLOAD,
        resource_required=False,
    )
    @_knowledge_fs_errors
    def get(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        descriptor = _console_services().facade.prepare_logical_document_download(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
        )
        try:
            body = KnowledgeFSDownloadService().load_stream(descriptor)
        except KnowledgeFSDownloadObjectNotFoundError as exc:
            raise NotFound("KnowledgeFS document object not found") from exc
        except KnowledgeFSDownloadUnavailableError as exc:
            raise ServiceUnavailable("KnowledgeFS object storage is unavailable") from exc
        response = Response(body, content_type=descriptor.mime_type or "application/octet-stream")
        response.content_length = descriptor.size_bytes
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(descriptor.filename, safe='')}"
        response.headers["ETag"] = f'"{descriptor.sha256}"'
        return response


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>")
class KnowledgeFSSpaceLogicalDocumentApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS logical document",
        console_ns.models[KnowledgeFSLogicalDocumentResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_logical_document(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
        )
        return dump_response(KnowledgeFSLogicalDocumentResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSDocumentAvailabilityPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS logical document availability updated",
        console_ns.models[KnowledgeFSLogicalDocumentResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.update_logical_document_availability(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
            payload=_payload(KnowledgeFSDocumentAvailabilityPayload),
        )
        return dump_response(KnowledgeFSLogicalDocumentResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSLogicalDocumentDeletePayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS logical document deletion accepted",
        console_ns.models[KnowledgeFSDurableDeletionAcceptedResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.delete_logical_document(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
            payload=_payload(KnowledgeFSLogicalDocumentDeletePayload),
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSDurableDeletionAcceptedResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents")
class KnowledgeFSSpaceDocumentsApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS documents",
        console_ns.models[KnowledgeFSDocumentListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_documents(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
        )
        return dump_response(KnowledgeFSDocumentListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSDocumentStagedUploadPayload.__name__])
    @console_ns.doc(
        description=(
            "Claim a workspace-staged upload. Multipart file bodies remain accepted as a legacy compatibility path."
        )
    )
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS document accepted for processing",
        console_ns.models[KnowledgeFSDocumentStagedUploadAcceptedResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        if request.is_json:
            result = _staged_uploads().claim(
                tenant_id=tenant_id,
                account_id=actor_id,
                control_space_id=control_space_id,
                payload=_payload(KnowledgeFSDocumentStagedUploadPayload),
            )
            return (
                dump_response(KnowledgeFSDocumentStagedUploadAcceptedResponse, result),
                HTTPStatus.ACCEPTED,
            )
        legacy_result = _console_services().facade.create_document(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            body_reader=_read_document_upload,
        )
        return dump_response(KnowledgeFSDocumentUploadAcceptedResponse, legacy_result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/metadata")
class KnowledgeFSSpaceMetadataApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSMetadataFieldListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS metadata fields",
        console_ns.models[KnowledgeFSMetadataFieldListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = query_params_from_request(KnowledgeFSMetadataFieldListQuery)
        result = _console_services().facade.list_metadata_fields(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSMetadataFieldListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSMetadataFieldCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS metadata field created",
        console_ns.models[KnowledgeFSMetadataFieldResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.create_metadata_field(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSMetadataFieldCreatePayload),
        )
        return dump_response(KnowledgeFSMetadataFieldResponse, result), HTTPStatus.CREATED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/metadata/<string:field_id>")
class KnowledgeFSSpaceMetadataFieldApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSMetadataFieldUpdatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS metadata field updated",
        console_ns.models[KnowledgeFSMetadataFieldResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str, field_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.update_metadata_field(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            field_id=field_id,
            payload=_payload(KnowledgeFSMetadataFieldUpdatePayload),
        )
        return dump_response(KnowledgeFSMetadataFieldResponse, result)

    @console_ns.doc(params=query_params_from_model(KnowledgeFSMetadataFieldDeleteQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS metadata field deleted",
        console_ns.models[KnowledgeFSMetadataFieldDeleteResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str, field_id: str):
        actor_id, tenant_id = _actor()
        query = query_params_from_request(KnowledgeFSMetadataFieldDeleteQuery)
        result = _console_services().facade.delete_metadata_field(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            field_id=field_id,
            expected_row_version=query.expected_row_version,
        )
        return dump_response(KnowledgeFSMetadataFieldDeleteResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/bulk")
class KnowledgeFSSpaceBulkDocumentsApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSBulkDocumentDeletePayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS document deletions accepted",
        console_ns.models[KnowledgeFSBulkDeletionAcceptedResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.bulk_delete_documents(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSBulkDocumentDeletePayload),
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSBulkDeletionAcceptedResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/reindex")
class KnowledgeFSSpaceDocumentReindexApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSDocumentReindexPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document reindex queued",
        console_ns.models[KnowledgeFSDocumentReindexResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.reindex_documents(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSDocumentReindexPayload),
        )
        return dump_response(KnowledgeFSDocumentReindexResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>")
class KnowledgeFSSpaceDocumentApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document",
        console_ns.models[KnowledgeFSDocumentResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_document(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
        )
        return dump_response(KnowledgeFSDocumentResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSDocumentMetadataPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document metadata updated",
        console_ns.models[KnowledgeFSLogicalDocumentResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.update_document_metadata(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
            payload=_payload(KnowledgeFSDocumentMetadataPayload),
        )
        return dump_response(KnowledgeFSLogicalDocumentResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSDocumentDeletePayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS document deletion accepted",
        console_ns.models[KnowledgeFSDurableDeletionAcceptedResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.delete_document(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
            payload=_payload(KnowledgeFSDocumentDeletePayload),
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSDurableDeletionAcceptedResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/outline")
class KnowledgeFSSpaceDocumentOutlineApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document outline",
        console_ns.models[KnowledgeFSDocumentOutlineResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_document_outline(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
        )
        return dump_response(KnowledgeFSDocumentOutlineResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/multimodal")
class KnowledgeFSSpaceDocumentMultimodalManifestApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document multimodal manifest",
        console_ns.models[KnowledgeFSDocumentMultimodalManifestResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        manifest = _console_services().facade.get_document_multimodal_manifest(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
        )
        return dump_response(
            KnowledgeFSDocumentMultimodalManifestResponse,
            _public_multimodal_manifest(
                control_space_id=control_space_id,
                document_id=document_id,
                manifest=manifest,
            ),
        )


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/multimodal/<path:item_id>/asset"
)
class KnowledgeFSSpaceDocumentMultimodalAssetApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSDocumentMultimodalAssetQuery))
    @console_ns.produces(["application/octet-stream", "image/gif", "image/jpeg", "image/png", "image/webp"])
    @console_ns.response(
        HTTPStatus.OK, "KnowledgeFS document multimodal asset", console_ns.models[BinaryFileResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, document_id: str, item_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSDocumentMultimodalAssetQuery.model_validate(request.args.to_dict(flat=True))
        manifest = _console_services().facade.get_document_multimodal_manifest(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
        )
        if manifest.document_asset_id != document_id:
            raise NotFound("KnowledgeFS document multimodal asset not found")
        item = next((candidate for candidate in manifest.items if candidate.id == item_id), None)
        asset_ref = _multimodal_asset_ref(item, query.variant) if item else None
        if asset_ref is None or not asset_ref.object_key:
            raise NotFound("KnowledgeFS document multimodal asset not found")
        object_key = asset_ref.object_key
        if not _multimodal_object_key_is_scoped(
            document_id=document_id,
            knowledge_space_id=manifest.knowledge_space_id,
            object_key=object_key,
            tenant_id=tenant_id,
        ):
            raise NotFound("KnowledgeFS document multimodal asset not found")

        object_storage = KnowledgeFSObjectStorageService()
        try:
            metadata = object_storage.head_object(key=object_key)
        except KnowledgeFSObjectStorageError as exc:
            raise ServiceUnavailable("KnowledgeFS object storage is unavailable") from exc
        if metadata is None:
            raise NotFound("KnowledgeFS document multimodal asset not found")
        if metadata.size_bytes > _DOCUMENT_MULTIMODAL_ASSET_MAX_BYTES:
            raise RequestEntityTooLarge("KnowledgeFS document multimodal asset is too large")

        content_type = (asset_ref.content_type or metadata.content_type or "").strip().lower()
        inline = content_type in _INLINE_MULTIMODAL_CONTENT_TYPES
        descriptor = KnowledgeFSDocumentDownloadDescriptor(
            document_id=item_id,
            filename=f"multimodal-{item_id}",
            mime_type=content_type or "application/octet-stream",
            object_key=object_key,
            sha256=asset_ref.sha256 or metadata.checksum_sha256_base64,
            size_bytes=metadata.size_bytes,
        )
        try:
            body = KnowledgeFSDownloadService(object_storage=object_storage).load_stream(descriptor)
        except KnowledgeFSDownloadObjectNotFoundError as exc:
            raise NotFound("KnowledgeFS document multimodal asset not found") from exc
        except KnowledgeFSDownloadUnavailableError as exc:
            raise ServiceUnavailable("KnowledgeFS object storage is unavailable") from exc

        response = Response(
            body,
            content_type=content_type if inline else "application/octet-stream",
            direct_passthrough=True,
        )
        response.content_length = metadata.size_bytes
        response.headers["Cache-Control"] = "private, max-age=300"
        response.headers["Content-Disposition"] = "inline" if inline else "attachment"
        response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        response.headers["ETag"] = f'"{descriptor.sha256}"'
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions")
class KnowledgeFSSpaceDocumentRevisionsApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document revisions",
        console_ns.models[KnowledgeFSDocumentRevisionListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, document_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_document_revisions(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
            cursor=query.cursor,
        )
        return dump_response(KnowledgeFSDocumentRevisionListResponse, result)


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions/<int:revision>/chunks"
)
class KnowledgeFSSpaceDocumentChunksApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSDocumentChunkListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document chunks",
        console_ns.models[KnowledgeFSDocumentChunkListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, document_id: str, revision: int):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSDocumentChunkListQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_document_chunks(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
            revision=revision,
            cursor=query.cursor,
            query_text=query.query,
        )
        return dump_response(KnowledgeFSDocumentChunkListResponse, result)


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions/<int:revision>/chunks/<string:chunk_id>"
)
class KnowledgeFSSpaceDocumentChunkApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document chunk",
        console_ns.models[KnowledgeFSDocumentChunkResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, document_id: str, revision: int, chunk_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_document_chunk(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            document_id=document_id,
            revision=revision,
            chunk_id=chunk_id,
        )
        return dump_response(KnowledgeFSDocumentChunkResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/jobs/<string:job_id>")
class KnowledgeFSSpaceCompilationJobApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS compilation job",
        console_ns.models[KnowledgeFSDocumentCompilationJobResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, job_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_compilation_job(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, job_id=job_id
        )
        return dump_response(KnowledgeFSDocumentCompilationJobResponse, result)

    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS compilation job canceled",
        console_ns.models[KnowledgeFSDocumentCompilationJobResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str, job_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.cancel_compilation_job(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, job_id=job_id
        )
        return dump_response(KnowledgeFSDocumentCompilationJobResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/jobs/<string:job_id>/retry")
class KnowledgeFSSpaceCompilationJobRetryApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS compilation job retried",
        console_ns.models[KnowledgeFSDocumentCompilationJobResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, job_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.retry_compilation_job(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, job_id=job_id
        )
        return dump_response(KnowledgeFSDocumentCompilationJobResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/bulk-jobs/<string:job_id>")
class KnowledgeFSSpaceBulkJobApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS bulk job",
        console_ns.models[KnowledgeFSBulkJobResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, job_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_bulk_job(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, job_id=job_id
        )
        return dump_response(KnowledgeFSBulkJobResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/background-tasks")
class KnowledgeFSSpaceBackgroundTasksApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSBackgroundTaskListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS background tasks",
        console_ns.models[KnowledgeFSBackgroundTaskListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSBackgroundTaskListQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_background_tasks(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSBackgroundTaskListResponse, result)


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/background-tasks/<string:task_kind>/<string:task_id>/cancel"
)
class KnowledgeFSSpaceBackgroundTaskCancelApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS background task canceled",
        console_ns.models[KnowledgeFSBackgroundTaskResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, task_kind: str, task_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.cancel_background_task(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            task_kind=_BACKGROUND_TASK_KIND_ADAPTER.validate_python(task_kind),
            task_id=task_id,
        )
        return dump_response(KnowledgeFSBackgroundTaskResponse, result)


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/background-tasks/<string:task_kind>/<string:task_id>/retry"
)
class KnowledgeFSSpaceBackgroundTaskRetryApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS background task retried",
        console_ns.models[KnowledgeFSBackgroundTaskResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, task_kind: str, task_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.retry_background_task(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            task_kind=_BACKGROUND_TASK_KIND_ADAPTER.validate_python(task_kind),
            task_id=task_id,
        )
        return dump_response(KnowledgeFSBackgroundTaskResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-providers")
class KnowledgeFSSourceProvidersApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source providers",
        console_ns.models[KnowledgeFSSourceProviderListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.list_source_providers(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
        )
        return dump_response(KnowledgeFSSourceProviderListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-connections")
class KnowledgeFSSourceConnectionsApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSSourceConnectionListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source connections",
        console_ns.models[KnowledgeFSSourceConnectionListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSSourceConnectionListQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_source_connections(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSSourceConnectionListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSSourceConnectionCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS source connection created",
        console_ns.models[KnowledgeFSSourceConnectionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.create_source_connection(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSSourceConnectionCreatePayload),
        )
        return dump_response(KnowledgeFSSourceConnectionResponse, result), HTTPStatus.CREATED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-connections/<string:connection_id>/refresh")
class KnowledgeFSSourceConnectionRefreshApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSSourceConnectionRefreshPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source connection refreshed",
        console_ns.models[KnowledgeFSSourceConnectionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, connection_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.refresh_source_connection(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            connection_id=connection_id,
            payload=_payload(KnowledgeFSSourceConnectionRefreshPayload),
        )
        return dump_response(KnowledgeFSSourceConnectionResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources")
class KnowledgeFSSpaceSourcesApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSSourceListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS sources",
        console_ns.models[KnowledgeFSSourceListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSSourceListQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_sources(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSSourceListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSSourceCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS source created",
        console_ns.models[KnowledgeFSSourceResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.create_source(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSSourceCreatePayload),
        )
        return dump_response(KnowledgeFSSourceResponse, result), HTTPStatus.CREATED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>")
class KnowledgeFSSpaceSourceApi(Resource):
    @console_ns.response(HTTPStatus.OK, "KnowledgeFS source", console_ns.models[KnowledgeFSSourceResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_source(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, source_id=source_id
        )
        return dump_response(KnowledgeFSSourceResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSSourceUpdatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "KnowledgeFS source updated", console_ns.models[KnowledgeFSSourceResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.update_source(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=_payload(KnowledgeFSSourceUpdatePayload),
        )
        return dump_response(KnowledgeFSSourceResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSSourceDeletePayload.__name__])
    @console_ns.doc(params=query_params_from_model(KnowledgeFSSourceDeleteQuery) | _IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS source deletion accepted",
        console_ns.models[KnowledgeFSDurableDeletionAcceptedResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSSourceDeleteQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.delete_source(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=_payload(KnowledgeFSSourceDeletePayload),
            documents=query.documents,
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSDurableDeletionAcceptedResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/test")
class KnowledgeFSSpaceSourceTestApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source credential test",
        console_ns.models[KnowledgeFSSourceCredentialTestResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.test_source(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, source_id=source_id
        )
        return dump_response(KnowledgeFSSourceCredentialTestResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/sync")
class KnowledgeFSSpaceSourceSyncApi(Resource):
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS source sync accepted",
        console_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.sync_source(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSSourceWorkflowResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl-preview")
class KnowledgeFSSpaceSourceCrawlPreviewApi(Resource):
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS source crawl preview accepted",
        console_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.preview_source_crawl(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSSourceWorkflowResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl-import")
class KnowledgeFSSpaceSourceCrawlImportApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSCrawlImportPayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS selected website crawl import accepted",
        console_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.import_selected_source_crawl(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=_payload(KnowledgeFSCrawlImportPayload),
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSSourceWorkflowResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/workflow-imports")
class KnowledgeFSSpaceSourceWorkflowImportApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSSourceWorkflowImportPayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS durable provider import accepted",
        console_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.import_source_workflow(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=_payload(KnowledgeFSSourceWorkflowImportPayload),
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSSourceWorkflowResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/sync-policy")
class KnowledgeFSSpaceSourceSyncPolicyApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source sync policy",
        console_ns.models[KnowledgeFSSourceSyncPolicyResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_source_sync_policy(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
        )
        return dump_response(KnowledgeFSSourceSyncPolicyResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSSourceSyncPolicyPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source sync policy updated",
        console_ns.models[KnowledgeFSSourceSyncPolicyResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def put(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.update_source_sync_policy(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=_payload(KnowledgeFSSourceSyncPolicyPayload),
        )
        return dump_response(KnowledgeFSSourceSyncPolicyResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>")
class KnowledgeFSSourceWorkflowApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source workflow",
        console_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, run_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_source_workflow(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            run_id=run_id,
        )
        return dump_response(KnowledgeFSSourceWorkflowResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/cancel")
class KnowledgeFSSourceWorkflowCancelApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSSourceWorkflowCancelPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source workflow canceled",
        console_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, run_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.cancel_source_workflow(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            run_id=run_id,
            payload=_payload(KnowledgeFSSourceWorkflowCancelPayload),
        )
        return dump_response(KnowledgeFSSourceWorkflowResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/retry")
class KnowledgeFSSourceWorkflowRetryApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source workflow retried",
        console_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, run_id: str):
        actor_id, tenant_id = _actor()
        result = retry_or_resume_source_workflow(
            facade=_console_services().facade,
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            run_id=run_id,
        )
        return dump_response(KnowledgeFSSourceWorkflowResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/pages")
class KnowledgeFSSourceWorkflowPagesApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSCrawlPreviewPageListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS crawl preview pages",
        console_ns.models[KnowledgeFSCrawlPreviewPageListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, run_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSCrawlPreviewPageListQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_crawl_preview_pages(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            run_id=run_id,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSCrawlPreviewPageListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/selection")
class KnowledgeFSSourceWorkflowSelectionApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSCrawlPreviewSelectionPayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS crawl preview selection accepted",
        console_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, run_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.select_crawl_preview_pages(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            run_id=run_id,
            payload=_payload(KnowledgeFSCrawlPreviewSelectionPayload),
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSSourceWorkflowResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/async-import")
class KnowledgeFSSourceAsyncImportApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSAsyncSourceImportPayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS Source import accepted for asynchronous reconciliation",
        console_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSAsyncSourceImportPayload)
        result = commit_source_import(
            facade=_console_services().facade,
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=payload.root,
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSSourceWorkflowResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/pages")
class KnowledgeFSSpaceSourcePagesApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSSourcePagesQuery))
    @console_ns.response(
        HTTPStatus.OK, "KnowledgeFS source pages", console_ns.models[KnowledgeFSSourcePagesResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSSourcePagesQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_source_pages(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSSourcePagesResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/import")
class KnowledgeFSSpaceSourcePageImportApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSSourceImportPagesPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "KnowledgeFS source pages imported", console_ns.models[KnowledgeFSSourceImportResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.import_source_pages(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=_payload(KnowledgeFSSourceImportPagesPayload),
        )
        return dump_response(KnowledgeFSSourceImportResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/files")
class KnowledgeFSSpaceSourceFilesApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSSourceFilesQuery))
    @console_ns.response(
        HTTPStatus.OK, "KnowledgeFS source files", console_ns.models[KnowledgeFSSourceFilesResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSSourceFilesQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_source_files(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            query=_query_pairs(query),
        )
        return dump_response(KnowledgeFSSourceFilesResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/import-files")
class KnowledgeFSSpaceSourceFileImportApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSSourceImportFilesPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "KnowledgeFS source files imported", console_ns.models[KnowledgeFSSourceImportResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, source_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.import_source_files(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            source_id=source_id,
            payload=_payload(KnowledgeFSSourceImportFilesPayload),
        )
        return dump_response(KnowledgeFSSourceImportResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/queries")
class KnowledgeFSSpaceQueriesApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSQueryCreatePayload.__name__])
    @console_ns.doc(deprecated=True)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS query accepted",
        console_ns.models[KnowledgeFSQueryResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        _ = control_space_id
        raise KnowledgeFSOperationUnavailableError(
            "Buffered KnowledgeFS query creation is deprecated; use the queries/admission streaming BFF flow"
        )


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/queries/admission")
class KnowledgeFSSpaceQueryAdmissionApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSQueryCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS streaming query admitted through Dify API",
        console_ns.models[KnowledgeFSQueryAdmissionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSQueryCreatePayload)
        validate_query_image_references(
            tenant_id=tenant_id,
            account_id=actor_id,
            upload_file_ids=[image.upload_file_id for image in getattr(payload, "query_images", ())],
            mark_used=True,
        )
        issued = _console_services().broker.issue_interactive(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            operation_id="createQuery",
        )
        admitted_request = KnowledgeFSAdmittedQueryRequest.model_validate(
            {
                **payload.model_dump(mode="json", by_alias=True, exclude_none=True),
                "knowledgeSpaceId": issued.knowledge_space_id,
            }
        )
        return dump_response(
            KnowledgeFSQueryAdmissionResponse,
            KnowledgeFSQueryAdmissionResponse(
                token=issued.token,
                expires_at=issued.expires_at,
                operation_id="createQuery",
                request=admitted_request,
                url=_console_api_url(_QUERY_STREAM_PROXY_PATH),
            ),
        )


@console_ns.route(_QUERY_STREAM_PROXY_PATH)
class KnowledgeFSQueryStreamProxyApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSAdmittedQueryRequest.__name__])
    @console_ns.doc(produces=["text/event-stream"])
    @console_ns.response(HTTPStatus.OK, "KnowledgeFS query event stream")
    @_knowledge_fs_errors
    def post(self):
        # This endpoint intentionally authenticates with the short-lived, resource-scoped
        # Capability v2 token issued by /queries/admission. Browser session cookies are
        # neither required nor forwarded to KnowledgeFS.
        capability_token, trace_id = _stream_capability()
        payload = _payload(KnowledgeFSAdmittedQueryRequest)
        upstream = _console_services().facade.stream_query(
            capability_token=capability_token,
            trace_id=trace_id,
            payload=payload,
        )
        return _stream_response(upstream)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks")
class KnowledgeFSSpaceResearchTasksApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research tasks",
        console_ns.models[KnowledgeFSResearchTaskListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_research_tasks(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
        )
        return dump_response(KnowledgeFSResearchTaskListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSResearchTaskCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS research task accepted",
        console_ns.models[KnowledgeFSResearchTaskResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSResearchTaskCreatePayload)
        validate_query_image_references(
            tenant_id=tenant_id,
            account_id=actor_id,
            upload_file_ids=[image.upload_file_id for image in getattr(payload, "query_images", ())],
            mark_used=True,
        )
        result = _console_services().facade.create_research_task(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=payload,
        )
        return dump_response(KnowledgeFSResearchTaskResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/plan")
class KnowledgeFSSpaceResearchTaskPlanApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSResearchTaskPlanPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research task plan",
        console_ns.models[KnowledgeFSResearchTaskPlanResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSResearchTaskPlanPayload)
        validate_query_image_references(
            tenant_id=tenant_id,
            account_id=actor_id,
            upload_file_ids=[image.upload_file_id for image in getattr(payload, "query_images", ())],
            mark_used=False,
        )
        result = _console_services().facade.plan_research_task(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=payload,
        )
        return dump_response(KnowledgeFSResearchTaskPlanResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>")
class KnowledgeFSSpaceResearchTaskApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research task",
        console_ns.models[KnowledgeFSResearchTaskResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, task_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_research_task(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, task_id=task_id
        )
        return dump_response(KnowledgeFSResearchTaskResponse, result)

    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research task canceled",
        console_ns.models[KnowledgeFSResearchTaskResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str, task_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.cancel_research_task(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, task_id=task_id
        )
        return dump_response(KnowledgeFSResearchTaskResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>/partials")
class KnowledgeFSSpaceResearchTaskPartialsApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSResearchTaskPartialsQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research task partial evidence",
        console_ns.models[KnowledgeFSResearchTaskPartialListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, task_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSResearchTaskPartialsQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_research_task_partials(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            task_id=task_id,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSResearchTaskPartialListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces")
class KnowledgeFSSpaceTracesApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS traces",
        console_ns.models[KnowledgeFSTraceListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_traces(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
        )
        return dump_response(KnowledgeFSTraceListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/golden-questions")
class KnowledgeFSSpaceGoldenQuestionsApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSQualityListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS golden questions",
        console_ns.models[KnowledgeFSGoldenQuestionListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSQualityListQuery.model_validate(request.args.to_dict(flat=True))
        result = _console_services().facade.list_golden_questions(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSGoldenQuestionListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSGoldenQuestionPayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS golden question created",
        console_ns.models[KnowledgeFSGoldenQuestionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.create_golden_question(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSGoldenQuestionPayload),
        )
        return dump_response(KnowledgeFSGoldenQuestionResponse, result), HTTPStatus.CREATED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/golden-questions/evidence-matches")
class KnowledgeFSSpaceGoldenQuestionEvidenceMatchesApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSGoldenQuestionEvidenceMatchPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS golden question evidence matches",
        console_ns.models[KnowledgeFSGoldenQuestionEvidenceMatchResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.match_golden_question_evidence(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSGoldenQuestionEvidenceMatchPayload),
        )
        return dump_response(KnowledgeFSGoldenQuestionEvidenceMatchResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/golden-questions/bulk-import")
class KnowledgeFSSpaceGoldenQuestionBulkImportApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSGoldenQuestionBulkImportPayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS golden questions imported",
        console_ns.models[KnowledgeFSGoldenQuestionBulkImportResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.bulk_import_golden_questions(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSGoldenQuestionBulkImportPayload),
        )
        return dump_response(KnowledgeFSGoldenQuestionBulkImportResponse, result), HTTPStatus.CREATED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/golden-questions/<string:question_id>")
class KnowledgeFSSpaceGoldenQuestionApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSGoldenQuestionPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS golden question updated",
        console_ns.models[KnowledgeFSGoldenQuestionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str, question_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.update_golden_question(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            question_id=question_id,
            payload=_payload(KnowledgeFSGoldenQuestionPayload),
        )
        return dump_response(KnowledgeFSGoldenQuestionResponse, result)

    @console_ns.response(HTTPStatus.NO_CONTENT, "KnowledgeFS golden question deleted")
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def delete(self, control_space_id: str, question_id: str):
        actor_id, tenant_id = _actor()
        _console_services().facade.delete_golden_question(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            question_id=question_id,
        )
        return Response(status=HTTPStatus.NO_CONTENT)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/quality/bad-cases")
class KnowledgeFSSpaceBadCasesApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSQualityListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS bad cases",
        console_ns.models[KnowledgeFSBadCaseListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSQualityListQuery.model_validate(request.args.to_dict(flat=True))
        result = _console_services().facade.list_bad_cases(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
            limit=query.limit,
        )
        return dump_response(KnowledgeFSBadCaseListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSBadCaseCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS bad case created",
        console_ns.models[KnowledgeFSBadCaseResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.create_bad_case(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSBadCaseCreatePayload),
        )
        return dump_response(KnowledgeFSBadCaseResponse, result), HTTPStatus.CREATED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/quality/replay-runs")
class KnowledgeFSSpaceQualityReplayApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSQualityReplayListQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS quality replay history",
        console_ns.models[KnowledgeFSQualityReplayListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSQualityReplayListQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_quality_replays(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            cursor=query.cursor,
            limit=query.limit,
            mode=query.mode,
            state=query.state,
        )
        return dump_response(KnowledgeFSQualityReplayListResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSQualityReplayPayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS quality replay queued",
        console_ns.models[KnowledgeFSQualityReplayResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.create_quality_replay(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSQualityReplayPayload),
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSQualityReplayResponse, result), HTTPStatus.ACCEPTED


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/quality/replay-runs/<string:run_id>")
class KnowledgeFSSpaceQualityReplayDetailApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSQualityReplayDetailQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS quality replay run",
        console_ns.models[KnowledgeFSQualityReplayResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, run_id: str):
        actor_id, tenant_id = _actor()
        query = KnowledgeFSQualityReplayDetailQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.get_quality_replay(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            run_id=run_id,
            evidence_item_id=str(query.evidence_item_id) if query.evidence_item_id else None,
        )
        return dump_response(KnowledgeFSQualityReplayResponse, result)


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/quality/bad-cases/<string:bad_case_id>/trace-reference"
)
class KnowledgeFSSpaceBadCaseTraceReferenceApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS bad case trace reference",
        console_ns.models[KnowledgeFSBadCaseTraceReferenceResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, bad_case_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_bad_case_trace_reference(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            bad_case_id=bad_case_id,
        )
        return dump_response(KnowledgeFSBadCaseTraceReferenceResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/quality/bad-cases/<string:bad_case_id>")
class KnowledgeFSSpaceBadCaseApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS bad case",
        console_ns.models[KnowledgeFSBadCaseResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, bad_case_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_bad_case(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            bad_case_id=bad_case_id,
        )
        return dump_response(KnowledgeFSBadCaseResponse, result)

    @console_ns.expect(console_ns.models[KnowledgeFSBadCaseUpdatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS bad case updated",
        console_ns.models[KnowledgeFSBadCaseResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str, bad_case_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.update_bad_case(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            bad_case_id=bad_case_id,
            payload=_payload(KnowledgeFSBadCaseUpdatePayload),
        )
        return dump_response(KnowledgeFSBadCaseResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>")
class KnowledgeFSSpaceTraceApi(Resource):
    @console_ns.response(
        HTTPStatus.OK, "KnowledgeFS answer trace", console_ns.models[KnowledgeFSAnswerTraceResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, trace_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_trace(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, trace_id=trace_id
        )
        return dump_response(KnowledgeFSAnswerTraceResponse, result)


def _trace_entries(*, control_space_id: str, trace_id: str, kind: Literal["conflicts", "evidence", "missing"]):
    actor_id, tenant_id = _actor()
    query = KnowledgeFSTraceEntriesQuery.model_validate(request.args.to_dict())
    result = _console_services().facade.list_trace_entries(
        tenant_id=tenant_id,
        account_id=actor_id,
        control_space_id=control_space_id,
        trace_id=trace_id,
        kind=kind,
        cursor=query.cursor,
        limit=query.limit,
    )
    return dump_response(KnowledgeFSTraceEntryListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/evidence")
class KnowledgeFSSpaceTraceEvidenceApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSTraceEntriesQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS trace evidence view",
        console_ns.models[KnowledgeFSTraceEntryListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, trace_id: str):
        return _trace_entries(control_space_id=control_space_id, trace_id=trace_id, kind="evidence")


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/conflicts")
class KnowledgeFSSpaceTraceConflictsApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSTraceEntriesQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS trace conflicts",
        console_ns.models[KnowledgeFSTraceEntryListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, trace_id: str):
        return _trace_entries(control_space_id=control_space_id, trace_id=trace_id, kind="conflicts")


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/missing")
class KnowledgeFSSpaceTraceMissingApi(Resource):
    @console_ns.doc(params=query_params_from_model(KnowledgeFSTraceEntriesQuery))
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS trace missing evidence",
        console_ns.models[KnowledgeFSTraceEntryListResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str, trace_id: str):
        return _trace_entries(control_space_id=control_space_id, trace_id=trace_id, kind="missing")


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/upload-sessions",
)
class KnowledgeFSSpaceUploadSessionsApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSUploadSessionCreatePayload.__name__])
    @console_ns.doc(params=_IDEMPOTENCY_HEADER_PARAMS)
    @console_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS upload session created",
        console_ns.models[KnowledgeFSUploadSessionCreateResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.create_upload_session(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSUploadSessionCreatePayload),
            idempotency_key=_idempotency_key(),
        )
        return dump_response(KnowledgeFSUploadSessionCreateResponse, result), HTTPStatus.CREATED


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/upload-sessions/"
    "<string:upload_session_id>/parts/<int:part_number>/presign",
)
class KnowledgeFSSpaceUploadSessionPartPresignApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSUploadPartPresignPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS upload part URL created",
        console_ns.models[KnowledgeFSPresignedUploadResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @_knowledge_fs_errors
    def post(self, control_space_id: str, upload_session_id: str, part_number: int):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.presign_upload_session_part(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            upload_session_id=upload_session_id,
            part_number=part_number,
            payload=_payload(KnowledgeFSUploadPartPresignPayload),
        )
        return dump_response(KnowledgeFSPresignedUploadResponse, result)


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/upload-sessions/<string:upload_session_id>/complete",
)
class KnowledgeFSSpaceUploadSessionCompleteApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSUploadSessionCompletePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS upload session completed",
        console_ns.models[KnowledgeFSUploadSessionMutationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @_knowledge_fs_errors
    def post(self, control_space_id: str, upload_session_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.complete_upload_session(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            upload_session_id=upload_session_id,
            payload=_payload(KnowledgeFSUploadSessionCompletePayload),
        )
        return dump_response(KnowledgeFSUploadSessionMutationResponse, result)


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/upload-sessions/<string:upload_session_id>/abort",
)
class KnowledgeFSSpaceUploadSessionAbortApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSUploadSessionAbortPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS upload session aborted",
        console_ns.models[KnowledgeFSUploadSessionMutationResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @_knowledge_fs_errors
    def post(self, control_space_id: str, upload_session_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.abort_upload_session(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            upload_session_id=upload_session_id,
            payload=_payload(KnowledgeFSUploadSessionAbortPayload),
        )
        return dump_response(KnowledgeFSUploadSessionMutationResponse, result)


@console_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/upload-sessions/<string:upload_session_id>/small-file"
)
class KnowledgeFSSpaceSmallFileUploadApi(Resource):
    @console_ns.doc(consumes=["multipart/form-data"], params=_SMALL_FILE_UPLOAD_PARAMS)
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS small-file fallback completed",
        console_ns.models[KnowledgeFSSmallFileUploadResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @_knowledge_fs_errors
    def post(self, control_space_id: str, upload_session_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.upload_small_file(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            upload_session_id=upload_session_id,
            body_reader=_read_small_file_body,
        )
        return dump_response(KnowledgeFSSmallFileUploadResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/query-stream-capability")
class KnowledgeFSSpaceQueryStreamCapabilityApi(Resource):
    # Legacy alternative to /queries/admission. Both represent one independently admitted
    # createQuery operation; clients must use one endpoint and never chain them.
    @console_ns.doc(deprecated=True)
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS Dify API query stream capability",
        console_ns.models[KnowledgeFSQueryStreamCapabilityResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        issued = _console_services().broker.issue_interactive(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            operation_id="createQuery",
        )
        return dump_response(
            KnowledgeFSQueryStreamCapabilityResponse,
            KnowledgeFSQueryStreamCapabilityResponse(
                token=issued.token,
                expires_at=issued.expires_at,
                operation_id="createQuery",
                url=_console_api_url(_QUERY_STREAM_PROXY_PATH),
            ),
        )


@console_ns.route("/knowledge-fs/tasks/<string:task_id>/stream-capability")
class KnowledgeFSTaskStreamCapabilityApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSStreamCapabilityPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS task stream capability",
        console_ns.models[KnowledgeFSStreamCapabilityResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, task_id: str):
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSStreamCapabilityPayload)
        issued = _console_services().broker.issue_interactive(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=payload.control_space_id,
            operation_id="streamResearchTask",
            resource_id=task_id,
        )
        stream_url = _research_task_events_url(
            task_id=task_id,
            knowledge_space_id=issued.knowledge_space_id,
        )
        return dump_response(
            KnowledgeFSStreamCapabilityResponse,
            KnowledgeFSStreamCapabilityResponse(
                token=issued.token,
                expires_at=issued.expires_at,
                operation_id="streamResearchTask",
                url=stream_url,
            ),
        )


@console_ns.route("/knowledge-fs/research-tasks/<string:task_id>/events")
class KnowledgeFSResearchTaskStreamProxyApi(Resource):
    @console_ns.doc(
        params=query_params_from_model(KnowledgeFSResearchTaskStreamQuery),
        produces=["text/event-stream"],
    )
    @console_ns.response(HTTPStatus.OK, "KnowledgeFS research task event stream")
    @_knowledge_fs_errors
    def get(self, task_id: str):
        capability_token, trace_id = _stream_capability()
        stream_query = KnowledgeFSResearchTaskStreamQuery.model_validate(request.args.to_dict(flat=True))
        upstream = _console_services().facade.stream_research_task(
            capability_token=capability_token,
            trace_id=trace_id,
            task_id=task_id,
            knowledge_space_id=stream_query.knowledge_space_id,
            cursor=stream_query.cursor,
            limit=stream_query.limit,
        )
        return _stream_response(upstream)


def _research_task_events_url(*, task_id: str, knowledge_space_id: str) -> str:
    path = f"/knowledge-fs/research-tasks/{quote(task_id, safe='')}/events"
    query = urlencode({"knowledgeSpaceId": knowledge_space_id})
    return f"{_console_api_url(path)}?{query}"


@console_ns.route("/knowledge-fs/.well-known/jwks.json")
class KnowledgeFSJWKSApi(Resource):
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS Capability v2 public keys",
        console_ns.models[KnowledgeFSJWKSResponse.__name__],
    )
    def get(self) -> Response:
        if not dify_config.KNOWLEDGE_FS_CAPABILITY_V2_ENABLED:
            raise NotFound()
        session_maker = session_factory.get_session_maker()
        try:
            issuer = create_configured_knowledge_fs_capability_issuer(
                audit=SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor(session_maker)
            )
        except KnowledgeFSCapabilityConfigurationError as exc:
            raise ServiceUnavailable("KnowledgeFS capability issuance is not configured") from exc
        if issuer is None:
            raise NotFound()
        payload = KnowledgeFSJWKSResponse.model_validate(issuer.public_jwks()).model_dump(mode="json")
        response = jsonify(payload)
        response.headers["Cache-Control"] = (
            f"public, max-age={dify_config.KNOWLEDGE_FS_JWKS_CACHE_MAX_AGE_SECONDS}, must-revalidate"
        )
        return response


__all__ = ["KnowledgeFSRuntime"]
