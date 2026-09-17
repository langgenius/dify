"""KnowledgeFS Service API routes authenticated by workspace Dataset API keys."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from http import HTTPStatus
from typing import Literal

from flask import Response, request
from flask_restx import Resource
from pydantic import BaseModel, JsonValue, ValidationError
from werkzeug.exceptions import NotFound

from configs import dify_config
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.service_api import service_api_ns
from controllers.service_api.knowledge_fs.error import (
    KnowledgeFSInvalidCredentialHTTPError,
    KnowledgeFSServiceAccessDeniedHTTPError,
    KnowledgeFSServiceConflictHTTPError,
    KnowledgeFSServiceInvalidRequestHTTPError,
    KnowledgeFSServiceOperationUnavailableHTTPError,
    KnowledgeFSServiceRateLimitHTTPError,
    KnowledgeFSServiceRequestRejectedHTTPError,
    KnowledgeFSServiceRequestTooLargeHTTPError,
    KnowledgeFSServiceResourceNotFoundHTTPError,
    KnowledgeFSServiceTimeoutHTTPError,
    KnowledgeFSServiceUpstreamUnavailableHTTPError,
)
from controllers.service_api.wraps import check_knowledge_rate_limit, validate_and_get_api_token
from core.db.session_factory import session_factory
from libs.helper import dump_response
from services.knowledge_fs.product_dto import (
    KnowledgeFSAdmittedQueryRequest,
    KnowledgeFSAnswerTraceResponse,
    KnowledgeFSBackgroundTaskListQuery,
    KnowledgeFSBackgroundTaskListResponse,
    KnowledgeFSBackgroundTaskResponse,
    KnowledgeFSBulkDeletionAcceptedResponse,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSCrawlImportPayload,
    KnowledgeFSCrawlPreviewPageListQuery,
    KnowledgeFSCrawlPreviewPageListResponse,
    KnowledgeFSCrawlPreviewSelectionPayload,
    KnowledgeFSCursorQuery,
    KnowledgeFSDocumentChunkListQuery,
    KnowledgeFSDocumentChunkListResponse,
    KnowledgeFSDocumentChunkResponse,
    KnowledgeFSDocumentCompilationJobResponse,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSDocumentListResponse,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSDocumentProcessingTaskListResponse,
    KnowledgeFSDocumentProcessingTaskResponse,
    KnowledgeFSDocumentReferenceQuery,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSDocumentReindexResponse,
    KnowledgeFSDocumentResponse,
    KnowledgeFSDocumentRevisionListResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSDurableDeletionJobResponse,
    KnowledgeFSIdempotencyHeader,
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSProfileMigrationResponse,
    KnowledgeFSQueryAdmissionResponse,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskListResponse,
    KnowledgeFSResearchTaskPartialListResponse,
    KnowledgeFSResearchTaskPartialsQuery,
    KnowledgeFSResearchTaskPlanPayload,
    KnowledgeFSResearchTaskPlanResponse,
    KnowledgeFSResearchTaskResponse,
    KnowledgeFSResolvedDocumentReferenceResponse,
    KnowledgeFSServiceQueryImageUploadResponse,
    KnowledgeFSServiceSourceConnectionCreatePayload,
    KnowledgeFSServiceSourceCreatePayload,
    KnowledgeFSServiceSourceUpdatePayload,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSettingsResponse,
    KnowledgeFSSettingsUpdateResponse,
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
    KnowledgeFSSourceWorkflowListQuery,
    KnowledgeFSSourceWorkflowListResponse,
    KnowledgeFSSourceWorkflowResponse,
    KnowledgeFSTraceEntriesQuery,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSTraceListQuery,
    KnowledgeFSTraceListResponse,
)
from services.knowledge_fs.product_operations import product_operation_action
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
    KnowledgeFSRemoteSSEResponse,
)
from services.knowledge_fs.runtime import KnowledgeFSRuntime, get_knowledge_fs_runtime
from services.knowledge_fs.service_api_authorization import (
    KnowledgeFSServiceApiAuthorizationError,
    KnowledgeFSServiceApiProfile,
    KnowledgeFSServiceApiScopeError,
)
from services.knowledge_fs.service_api_source_payloads import durable_file_import, durable_page_import
from services.knowledge_fs.service_query_image_upload import (
    upload_service_query_image,
    validate_service_query_image_references,
)

_MAX_STREAM_CAPABILITY_BYTES = 16 * 1024
_MAX_STREAM_TRACE_ID_BYTES = 255
_QUERY_STREAM_PROXY_PATH = "/knowledge-fs/query-stream"

register_schema_models(
    service_api_ns,
    KnowledgeFSBackgroundTaskListQuery,
    KnowledgeFSDocumentReferenceQuery,
    KnowledgeFSCrawlImportPayload,
    KnowledgeFSCrawlPreviewPageListQuery,
    KnowledgeFSCrawlPreviewSelectionPayload,
    KnowledgeFSServiceSourceConnectionCreatePayload,
    KnowledgeFSSourceConnectionListQuery,
    KnowledgeFSSourceConnectionRefreshPayload,
    KnowledgeFSSourceSyncPolicyPayload,
    KnowledgeFSSourceWorkflowImportPayload,
    KnowledgeFSSourceWorkflowCancelPayload,
    KnowledgeFSSourceWorkflowListQuery,
    KnowledgeFSServiceSourceCreatePayload,
    KnowledgeFSServiceSourceUpdatePayload,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSAdmittedQueryRequest,
    KnowledgeFSCursorQuery,
    KnowledgeFSDocumentChunkListQuery,
    KnowledgeFSDocumentDeletePayload,
    KnowledgeFSDocumentMetadataPayload,
    KnowledgeFSDocumentReindexPayload,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSResearchTaskPartialsQuery,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskPlanPayload,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSourceCreatePayload,
    KnowledgeFSSourceDeletePayload,
    KnowledgeFSSourceDeleteQuery,
    KnowledgeFSSourceFilesQuery,
    KnowledgeFSSourceImportFilesPayload,
    KnowledgeFSSourceImportPagesPayload,
    KnowledgeFSSourcePagesQuery,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSTraceEntriesQuery,
)
register_response_schema_models(
    service_api_ns,
    KnowledgeFSServiceQueryImageUploadResponse,
    KnowledgeFSDocumentProcessingTaskResponse,
    KnowledgeFSDocumentProcessingTaskListResponse,
    KnowledgeFSBackgroundTaskListResponse,
    KnowledgeFSBackgroundTaskResponse,
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSResolvedDocumentReferenceResponse,
    KnowledgeFSDurableDeletionJobResponse,
    KnowledgeFSSettingsUpdateResponse,
    KnowledgeFSProfileMigrationResponse,
    KnowledgeFSSourceConnectionResponse,
    KnowledgeFSSourceConnectionListResponse,
    KnowledgeFSSourceSyncPolicyResponse,
    KnowledgeFSSourceWorkflowResponse,
    KnowledgeFSSourceWorkflowListResponse,
    KnowledgeFSCrawlPreviewPageListResponse,
    KnowledgeFSAnswerTraceResponse,
    KnowledgeFSBulkDeletionAcceptedResponse,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSDocumentChunkListResponse,
    KnowledgeFSDocumentChunkResponse,
    KnowledgeFSDocumentCompilationJobResponse,
    KnowledgeFSDocumentListResponse,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSDocumentReindexResponse,
    KnowledgeFSDocumentRevisionListResponse,
    KnowledgeFSDocumentResponse,
    KnowledgeFSDurableDeletionAcceptedResponse,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSQueryAdmissionResponse,
    KnowledgeFSResearchTaskListResponse,
    KnowledgeFSResearchTaskPartialListResponse,
    KnowledgeFSResearchTaskPlanResponse,
    KnowledgeFSResearchTaskResponse,
    KnowledgeFSSettingsResponse,
    KnowledgeFSSourceListResponse,
    KnowledgeFSSourceCrawlResponse,
    KnowledgeFSSourceCredentialTestResponse,
    KnowledgeFSSourceFilesResponse,
    KnowledgeFSSourceImportResponse,
    KnowledgeFSSourcePagesResponse,
    KnowledgeFSSourceProviderListResponse,
    KnowledgeFSSourceResponse,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSTraceListResponse,
)


def _runtime() -> KnowledgeFSRuntime:
    if not dify_config.KNOWLEDGE_FS_ENABLED:
        raise NotFound()
    return get_knowledge_fs_runtime(session_factory.get_session_maker())


def _service_api_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except KnowledgeFSServiceApiScopeError as exc:
            raise KnowledgeFSServiceAccessDeniedHTTPError() from exc
        except KnowledgeFSServiceApiAuthorizationError as exc:
            raise KnowledgeFSInvalidCredentialHTTPError() from exc
        except KnowledgeFSOperationUnavailableError as exc:
            raise KnowledgeFSServiceOperationUnavailableHTTPError() from exc
        except KnowledgeFSProductResourceNotFoundError as exc:
            raise KnowledgeFSServiceResourceNotFoundHTTPError(exc.failure) from exc
        except KnowledgeFSProductRemoteError as exc:
            raise KnowledgeFSServiceUpstreamUnavailableHTTPError(exc.failure) from exc
        except KnowledgeFSProductRequestRejectedError as exc:
            error_type = {
                HTTPStatus.FORBIDDEN: KnowledgeFSServiceAccessDeniedHTTPError,
                HTTPStatus.CONFLICT: KnowledgeFSServiceConflictHTTPError,
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE: KnowledgeFSServiceRequestTooLargeHTTPError,
                HTTPStatus.UNPROCESSABLE_ENTITY: KnowledgeFSServiceRequestRejectedHTTPError,
                HTTPStatus.TOO_MANY_REQUESTS: KnowledgeFSServiceRateLimitHTTPError,
                HTTPStatus.SERVICE_UNAVAILABLE: KnowledgeFSServiceOperationUnavailableHTTPError,
                HTTPStatus.GATEWAY_TIMEOUT: KnowledgeFSServiceTimeoutHTTPError,
            }.get(HTTPStatus(exc.status_code), KnowledgeFSServiceInvalidRequestHTTPError)
            error = error_type(exc.failure)
            if exc.violations and error.data is not None:
                error.data["violations"] = exc.violations
            raise error from exc
        except ValidationError as exc:
            error = KnowledgeFSServiceInvalidRequestHTTPError()
            if error.data is not None:
                error.data["violations"] = [
                    {"field": [str(part)[:128] for part in item["loc"][:8]], "type": item["type"]}
                    for item in exc.errors(include_url=False, include_context=False, include_input=False)[:20]
                ]
            raise error from exc

    return decorated


def _dump_response[ResponseT: BaseModel](model: type[ResponseT], value: object):
    try:
        return dump_response(model, value)
    except ValidationError as exc:
        raise KnowledgeFSProductRemoteError("KnowledgeFS returned an invalid response contract") from exc


def _upstream_model[ResponseT: BaseModel](model: type[ResponseT], value: object) -> ResponseT:
    try:
        return model.model_validate(value)
    except ValidationError as exc:
        raise KnowledgeFSProductRemoteError("KnowledgeFS returned an invalid response contract") from exc


def _payload[PayloadT: BaseModel](model: type[PayloadT]) -> PayloadT:
    return model.model_validate(service_api_ns.payload or {})


def _idempotency_key() -> str:
    return KnowledgeFSIdempotencyHeader.model_validate(
        {"idempotency-key": request.headers.get("Idempotency-Key")}
    ).idempotency_key


def _query_pairs(model: BaseModel) -> tuple[tuple[str, str], ...]:
    values = model.model_dump(mode="json", by_alias=True, exclude_none=True)
    return tuple(
        (name, str(value).lower() if isinstance(value, bool) else str(value)) for name, value in values.items()
    )


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
        raise KnowledgeFSInvalidCredentialHTTPError()
    if (
        not trace_id
        or len(trace_id.encode("utf-8")) > _MAX_STREAM_TRACE_ID_BYTES
        or any(character in trace_id for character in ("\0", "\r", "\n"))
    ):
        raise KnowledgeFSServiceInvalidRequestHTTPError()
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


def _service_api_url(path: str) -> str:
    base_url = str(dify_config.SERVICE_API_URL or "").strip().rstrip("/")
    if not base_url:
        return f"/v1{path}"
    if base_url.endswith("/v1"):
        return f"{base_url}{path}"
    return f"{base_url}/v1{path}"


def _profile(
    runtime: KnowledgeFSRuntime,
    *,
    operation_id: str,
    control_space_id: str,
) -> KnowledgeFSServiceApiProfile:
    try:
        product_operation_action(operation_id)
    except KeyError as exc:
        raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {operation_id}") from exc
    api_token = validate_and_get_api_token("dataset")
    if api_token.tenant_id is None:
        raise KnowledgeFSServiceApiAuthorizationError("Dataset API key is not workspace-scoped")
    # Same per-workspace knowledge request rate limit as every legacy dataset service route.
    check_knowledge_rate_limit(api_token)
    return runtime.service_api_authorization.authorize(
        api_token_id=str(api_token.id),
        tenant_id=str(api_token.tenant_id),
        control_space_id=control_space_id,
    )


def _execute_service_operation(
    *,
    control_space_id: str,
    operation_id: str,
    payload: BaseModel | None = None,
    query: tuple[tuple[str, str], ...] = (),
    bind_space_in_body: bool = False,
    resource_id: str | None = None,
    path_parameters: tuple[tuple[str, str], ...] = (),
    headers: tuple[tuple[str, str], ...] = (),
) -> JsonValue:
    runtime = _runtime()
    profile = _profile(runtime, operation_id=operation_id, control_space_id=control_space_id)
    return runtime.facade.execute_service(
        profile=profile,
        operation_id=operation_id,
        payload=payload,
        query=query,
        bind_space_in_body=bind_space_in_body,
        resource_id=resource_id,
        path_parameters=path_parameters,
        headers=headers,
    )


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents")
class KnowledgeFSServiceDocumentsApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base documents",
        service_api_ns.models[KnowledgeFSDocumentListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="listDocuments", control_space_id=control_space_id)
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        raw = runtime.facade.execute_service(
            profile=profile,
            operation_id="listDocuments",
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSDocumentListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/bulk")
class KnowledgeFSServiceBulkDocumentsApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSBulkDocumentDeletePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "Agent Knowledge Base document deletions accepted",
        service_api_ns.models[KnowledgeFSBulkDeletionAcceptedResponse.__name__],
    )
    @_service_api_errors
    def delete(self, control_space_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="bulkDeleteDocuments",
            payload=_payload(KnowledgeFSBulkDocumentDeletePayload),
            headers=(("Idempotency-Key", _idempotency_key()),),
        )
        return _bulk_deletion_accepted(control_space_id, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/reindex")
class KnowledgeFSServiceDocumentReindexApi(Resource):
    @service_api_ns.doc(
        params={
            "Idempotency-Key": {"in": "header", "required": False, "type": "string", "minLength": 8, "maxLength": 255}
        }
    )
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSDocumentReindexPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "Agent Knowledge Base document reindex queued",
        service_api_ns.models[KnowledgeFSDocumentReindexResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="reindexDocuments",
            headers=(("Idempotency-Key", _idempotency_key()),) if request.headers.get("Idempotency-Key") else (),
            payload=_payload(KnowledgeFSDocumentReindexPayload),
        )
        return _dump_response(KnowledgeFSDocumentReindexResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>")
class KnowledgeFSServiceDocumentApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "Agent Knowledge Base document", service_api_ns.models[KnowledgeFSDocumentResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, document_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getDocument",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
        )
        return _dump_response(KnowledgeFSDocumentResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSDocumentMetadataPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base document metadata updated",
        service_api_ns.models[KnowledgeFSLogicalDocumentResponse.__name__],
    )
    @_service_api_errors
    def patch(self, control_space_id: str, document_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="updateDocumentMetadata",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
            payload=_payload(KnowledgeFSDocumentMetadataPayload),
        )
        return _dump_response(KnowledgeFSLogicalDocumentResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSDocumentDeletePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "Agent Knowledge Base document deletion accepted",
        service_api_ns.models[KnowledgeFSDurableDeletionAcceptedResponse.__name__],
    )
    @_service_api_errors
    def delete(self, control_space_id: str, document_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="deleteDocument",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
            payload=_payload(KnowledgeFSDocumentDeletePayload),
            headers=(("Idempotency-Key", _idempotency_key()),),
        )
        return _deletion_accepted(control_space_id, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/outline")
class KnowledgeFSServiceDocumentOutlineApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base document outline",
        service_api_ns.models[KnowledgeFSDocumentOutlineResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, document_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getDocumentOutline",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
        )
        return _dump_response(KnowledgeFSDocumentOutlineResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions")
class KnowledgeFSServiceDocumentRevisionsApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base document revisions",
        service_api_ns.models[KnowledgeFSDocumentRevisionListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, document_id: str):
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listDocumentRevisions",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSDocumentRevisionListResponse, raw)


@service_api_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions/<int:revision>/chunks"
)
class KnowledgeFSServiceDocumentChunksApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSDocumentChunkListQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base document chunks",
        service_api_ns.models[KnowledgeFSDocumentChunkListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, document_id: str, revision: int):
        query = KnowledgeFSDocumentChunkListQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listDocumentChunks",
            resource_id=document_id,
            path_parameters=(("documentId", document_id), ("revision", str(revision))),
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSDocumentChunkListResponse, raw)


@service_api_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions/<int:revision>/chunks/<string:chunk_id>"
)
class KnowledgeFSServiceDocumentChunkApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base document chunk",
        service_api_ns.models[KnowledgeFSDocumentChunkResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, document_id: str, revision: int, chunk_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getDocumentChunk",
            resource_id=document_id,
            path_parameters=(
                ("documentId", document_id),
                ("revision", str(revision)),
                ("chunkId", chunk_id),
            ),
        )
        return _dump_response(KnowledgeFSDocumentChunkResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/jobs/<string:job_id>")
class KnowledgeFSServiceCompilationJobApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base compilation job",
        service_api_ns.models[KnowledgeFSDocumentCompilationJobResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id, operation_id="getCompilationJob", resource_id=job_id
        )
        return _dump_response(KnowledgeFSDocumentCompilationJobResponse, raw)

    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base compilation job canceled",
        service_api_ns.models[KnowledgeFSDocumentCompilationJobResponse.__name__],
    )
    @_service_api_errors
    def delete(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id, operation_id="cancelCompilationJob", resource_id=job_id
        )
        return _dump_response(KnowledgeFSDocumentCompilationJobResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/jobs/<string:job_id>/retry")
class KnowledgeFSServiceCompilationJobRetryApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base compilation job retried",
        service_api_ns.models[KnowledgeFSDocumentCompilationJobResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id, operation_id="retryCompilationJob", resource_id=job_id
        )
        return _dump_response(KnowledgeFSDocumentCompilationJobResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/bulk-jobs/<string:job_id>")
class KnowledgeFSServiceBulkJobApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "Agent Knowledge Base bulk job", service_api_ns.models[KnowledgeFSBulkJobResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id, operation_id="getBulkJob", resource_id=job_id
        )
        return _dump_response(KnowledgeFSBulkJobResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/queries/admission")
class KnowledgeFSServiceQueryAdmissionApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSQueryCreatePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base streaming query admitted through Dify API",
        service_api_ns.models[KnowledgeFSQueryAdmissionResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="createQuery", control_space_id=control_space_id)
        payload = _payload(KnowledgeFSQueryCreatePayload)
        if payload.query_images:
            validate_service_query_image_references(
                profile=profile,
                upload_file_ids=[image.upload_file_id for image in payload.query_images],
            )
        issued = runtime.broker.issue_service(profile=profile, operation_id="createQuery")
        admitted_request = KnowledgeFSAdmittedQueryRequest.model_validate(
            {**payload.model_dump(mode="json", by_alias=True), "knowledgeSpaceId": issued.knowledge_space_id}
        )
        return _dump_response(
            KnowledgeFSQueryAdmissionResponse,
            KnowledgeFSQueryAdmissionResponse(
                token=issued.token,
                trace_id=issued.trace_id,
                expires_at=issued.expires_at,
                operation_id="createQuery",
                request=admitted_request,
                url=_service_api_url(_QUERY_STREAM_PROXY_PATH),
            ),
        )


@service_api_ns.route(_QUERY_STREAM_PROXY_PATH)
class KnowledgeFSServiceQueryStreamProxyApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSAdmittedQueryRequest.__name__])
    @service_api_ns.doc(produces=["text/event-stream"])
    @service_api_ns.response(HTTPStatus.OK, "Agent Knowledge Base query event stream")
    @_service_api_errors
    def post(self):
        capability_token, trace_id = _stream_capability()
        payload = _payload(KnowledgeFSAdmittedQueryRequest)
        upstream = _runtime().facade.stream_query(
            capability_token=capability_token,
            trace_id=trace_id,
            payload=payload,
        )
        return _stream_response(upstream)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/settings")
class KnowledgeFSServiceSettingsApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base settings",
        service_api_ns.models[KnowledgeFSSettingsResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="getSettings", control_space_id=control_space_id)
        raw = runtime.facade.execute_service(profile=profile, operation_id="getSettings")
        return _dump_response(KnowledgeFSSettingsResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSettingsPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base settings updated",
        service_api_ns.models[KnowledgeFSSettingsUpdateResponse.__name__],
    )
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "Agent Knowledge Base settings migration accepted",
        service_api_ns.models[KnowledgeFSSettingsUpdateResponse.__name__],
    )
    @_service_api_errors
    def patch(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="updateSettings", control_space_id=control_space_id)
        result = runtime.facade.update_service_settings(profile=profile, payload=_payload(KnowledgeFSSettingsPayload))
        return _dump_response(KnowledgeFSSettingsUpdateResponse, result), (
            HTTPStatus.ACCEPTED if result.migration is not None else HTTPStatus.OK
        )


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources")
class KnowledgeFSServiceSourcesApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base sources",
        service_api_ns.models[KnowledgeFSSourceListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="listSources", control_space_id=control_space_id)
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        raw = runtime.facade.execute_service(
            profile=profile,
            operation_id="listSources",
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSSourceListResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSServiceSourceCreatePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.CREATED,
        "Agent Knowledge Base source created",
        service_api_ns.models[KnowledgeFSSourceResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="createSource", control_space_id=control_space_id)
        raw = runtime.facade.execute_service(
            profile=profile,
            operation_id="createSource",
            payload=_payload(KnowledgeFSServiceSourceCreatePayload),
        )
        return _dump_response(KnowledgeFSSourceResponse, raw), HTTPStatus.CREATED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>")
class KnowledgeFSServiceSourceApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "Agent Knowledge Base source", service_api_ns.models[KnowledgeFSSourceResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return _dump_response(KnowledgeFSSourceResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSServiceSourceUpdatePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK, "Agent Knowledge Base source updated", service_api_ns.models[KnowledgeFSSourceResponse.__name__]
    )
    @_service_api_errors
    def patch(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="updateSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=_payload(KnowledgeFSServiceSourceUpdatePayload),
        )
        return _dump_response(KnowledgeFSSourceResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceDeletePayload.__name__])
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSSourceDeleteQuery))
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "Agent Knowledge Base source deletion accepted",
        service_api_ns.models[KnowledgeFSDurableDeletionAcceptedResponse.__name__],
    )
    @_service_api_errors
    def delete(self, control_space_id: str, source_id: str):
        query = KnowledgeFSSourceDeleteQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="deleteSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=_payload(KnowledgeFSSourceDeletePayload),
            query=_query_pairs(query),
            headers=(("Idempotency-Key", _idempotency_key()),),
        )
        return _deletion_accepted(control_space_id, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/test")
class KnowledgeFSServiceSourceTestApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base source credential test",
        service_api_ns.models[KnowledgeFSSourceCredentialTestResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="testSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return _dump_response(KnowledgeFSSourceCredentialTestResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl")
class KnowledgeFSServiceSourceCrawlApi(Resource):
    @service_api_ns.doc(
        deprecated=True,
        params={
            "Idempotency-Key": {"in": "header", "required": True, "type": "string", "minLength": 8, "maxLength": 255}
        },
    )
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "Agent Knowledge Base source crawl",
        service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="previewSourceCrawl",
            headers=(("Idempotency-Key", _idempotency_key()),),
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/pages")
class KnowledgeFSServiceSourcePagesApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSSourcePagesQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base source pages",
        service_api_ns.models[KnowledgeFSSourcePagesResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, source_id: str):
        query = KnowledgeFSSourcePagesQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listSourcePages",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSSourcePagesResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/import")
class KnowledgeFSServiceSourcePageImportApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceImportPagesPayload.__name__])
    @service_api_ns.doc(
        deprecated=True,
        params={
            "Idempotency-Key": {"in": "header", "required": True, "type": "string", "minLength": 8, "maxLength": 255}
        },
    )
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "Agent Knowledge Base source pages imported",
        service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="importSourceWorkflow",
            headers=(("Idempotency-Key", _idempotency_key()),),
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=durable_page_import(_payload(KnowledgeFSSourceImportPagesPayload)),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/files")
class KnowledgeFSServiceSourceFilesApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSSourceFilesQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base source files",
        service_api_ns.models[KnowledgeFSSourceFilesResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, source_id: str):
        query = KnowledgeFSSourceFilesQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listSourceFiles",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSSourceFilesResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/import-files")
class KnowledgeFSServiceSourceFileImportApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceImportFilesPayload.__name__])
    @service_api_ns.doc(
        deprecated=True,
        params={
            "Idempotency-Key": {"in": "header", "required": True, "type": "string", "minLength": 8, "maxLength": 255}
        },
    )
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "Agent Knowledge Base source files imported",
        service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="importSourceWorkflow",
            headers=(("Idempotency-Key", _idempotency_key()),),
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=durable_file_import(_payload(KnowledgeFSSourceImportFilesPayload)),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks")
class KnowledgeFSServiceResearchTasksApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base research tasks",
        service_api_ns.models[KnowledgeFSResearchTaskListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="listResearchTasks", control_space_id=control_space_id)
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        raw = runtime.facade.execute_service(
            profile=profile,
            operation_id="listResearchTasks",
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSResearchTaskListResponse, raw)

    @service_api_ns.doc(
        params={
            "Idempotency-Key": {"in": "header", "required": False, "type": "string", "minLength": 8, "maxLength": 255}
        },
    )
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSResearchTaskCreatePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "Agent Knowledge Base research task accepted",
        service_api_ns.models[KnowledgeFSResearchTaskResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="createResearchTask",
            headers=(("Idempotency-Key", _idempotency_key()),) if "Idempotency-Key" in request.headers else (),
            payload=_payload(KnowledgeFSResearchTaskCreatePayload),
            bind_space_in_body=True,
        )
        return _dump_response(KnowledgeFSResearchTaskResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/plan")
class KnowledgeFSServiceResearchTaskPlanApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSResearchTaskPlanPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base research task plan",
        service_api_ns.models[KnowledgeFSResearchTaskPlanResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="planResearchTask",
            payload=_payload(KnowledgeFSResearchTaskPlanPayload),
            bind_space_in_body=True,
        )
        return _dump_response(KnowledgeFSResearchTaskPlanResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>")
class KnowledgeFSServiceResearchTaskApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base research task",
        service_api_ns.models[KnowledgeFSResearchTaskResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, task_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getResearchTask",
            resource_id=task_id,
        )
        return _dump_response(KnowledgeFSResearchTaskResponse, raw)

    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base research task canceled",
        service_api_ns.models[KnowledgeFSResearchTaskResponse.__name__],
    )
    @_service_api_errors
    def delete(self, control_space_id: str, task_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="cancelResearchTask",
            resource_id=task_id,
        )
        return _dump_response(KnowledgeFSResearchTaskResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>/partials")
class KnowledgeFSServiceResearchTaskPartialsApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSResearchTaskPartialsQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base research task partial evidence",
        service_api_ns.models[KnowledgeFSResearchTaskPartialListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, task_id: str):
        query = KnowledgeFSResearchTaskPartialsQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listResearchTaskPartials",
            resource_id=task_id,
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSResearchTaskPartialListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces")
class KnowledgeFSServiceTracesApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSTraceListQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base traces",
        service_api_ns.models[KnowledgeFSTraceListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="listTraces", control_space_id=control_space_id)
        query = KnowledgeFSTraceListQuery.model_validate(request.args.to_dict())
        raw = runtime.facade.execute_service(
            profile=profile,
            operation_id="listTraces",
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSTraceListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>")
class KnowledgeFSServiceTraceApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base answer trace",
        service_api_ns.models[KnowledgeFSAnswerTraceResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, trace_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getTrace",
            resource_id=trace_id,
            path_parameters=(("traceId", trace_id),),
        )
        return _dump_response(KnowledgeFSAnswerTraceResponse, raw)


def _service_trace_entries(*, control_space_id: str, trace_id: str, kind: Literal["conflicts", "evidence", "missing"]):
    query = KnowledgeFSTraceEntriesQuery.model_validate(request.args.to_dict())
    operation_id = {
        "conflicts": "listTraceConflicts",
        "evidence": "listTraceEvidence",
        "missing": "listTraceMissing",
    }[kind]
    raw = _execute_service_operation(
        control_space_id=control_space_id,
        operation_id=operation_id,
        resource_id=trace_id,
        path_parameters=(("traceId", trace_id),),
        query=_query_pairs(query),
    )
    return _dump_response(KnowledgeFSTraceEntryListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/evidence")
class KnowledgeFSServiceTraceEvidenceApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSTraceEntriesQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base trace evidence view",
        service_api_ns.models[KnowledgeFSTraceEntryListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, trace_id: str):
        return _service_trace_entries(control_space_id=control_space_id, trace_id=trace_id, kind="evidence")


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/conflicts")
class KnowledgeFSServiceTraceConflictsApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSTraceEntriesQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base trace conflicts",
        service_api_ns.models[KnowledgeFSTraceEntryListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, trace_id: str):
        return _service_trace_entries(control_space_id=control_space_id, trace_id=trace_id, kind="conflicts")


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/missing")
class KnowledgeFSServiceTraceMissingApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSTraceEntriesQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base trace missing evidence",
        service_api_ns.models[KnowledgeFSTraceEntryListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, trace_id: str):
        return _service_trace_entries(control_space_id=control_space_id, trace_id=trace_id, kind="missing")


__all__ = [
    "KnowledgeFSServiceDocumentsApi",
    "KnowledgeFSServiceResearchTasksApi",
    "KnowledgeFSServiceSettingsApi",
    "KnowledgeFSServiceSourcesApi",
    "KnowledgeFSServiceTracesApi",
]


def _deletion_accepted(control_space_id: str, raw: JsonValue):
    result = _upstream_model(KnowledgeFSDurableDeletionAcceptedResponse, raw)
    result.status_url = _service_api_url(f"/knowledge-fs/spaces/{control_space_id}/deletion-jobs/{result.job.id}")
    return (
        _dump_response(KnowledgeFSDurableDeletionAcceptedResponse, result),
        HTTPStatus.ACCEPTED,
        {"Location": result.status_url},
    )


def _bulk_deletion_accepted(control_space_id: str, raw: JsonValue):
    result = _upstream_model(KnowledgeFSBulkDeletionAcceptedResponse, raw)
    _rewrite_deletion_batch_urls(control_space_id, result)
    headers = {"Location": result.status_url} if result.status_url else {}
    return _dump_response(KnowledgeFSBulkDeletionAcceptedResponse, result), HTTPStatus.ACCEPTED, headers


def _rewrite_deletion_batch_urls(control_space_id: str, result: KnowledgeFSBulkDeletionAcceptedResponse) -> None:
    if result.batch_id:
        result.status_url = _service_api_url(
            f"/knowledge-fs/spaces/{control_space_id}/deletion-batches/{result.batch_id}"
        )
    for item in result.items:
        item.status_url = _service_api_url(f"/knowledge-fs/spaces/{control_space_id}/deletion-jobs/{item.job.id}")
    for outcome in result.results:
        outcome.status_url = (
            _service_api_url(f"/knowledge-fs/spaces/{control_space_id}/deletion-jobs/{outcome.job.id}")
            if outcome.job
            else None
        )


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/logical-documents")
class KnowledgeFSServiceLogicalDocumentsApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK, "listLogicalDocuments", service_api_ns.models[KnowledgeFSLogicalDocumentListResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listLogicalDocuments",
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSLogicalDocumentListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>")
class KnowledgeFSServiceLogicalDocumentApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "getLogicalDocument", service_api_ns.models[KnowledgeFSLogicalDocumentResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, document_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getLogicalDocument",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
        )
        return _dump_response(KnowledgeFSLogicalDocumentResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/document-references/resolve")
class KnowledgeFSServiceDocumentReferenceApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSDocumentReferenceQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "resolveDocumentReference",
        service_api_ns.models[KnowledgeFSResolvedDocumentReferenceResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        query = KnowledgeFSDocumentReferenceQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="resolveDocumentReference",
            query=(
                ("documentAssetId", query.document_asset_id),
                ("documentAssetVersion", str(query.document_asset_version)),
            ),
        )
        return _dump_response(KnowledgeFSResolvedDocumentReferenceResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/deletion-jobs/<string:job_id>")
class KnowledgeFSServiceDeletionJobApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "getDeletionJob", service_api_ns.models[KnowledgeFSDurableDeletionJobResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getDeletionJob",
            resource_id=job_id,
            path_parameters=(("jobId", job_id),),
        )
        return _dump_response(KnowledgeFSDurableDeletionJobResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/deletion-jobs/<string:job_id>/retry")
class KnowledgeFSServiceDeletionJobRetryApi(Resource):
    @service_api_ns.doc(
        params={
            "Idempotency-Key": {"in": "header", "required": True, "type": "string", "minLength": 8, "maxLength": 255}
        }
    )
    @service_api_ns.response(
        HTTPStatus.OK, "retryDeletionJob", service_api_ns.models[KnowledgeFSDurableDeletionJobResponse.__name__]
    )
    @_service_api_errors
    def post(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="retryDeletionJob",
            path_parameters=(("jobId", job_id),),
            headers=(("Idempotency-Key", _idempotency_key()),),
            resource_id=job_id,
        )
        return _dump_response(KnowledgeFSDurableDeletionJobResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>/resume")
class KnowledgeFSServiceResearchTaskResumeApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "resumeResearchTask", service_api_ns.models[KnowledgeFSResearchTaskResponse.__name__]
    )
    @_service_api_errors
    def post(self, control_space_id: str, task_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="resumeResearchTask",
            resource_id=task_id,
        )
        return _dump_response(KnowledgeFSResearchTaskResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/background-tasks")
class KnowledgeFSServiceBackgroundTasksApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSBackgroundTaskListQuery))
    @service_api_ns.response(
        HTTPStatus.OK, "listBackgroundTasks", service_api_ns.models[KnowledgeFSBackgroundTaskListResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        query = KnowledgeFSBackgroundTaskListQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listBackgroundTasks",
            query=tuple(("taskIds" if name == "task_ids" else name, value) for name, value in _query_pairs(query)),
        )
        return _dump_response(KnowledgeFSBackgroundTaskListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/settings/migrations/<string:migration_id>")
class KnowledgeFSServiceSettingsMigrationApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "getProfileMigration", service_api_ns.models[KnowledgeFSProfileMigrationResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, migration_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getProfileMigration",
            path_parameters=(("migrationId", migration_id),),
        )
        return _dump_response(KnowledgeFSProfileMigrationResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/sync")
class KnowledgeFSServiceSourceSyncApi(Resource):
    @service_api_ns.doc(
        params={
            "Idempotency-Key": {"in": "header", "required": True, "type": "string", "minLength": 8, "maxLength": 255}
        }
    )
    @service_api_ns.response(
        HTTPStatus.ACCEPTED, "syncSource", service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__]
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="syncSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            headers=(("Idempotency-Key", _idempotency_key()),),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl-preview")
class KnowledgeFSServiceSourceCrawlPreviewApi(Resource):
    @service_api_ns.doc(
        params={
            "Idempotency-Key": {"in": "header", "required": True, "type": "string", "minLength": 8, "maxLength": 255}
        }
    )
    @service_api_ns.response(
        HTTPStatus.ACCEPTED, "previewSourceCrawl", service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__]
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="previewSourceCrawl",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            headers=(("Idempotency-Key", _idempotency_key()),),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl-import")
class KnowledgeFSServiceSourceCrawlImportApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSCrawlImportPayload.__name__])
    @service_api_ns.doc(
        params={
            "Idempotency-Key": {"in": "header", "required": True, "type": "string", "minLength": 8, "maxLength": 255}
        }
    )
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "importSelectedSourceCrawl",
        service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="importSelectedSourceCrawl",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=_payload(KnowledgeFSCrawlImportPayload),
            headers=(("Idempotency-Key", _idempotency_key()),),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/workflow-imports")
class KnowledgeFSServiceSourceWorkflowImportApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceWorkflowImportPayload.__name__])
    @service_api_ns.doc(
        params={
            "Idempotency-Key": {"in": "header", "required": True, "type": "string", "minLength": 8, "maxLength": 255}
        }
    )
    @service_api_ns.response(
        HTTPStatus.ACCEPTED, "importSourceWorkflow", service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__]
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="importSourceWorkflow",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=_payload(KnowledgeFSSourceWorkflowImportPayload),
            headers=(("Idempotency-Key", _idempotency_key()),),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/sync-policy")
class KnowledgeFSServiceSourceSyncPolicyApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "getSourceSyncPolicy", service_api_ns.models[KnowledgeFSSourceSyncPolicyResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getSourceSyncPolicy",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return _dump_response(KnowledgeFSSourceSyncPolicyResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceSyncPolicyPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK, "updateSourceSyncPolicy", service_api_ns.models[KnowledgeFSSourceSyncPolicyResponse.__name__]
    )
    @_service_api_errors
    def put(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="updateSourceSyncPolicy",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=_payload(KnowledgeFSSourceSyncPolicyPayload),
        )
        return _dump_response(KnowledgeFSSourceSyncPolicyResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-connections")
class KnowledgeFSServiceSourceConnectionsApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSSourceConnectionListQuery))
    @service_api_ns.response(
        HTTPStatus.OK, "listSourceConnections", service_api_ns.models[KnowledgeFSSourceConnectionListResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        query = KnowledgeFSSourceConnectionListQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listSourceConnections",
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSSourceConnectionListResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSServiceSourceConnectionCreatePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.CREATED,
        "createSourceConnection",
        service_api_ns.models[KnowledgeFSSourceConnectionResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="createSourceConnection",
            payload=_payload(KnowledgeFSServiceSourceConnectionCreatePayload),
        )
        return _dump_response(KnowledgeFSSourceConnectionResponse, raw), HTTPStatus.CREATED


@service_api_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/source-connections/<string:connection_id>/refresh"
)
class KnowledgeFSServiceSourceConnectionRefreshApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceConnectionRefreshPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK, "refreshSourceConnection", service_api_ns.models[KnowledgeFSSourceConnectionResponse.__name__]
    )
    @_service_api_errors
    def post(self, control_space_id: str, connection_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="refreshSourceConnection",
            path_parameters=(("connectionId", connection_id),),
            payload=_payload(KnowledgeFSSourceConnectionRefreshPayload),
        )
        return _dump_response(KnowledgeFSSourceConnectionResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows")
class KnowledgeFSServiceSourceWorkflowsApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSSourceWorkflowListQuery))
    @service_api_ns.response(
        HTTPStatus.OK, "listSourceWorkflows", service_api_ns.models[KnowledgeFSSourceWorkflowListResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        query = KnowledgeFSSourceWorkflowListQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listSourceWorkflows",
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSSourceWorkflowListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>")
class KnowledgeFSServiceSourceWorkflowApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "getSourceWorkflow", service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, run_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getSourceWorkflow",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/cancel")
class KnowledgeFSServiceSourceWorkflowCancelApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceWorkflowCancelPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK, "cancelSourceWorkflow", service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__]
    )
    @_service_api_errors
    def post(self, control_space_id: str, run_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="cancelSourceWorkflow",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
            payload=_payload(KnowledgeFSSourceWorkflowCancelPayload),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/retry")
class KnowledgeFSServiceSourceWorkflowRetryApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "retrySourceWorkflow", service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__]
    )
    @_service_api_errors
    def post(self, control_space_id: str, run_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="retrySourceWorkflow",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/pages")
class KnowledgeFSServiceCrawlPreviewPagesApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCrawlPreviewPageListQuery))
    @service_api_ns.response(
        HTTPStatus.OK, "listCrawlPreviewPages", service_api_ns.models[KnowledgeFSCrawlPreviewPageListResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, run_id: str):
        query = KnowledgeFSCrawlPreviewPageListQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listCrawlPreviewPages",
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSCrawlPreviewPageListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-workflows/<string:run_id>/selection")
class KnowledgeFSServiceCrawlPreviewSelectionApi(Resource):
    @service_api_ns.doc(
        params={
            "Idempotency-Key": {"in": "header", "required": True, "type": "string", "minLength": 8, "maxLength": 255}
        },
    )
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSCrawlPreviewSelectionPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "selectCrawlPreviewPages",
        service_api_ns.models[KnowledgeFSSourceWorkflowResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, run_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="selectCrawlPreviewPages",
            headers=(("Idempotency-Key", _idempotency_key()),),
            resource_id=run_id,
            path_parameters=(("runId", run_id),),
            payload=_payload(KnowledgeFSCrawlPreviewSelectionPayload),
        )
        return _dump_response(KnowledgeFSSourceWorkflowResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/deletion-batches/<string:batch_id>")
class KnowledgeFSServiceDeletionBatchApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "Deletion batch status", service_api_ns.models[KnowledgeFSBulkDeletionAcceptedResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, batch_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getDeletionBatch",
            resource_id=batch_id,
            path_parameters=(("batchId", batch_id),),
        )
        result = _upstream_model(KnowledgeFSBulkDeletionAcceptedResponse, raw)
        _rewrite_deletion_batch_urls(control_space_id, result)
        return _dump_response(KnowledgeFSBulkDeletionAcceptedResponse, result)


@service_api_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>/processing-tasks"
)
class KnowledgeFSServiceDocumentProcessingTasksApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "Document processing history",
        service_api_ns.models[KnowledgeFSDocumentProcessingTaskListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, document_id: str):
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="listDocumentProcessingTasks",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
            query=_query_pairs(query),
        )
        return _dump_response(KnowledgeFSDocumentProcessingTaskListResponse, raw)


@service_api_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/logical-documents/<string:document_id>/processing-tasks/<string:task_id>"
)
class KnowledgeFSServiceDocumentProcessingTaskApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Document processing task",
        service_api_ns.models[KnowledgeFSDocumentProcessingTaskResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, document_id: str, task_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getDocumentProcessingTask",
            resource_id=task_id,
            path_parameters=(("documentId", document_id), ("taskId", task_id)),
        )
        return _dump_response(KnowledgeFSDocumentProcessingTaskResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/source-providers")
class KnowledgeFSServiceSourceProvidersApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "Source providers",
        service_api_ns.models[KnowledgeFSSourceProviderListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        raw = _execute_service_operation(control_space_id=control_space_id, operation_id="listSourceProviders")
        return _dump_response(KnowledgeFSSourceProviderListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/query-images")
class KnowledgeFSServiceQueryImagesApi(Resource):
    @service_api_ns.doc(
        consumes=["multipart/form-data"],
        params={"file": {"in": "formData", "type": "file", "required": True}},
    )
    @service_api_ns.response(
        HTTPStatus.CREATED,
        "Query image uploaded",
        service_api_ns.models[KnowledgeFSServiceQueryImageUploadResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="createQuery", control_space_id=control_space_id)
        raw = upload_service_query_image(profile=profile, file=request.files.get("file"))
        return _dump_response(KnowledgeFSServiceQueryImageUploadResponse, raw), HTTPStatus.CREATED
