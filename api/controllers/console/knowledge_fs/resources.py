"""Typed Console resources for the independent KnowledgeFS product."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from http import HTTPStatus
from typing import Literal
from urllib.parse import quote, urlencode

from flask import Response, jsonify, request
from flask_restx import Resource
from pydantic import BaseModel, TypeAdapter, ValidationError
from werkzeug.exceptions import Conflict, NotFound, RequestEntityTooLarge, ServiceUnavailable, UnprocessableEntity

from configs import dify_config
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.knowledge_fs.error import (
    KnowledgeFSAccessDeniedHTTPError,
    KnowledgeFSInvalidRequestHTTPError,
    KnowledgeFSOperationUnavailableHTTPError,
    KnowledgeFSSpaceNotFoundHTTPError,
    KnowledgeFSUpstreamUnavailableHTTPError,
)
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    setup_required,
)
from core.db.session_factory import session_factory
from libs.helper import dump_response
from libs.login import current_account_with_tenant, login_required
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from repositories.sqlalchemy_knowledge_fs_capability_issuance_auditor import (
    SQLAlchemyKnowledgeFSCapabilityIssuanceAuditor,
)
from services.knowledge_fs.app_binding_management import KnowledgeFSAppBindingManagementError
from services.knowledge_fs.control_plane_service import (
    KnowledgeFSControlPlaneInvariantError,
)
from services.knowledge_fs.credential_service import (
    KnowledgeFSCredentialPolicyError,
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
    KnowledgeFSBackgroundTaskListQuery,
    KnowledgeFSBackgroundTaskListResponse,
    KnowledgeFSBackgroundTaskResponse,
    KnowledgeFSBadCaseCreatePayload,
    KnowledgeFSBadCaseListResponse,
    KnowledgeFSBadCaseResponse,
    KnowledgeFSBadCaseTraceReferenceResponse,
    KnowledgeFSBadCaseUpdatePayload,
    KnowledgeFSBulkDeletionAcceptedResponse,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSCapabilityResponse,
    KnowledgeFSCrawlPreviewPageListQuery,
    KnowledgeFSCrawlPreviewPageListResponse,
    KnowledgeFSCrawlPreviewSelectionPayload,
    KnowledgeFSCredentialCreatePayload,
    KnowledgeFSCredentialCreateResponse,
    KnowledgeFSCredentialListResponse,
    KnowledgeFSCursorQuery,
    KnowledgeFSDocumentChunkListQuery,
    KnowledgeFSDocumentChunkListResponse,
    KnowledgeFSDocumentChunkResponse,
    KnowledgeFSDocumentCompilationJobResponse,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSDocumentListResponse,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSDocumentReindexResponse,
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentRevisionListResponse,
    KnowledgeFSDocumentUploadAcceptedResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSExternalAccessPayload,
    KnowledgeFSExternalAccessResponse,
    KnowledgeFSGoldenQuestionListResponse,
    KnowledgeFSGoldenQuestionPayload,
    KnowledgeFSGoldenQuestionResponse,
    KnowledgeFSIdempotencyHeader,
    KnowledgeFSJWKSResponse,
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSMembersReplacePayload,
    KnowledgeFSOverviewBaseStatsResponse,
    KnowledgeFSOverviewCountComparisonResponse,
    KnowledgeFSOverviewHealthResponse,
    KnowledgeFSOverviewInventoryResponse,
    KnowledgeFSOverviewQueryOutcomesResponse,
    KnowledgeFSOverviewRateComparisonResponse,
    KnowledgeFSOverviewStatsResponse,
    KnowledgeFSOverviewWindowQuery,
    KnowledgeFSPermissionListResponse,
    KnowledgeFSProfileMigrationResponse,
    KnowledgeFSQualityListQuery,
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
    KnowledgeFSSpaceUpdatePayload,
    KnowledgeFSStreamCapabilityPayload,
    KnowledgeFSStreamCapabilityResponse,
    KnowledgeFSTraceEntriesQuery,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSTraceListResponse,
    KnowledgeFSUploadCapabilityPayload,
)
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
    KnowledgeFSRemoteMultipartFile,
)
from services.knowledge_fs.runtime import KnowledgeFSRuntime, create_knowledge_fs_runtime
from services.knowledge_fs_capability import (
    KnowledgeFSCapabilityConfigurationError,
    create_configured_knowledge_fs_capability_issuer,
)

register_schema_models(
    console_ns,
    KnowledgeFSAppBindingPayload,
    KnowledgeFSBackgroundTaskListQuery,
    KnowledgeFSBadCaseCreatePayload,
    KnowledgeFSBadCaseUpdatePayload,
    KnowledgeFSOverviewWindowQuery,
    KnowledgeFSCredentialCreatePayload,
    KnowledgeFSCursorQuery,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSDocumentChunkListQuery,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSGoldenQuestionPayload,
    KnowledgeFSExternalAccessPayload,
    KnowledgeFSCrawlPreviewPageListQuery,
    KnowledgeFSMembersReplacePayload,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSQualityListQuery,
    KnowledgeFSQualityReplayPayload,
    KnowledgeFSResearchTaskPartialsQuery,
    KnowledgeFSResearchTaskPlanPayload,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceConnectionCreatePayload,
    KnowledgeFSSourceConnectionListQuery,
    KnowledgeFSSourceConnectionRefreshPayload,
    KnowledgeFSCrawlPreviewSelectionPayload,
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
    KnowledgeFSSpaceUpdatePayload,
    KnowledgeFSStreamCapabilityPayload,
    KnowledgeFSTraceEntriesQuery,
    KnowledgeFSUploadCapabilityPayload,
)
register_response_schema_models(
    console_ns,
    KnowledgeFSCapabilityResponse,
    KnowledgeFSAnswerTraceResponse,
    KnowledgeFSAppBindingListResponse,
    KnowledgeFSAppBindingResponse,
    KnowledgeFSBackgroundTaskListResponse,
    KnowledgeFSBackgroundTaskResponse,
    KnowledgeFSBadCaseListResponse,
    KnowledgeFSBadCaseResponse,
    KnowledgeFSBadCaseTraceReferenceResponse,
    KnowledgeFSBulkDeletionAcceptedResponse,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSCredentialCreateResponse,
    KnowledgeFSCredentialListResponse,
    KnowledgeFSDocumentListResponse,
    KnowledgeFSDocumentChunkListResponse,
    KnowledgeFSDocumentChunkResponse,
    KnowledgeFSDocumentCompilationJobResponse,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSDocumentReindexResponse,
    KnowledgeFSDocumentRevisionListResponse,
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentUploadAcceptedResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSGoldenQuestionListResponse,
    KnowledgeFSGoldenQuestionResponse,
    KnowledgeFSExternalAccessResponse,
    KnowledgeFSJWKSResponse,
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSPermissionListResponse,
    KnowledgeFSQueryResponse,
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
    KnowledgeFSStreamCapabilityResponse,
    KnowledgeFSTraceListResponse,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSOverviewHealthResponse,
    KnowledgeFSOverviewInventoryResponse,
    KnowledgeFSOverviewQueryOutcomesResponse,
    KnowledgeFSOverviewStatsResponse,
)


def _console_services() -> KnowledgeFSRuntime:
    if not dify_config.KNOWLEDGE_FS_ENABLED:
        raise NotFound()
    session_maker = session_factory.get_session_maker()
    return create_knowledge_fs_runtime(session_maker)


def _knowledge_fs_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @cloud_edition_billing_rate_limit_check("knowledge")
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except KnowledgeFSProductNotFoundError as exc:
            raise KnowledgeFSSpaceNotFoundHTTPError() from exc
        except KnowledgeFSOperationUnavailableError as exc:
            raise KnowledgeFSOperationUnavailableHTTPError() from exc
        except KnowledgeFSProductResourceNotFoundError as exc:
            raise NotFound() from exc
        except KnowledgeFSProductRemoteError as exc:
            raise KnowledgeFSUpstreamUnavailableHTTPError() from exc
        except KnowledgeFSProductRequestRejectedError as exc:
            if exc.status_code == HTTPStatus.CONFLICT:
                raise Conflict() from exc
            if exc.status_code == HTTPStatus.REQUEST_ENTITY_TOO_LARGE:
                raise RequestEntityTooLarge() from exc
            raise UnprocessableEntity() from exc
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
_BACKGROUND_TASK_KIND_ADAPTER: TypeAdapter[Literal["document", "document_bulk", "source"]] = TypeAdapter(
    Literal["document", "document_bulk", "source"]
)


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


def _actor() -> tuple[str, str]:
    account, tenant_id = current_account_with_tenant()
    return account.id, tenant_id


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
        query = KnowledgeFSSpaceListQuery.model_validate(request.args.to_dict())
        result = _console_services().application.list_spaces(
            tenant_id=tenant_id,
            account_id=actor_id,
            page=query.page,
            limit=query.limit,
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

    @console_ns.doc(consumes=["multipart/form-data"], params=_DOCUMENT_UPLOAD_PARAMS)
    @console_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS document accepted for processing",
        console_ns.models[KnowledgeFSDocumentUploadAcceptedResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        actor_id, tenant_id = _actor()
        result = _console_services().facade.create_document(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            body_reader=_read_document_upload,
        )
        return dump_response(KnowledgeFSDocumentUploadAcceptedResponse, result), HTTPStatus.ACCEPTED


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
        result = _console_services().facade.retry_source_workflow(
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
            "Buffered KnowledgeFS query creation is deprecated; use the queries/admission direct flow"
        )


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/queries/admission")
class KnowledgeFSSpaceQueryAdmissionApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSQueryCreatePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS direct query admitted",
        console_ns.models[KnowledgeFSQueryAdmissionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        direct_origin = dify_config.KNOWLEDGE_FS_DIRECT_ORIGIN
        if direct_origin is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS direct query streaming is not configured")
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSQueryCreatePayload)
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
                url=_query_stream_url(direct_origin),
            ),
        )


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
        result = _console_services().facade.create_research_task(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSResearchTaskCreatePayload),
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
        result = _console_services().facade.plan_research_task(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=_payload(KnowledgeFSResearchTaskPlanPayload),
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


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/upload-capabilities")
class KnowledgeFSSpaceUploadCapabilitiesApi(Resource):
    @console_ns.expect(console_ns.models[KnowledgeFSUploadCapabilityPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS upload capability",
        console_ns.models[KnowledgeFSCapabilityResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        direct_origin = dify_config.KNOWLEDGE_FS_DIRECT_ORIGIN
        if direct_origin is None or not dify_config.KNOWLEDGE_FS_DIRECT_UPLOAD_READY:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS direct upload is not configured")
        actor_id, tenant_id = _actor()
        payload = _payload(KnowledgeFSUploadCapabilityPayload)
        issued = _console_services().broker.issue_interactive(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            operation_id=payload.operation_id,
            resource_id=payload.upload_session_id,
        )
        return dump_response(
            KnowledgeFSCapabilityResponse,
            KnowledgeFSCapabilityResponse(
                token=issued.token,
                expires_at=issued.expires_at,
                direct_origin=direct_origin,
                operation_id=payload.operation_id,
            ),
        )


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
        "KnowledgeFS query stream capability",
        console_ns.models[KnowledgeFSQueryStreamCapabilityResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        direct_origin = dify_config.KNOWLEDGE_FS_DIRECT_ORIGIN
        if direct_origin is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS direct query streaming is not configured")
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
                url=_query_stream_url(direct_origin),
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
        direct_origin = dify_config.KNOWLEDGE_FS_DIRECT_ORIGIN
        if direct_origin is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS direct streaming is not configured")
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
            direct_origin=direct_origin,
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


def _research_task_events_url(*, direct_origin: str, task_id: str, knowledge_space_id: str) -> str:
    path = f"/research-tasks/{quote(task_id, safe='')}/events"
    query = urlencode({"knowledgeSpaceId": knowledge_space_id})
    return f"{direct_origin}{path}?{query}"


def _query_stream_url(direct_origin: str) -> str:
    return f"{direct_origin.rstrip('/')}/queries"


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
