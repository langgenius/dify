"""KnowledgeFS Service API routes; no Dataset token or model is used."""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from http import HTTPStatus
from typing import Literal

from flask import request
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
    KnowledgeFSServiceInvalidRequestHTTPError,
    KnowledgeFSServiceOperationUnavailableHTTPError,
    KnowledgeFSServiceQuotaExceededHTTPError,
    KnowledgeFSServiceRateLimitHTTPError,
    KnowledgeFSServiceUpstreamUnavailableHTTPError,
)
from core.db.session_factory import session_factory
from libs.helper import dump_response
from services.knowledge_fs.credential_service import (
    KnowledgeFSCredentialValidationError,
    KnowledgeFSServiceCredentialProfile,
)
from services.knowledge_fs.operation_admission import (
    KnowledgeFSOperationQuotaExceededError,
    KnowledgeFSOperationRateLimitExceededError,
)
from services.knowledge_fs.product_dto import (
    KnowledgeFSAdmittedQueryRequest,
    KnowledgeFSAnswerTraceResponse,
    KnowledgeFSBulkDeletionAcceptedResponse,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSBulkJobResponse,
    KnowledgeFSCursorQuery,
    KnowledgeFSDocumentChunkListQuery,
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
    KnowledgeFSIdempotencyHeader,
    KnowledgeFSLogicalDocumentResponse,
    KnowledgeFSQueryAdmissionResponse,
    KnowledgeFSQueryCreatePayload,
    KnowledgeFSQueryResponse,
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskListResponse,
    KnowledgeFSResearchTaskPartialListResponse,
    KnowledgeFSResearchTaskPartialsQuery,
    KnowledgeFSResearchTaskPlanPayload,
    KnowledgeFSResearchTaskPlanResponse,
    KnowledgeFSResearchTaskResponse,
    KnowledgeFSSettingsPayload,
    KnowledgeFSSettingsResponse,
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
    KnowledgeFSSourceResponse,
    KnowledgeFSSourceUpdatePayload,
    KnowledgeFSTraceEntriesQuery,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSTraceListResponse,
)
from services.knowledge_fs.product_operations import product_operation_action
from services.knowledge_fs.product_remote import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRemoteError,
)
from services.knowledge_fs.runtime import KnowledgeFSRuntime, create_knowledge_fs_runtime

register_schema_models(
    service_api_ns,
    KnowledgeFSBulkDocumentDeletePayload,
    KnowledgeFSCursorQuery,
    KnowledgeFSDocumentChunkListQuery,
    KnowledgeFSDocumentCreatePayload,
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
    KnowledgeFSQueryResponse,
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
    KnowledgeFSSourceResponse,
    KnowledgeFSTraceEntryListResponse,
    KnowledgeFSTraceListResponse,
)


def _runtime() -> KnowledgeFSRuntime:
    if not dify_config.KNOWLEDGE_FS_ENABLED:
        raise NotFound()
    return create_knowledge_fs_runtime(session_factory.get_session_maker())


def _service_api_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except KnowledgeFSCredentialValidationError as exc:
            raise KnowledgeFSInvalidCredentialHTTPError() from exc
        except KnowledgeFSOperationUnavailableError as exc:
            raise KnowledgeFSServiceOperationUnavailableHTTPError() from exc
        except KnowledgeFSProductRemoteError as exc:
            raise KnowledgeFSServiceUpstreamUnavailableHTTPError() from exc
        except KnowledgeFSOperationRateLimitExceededError as exc:
            raise KnowledgeFSServiceRateLimitHTTPError() from exc
        except KnowledgeFSOperationQuotaExceededError as exc:
            raise KnowledgeFSServiceQuotaExceededHTTPError() from exc
        except ValidationError as exc:
            raise KnowledgeFSServiceInvalidRequestHTTPError() from exc

    return decorated


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


def _raw_bearer_credential() -> str:
    scheme, separator, credential = request.headers.get("Authorization", "").partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not credential.strip():
        raise KnowledgeFSInvalidCredentialHTTPError()
    return credential.strip()


def _profile(
    runtime: KnowledgeFSRuntime,
    *,
    operation_id: str,
    control_space_id: str,
) -> KnowledgeFSServiceCredentialProfile:
    try:
        required_action = product_operation_action(operation_id)
    except KeyError as exc:
        raise KnowledgeFSOperationUnavailableError(f"KnowledgeFS operation is unavailable: {operation_id}") from exc
    profile = runtime.credentials.validate_service_credential(
        raw_credential=_raw_bearer_credential(),
        required_action=required_action,
    )
    if profile.control_space_id != control_space_id:
        raise KnowledgeFSCredentialValidationError("Invalid KnowledgeFS service credential")
    return profile


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
        "KnowledgeFS documents",
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
            query=(("cursor", query.cursor),) if query.cursor else (),
        )
        return dump_response(KnowledgeFSDocumentListResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSDocumentCreatePayload.__name__])
    @service_api_ns.doc(deprecated=True)
    @service_api_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS document created",
        service_api_ns.models[KnowledgeFSDocumentResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        _ = control_space_id
        raise KnowledgeFSOperationUnavailableError(
            "Buffered KnowledgeFS document creation is deprecated; use the P6 direct-upload capability flow"
        )


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/bulk")
class KnowledgeFSServiceBulkDocumentsApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSBulkDocumentDeletePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS document deletions accepted",
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
        return dump_response(KnowledgeFSBulkDeletionAcceptedResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/reindex")
class KnowledgeFSServiceDocumentReindexApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSDocumentReindexPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document reindex queued",
        service_api_ns.models[KnowledgeFSDocumentReindexResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="reindexDocuments",
            payload=_payload(KnowledgeFSDocumentReindexPayload),
        )
        return dump_response(KnowledgeFSDocumentReindexResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>")
class KnowledgeFSServiceDocumentApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "KnowledgeFS document", service_api_ns.models[KnowledgeFSDocumentResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, document_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getDocument",
            resource_id=document_id,
            path_parameters=(("documentId", document_id),),
        )
        return dump_response(KnowledgeFSDocumentResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSDocumentMetadataPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document metadata updated",
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
        return dump_response(KnowledgeFSLogicalDocumentResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSDocumentDeletePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS document deletion accepted",
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
        return dump_response(KnowledgeFSDurableDeletionAcceptedResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/outline")
class KnowledgeFSServiceDocumentOutlineApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document outline",
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
        return dump_response(KnowledgeFSDocumentOutlineResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions")
class KnowledgeFSServiceDocumentRevisionsApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document revisions",
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
        return dump_response(KnowledgeFSDocumentRevisionListResponse, raw)


@service_api_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions/<int:revision>/chunks"
)
class KnowledgeFSServiceDocumentChunksApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSDocumentChunkListQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document chunks",
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
        return dump_response(KnowledgeFSDocumentChunkListResponse, raw)


@service_api_ns.route(
    "/knowledge-fs/spaces/<string:control_space_id>/documents/<string:document_id>/revisions/<int:revision>/chunks/<string:chunk_id>"
)
class KnowledgeFSServiceDocumentChunkApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS document chunk",
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
        return dump_response(KnowledgeFSDocumentChunkResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/jobs/<string:job_id>")
class KnowledgeFSServiceCompilationJobApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS compilation job",
        service_api_ns.models[KnowledgeFSDocumentCompilationJobResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id, operation_id="getCompilationJob", resource_id=job_id
        )
        return dump_response(KnowledgeFSDocumentCompilationJobResponse, raw)

    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS compilation job canceled",
        service_api_ns.models[KnowledgeFSDocumentCompilationJobResponse.__name__],
    )
    @_service_api_errors
    def delete(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id, operation_id="cancelCompilationJob", resource_id=job_id
        )
        return dump_response(KnowledgeFSDocumentCompilationJobResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/jobs/<string:job_id>/retry")
class KnowledgeFSServiceCompilationJobRetryApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS compilation job retried",
        service_api_ns.models[KnowledgeFSDocumentCompilationJobResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id, operation_id="retryCompilationJob", resource_id=job_id
        )
        return dump_response(KnowledgeFSDocumentCompilationJobResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/bulk-jobs/<string:job_id>")
class KnowledgeFSServiceBulkJobApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "KnowledgeFS bulk job", service_api_ns.models[KnowledgeFSBulkJobResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, job_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id, operation_id="getBulkJob", resource_id=job_id
        )
        return dump_response(KnowledgeFSBulkJobResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/queries")
class KnowledgeFSServiceQueriesApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSQueryCreatePayload.__name__])
    @service_api_ns.doc(deprecated=True)
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS query accepted",
        service_api_ns.models[KnowledgeFSQueryResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        _ = control_space_id
        raise KnowledgeFSOperationUnavailableError(
            "Buffered KnowledgeFS query creation is deprecated; use the queries/admission direct flow"
        )


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/queries/admission")
class KnowledgeFSServiceQueryAdmissionApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSQueryCreatePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS direct query admitted",
        service_api_ns.models[KnowledgeFSQueryAdmissionResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        direct_origin = dify_config.KNOWLEDGE_FS_DIRECT_ORIGIN
        if direct_origin is None:
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS direct query streaming is not configured")
        runtime = _runtime()
        profile = _profile(runtime, operation_id="createQuery", control_space_id=control_space_id)
        payload = _payload(KnowledgeFSQueryCreatePayload)
        issued = runtime.direct_operation_admission.issue_service(profile=profile, operation_id="createQuery")
        admitted_request = KnowledgeFSAdmittedQueryRequest.model_validate(
            {**payload.model_dump(mode="json", by_alias=True), "knowledgeSpaceId": issued.knowledge_space_id}
        )
        return dump_response(
            KnowledgeFSQueryAdmissionResponse,
            KnowledgeFSQueryAdmissionResponse(
                token=issued.token,
                expires_at=issued.expires_at,
                operation_id="createQuery",
                request=admitted_request,
                url=f"{direct_origin.rstrip('/')}/queries",
            ),
        )


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/settings")
class KnowledgeFSServiceSettingsApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS settings",
        service_api_ns.models[KnowledgeFSSettingsResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="getSettings", control_space_id=control_space_id)
        raw = runtime.facade.execute_service(profile=profile, operation_id="getSettings")
        return dump_response(KnowledgeFSSettingsResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSettingsPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS settings updated",
        service_api_ns.models[KnowledgeFSSettingsResponse.__name__],
    )
    @_service_api_errors
    def patch(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="updateSettings", control_space_id=control_space_id)
        raw = runtime.facade.execute_service(
            profile=profile,
            operation_id="updateSettings",
            payload=_payload(KnowledgeFSSettingsPayload),
        )
        return dump_response(KnowledgeFSSettingsResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources")
class KnowledgeFSServiceSourcesApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS sources",
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
            query=(("cursor", query.cursor),) if query.cursor else (),
        )
        return dump_response(KnowledgeFSSourceListResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceCreatePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.CREATED,
        "KnowledgeFS source created",
        service_api_ns.models[KnowledgeFSSourceResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="createSource", control_space_id=control_space_id)
        raw = runtime.facade.execute_service(
            profile=profile,
            operation_id="createSource",
            payload=_payload(KnowledgeFSSourceCreatePayload),
        )
        return dump_response(KnowledgeFSSourceResponse, raw), HTTPStatus.CREATED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>")
class KnowledgeFSServiceSourceApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "KnowledgeFS source", service_api_ns.models[KnowledgeFSSourceResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return dump_response(KnowledgeFSSourceResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceUpdatePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK, "KnowledgeFS source updated", service_api_ns.models[KnowledgeFSSourceResponse.__name__]
    )
    @_service_api_errors
    def patch(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="updateSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=_payload(KnowledgeFSSourceUpdatePayload),
        )
        return dump_response(KnowledgeFSSourceResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceDeletePayload.__name__])
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSSourceDeleteQuery))
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS source deletion accepted",
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
        return dump_response(KnowledgeFSDurableDeletionAcceptedResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/test")
class KnowledgeFSServiceSourceTestApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source credential test",
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
        return dump_response(KnowledgeFSSourceCredentialTestResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/crawl")
class KnowledgeFSServiceSourceCrawlApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "KnowledgeFS source crawl", service_api_ns.models[KnowledgeFSSourceCrawlResponse.__name__]
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="crawlSource",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
        )
        return dump_response(KnowledgeFSSourceCrawlResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/pages")
class KnowledgeFSServiceSourcePagesApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSSourcePagesQuery))
    @service_api_ns.response(
        HTTPStatus.OK, "KnowledgeFS source pages", service_api_ns.models[KnowledgeFSSourcePagesResponse.__name__]
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
        return dump_response(KnowledgeFSSourcePagesResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/import")
class KnowledgeFSServiceSourcePageImportApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceImportPagesPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source pages imported",
        service_api_ns.models[KnowledgeFSSourceImportResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="importSourcePages",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=_payload(KnowledgeFSSourceImportPagesPayload),
        )
        return dump_response(KnowledgeFSSourceImportResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/files")
class KnowledgeFSServiceSourceFilesApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSSourceFilesQuery))
    @service_api_ns.response(
        HTTPStatus.OK, "KnowledgeFS source files", service_api_ns.models[KnowledgeFSSourceFilesResponse.__name__]
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
        return dump_response(KnowledgeFSSourceFilesResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/sources/<string:source_id>/import-files")
class KnowledgeFSServiceSourceFileImportApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSSourceImportFilesPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS source files imported",
        service_api_ns.models[KnowledgeFSSourceImportResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str, source_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="importSourceFiles",
            resource_id=source_id,
            path_parameters=(("sourceId", source_id),),
            payload=_payload(KnowledgeFSSourceImportFilesPayload),
        )
        return dump_response(KnowledgeFSSourceImportResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks")
class KnowledgeFSServiceResearchTasksApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research tasks",
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
            query=(("cursor", query.cursor),) if query.cursor else (),
        )
        return dump_response(KnowledgeFSResearchTaskListResponse, raw)

    @service_api_ns.expect(service_api_ns.models[KnowledgeFSResearchTaskCreatePayload.__name__])
    @service_api_ns.response(
        HTTPStatus.ACCEPTED,
        "KnowledgeFS research task accepted",
        service_api_ns.models[KnowledgeFSResearchTaskResponse.__name__],
    )
    @_service_api_errors
    def post(self, control_space_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="createResearchTask",
            payload=_payload(KnowledgeFSResearchTaskCreatePayload),
            bind_space_in_body=True,
        )
        return dump_response(KnowledgeFSResearchTaskResponse, raw), HTTPStatus.ACCEPTED


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/plan")
class KnowledgeFSServiceResearchTaskPlanApi(Resource):
    @service_api_ns.expect(service_api_ns.models[KnowledgeFSResearchTaskPlanPayload.__name__])
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research task plan",
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
        return dump_response(KnowledgeFSResearchTaskPlanResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>")
class KnowledgeFSServiceResearchTaskApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research task",
        service_api_ns.models[KnowledgeFSResearchTaskResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, task_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getResearchTask",
            resource_id=task_id,
        )
        return dump_response(KnowledgeFSResearchTaskResponse, raw)

    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research task canceled",
        service_api_ns.models[KnowledgeFSResearchTaskResponse.__name__],
    )
    @_service_api_errors
    def delete(self, control_space_id: str, task_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="cancelResearchTask",
            resource_id=task_id,
        )
        return dump_response(KnowledgeFSResearchTaskResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/research-tasks/<string:task_id>/partials")
class KnowledgeFSServiceResearchTaskPartialsApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSResearchTaskPartialsQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS research task partial evidence",
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
        return dump_response(KnowledgeFSResearchTaskPartialListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces")
class KnowledgeFSServiceTracesApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSCursorQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS traces",
        service_api_ns.models[KnowledgeFSTraceListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str):
        runtime = _runtime()
        profile = _profile(runtime, operation_id="listTraces", control_space_id=control_space_id)
        query = KnowledgeFSCursorQuery.model_validate(request.args.to_dict())
        raw = runtime.facade.execute_service(
            profile=profile,
            operation_id="listTraces",
            query=(("cursor", query.cursor),) if query.cursor else (),
        )
        return dump_response(KnowledgeFSTraceListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>")
class KnowledgeFSServiceTraceApi(Resource):
    @service_api_ns.response(
        HTTPStatus.OK, "KnowledgeFS answer trace", service_api_ns.models[KnowledgeFSAnswerTraceResponse.__name__]
    )
    @_service_api_errors
    def get(self, control_space_id: str, trace_id: str):
        raw = _execute_service_operation(
            control_space_id=control_space_id,
            operation_id="getTrace",
            resource_id=trace_id,
            path_parameters=(("traceId", trace_id),),
        )
        return dump_response(KnowledgeFSAnswerTraceResponse, raw)


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
    return dump_response(KnowledgeFSTraceEntryListResponse, raw)


@service_api_ns.route("/knowledge-fs/spaces/<string:control_space_id>/traces/<string:trace_id>/evidence")
class KnowledgeFSServiceTraceEvidenceApi(Resource):
    @service_api_ns.doc(params=query_params_from_model(KnowledgeFSTraceEntriesQuery))
    @service_api_ns.response(
        HTTPStatus.OK,
        "KnowledgeFS trace evidence view",
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
        "KnowledgeFS trace conflicts",
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
        "KnowledgeFS trace missing evidence",
        service_api_ns.models[KnowledgeFSTraceEntryListResponse.__name__],
    )
    @_service_api_errors
    def get(self, control_space_id: str, trace_id: str):
        return _service_trace_entries(control_space_id=control_space_id, trace_id=trace_id, kind="missing")


__all__ = [
    "KnowledgeFSServiceDocumentsApi",
    "KnowledgeFSServiceQueriesApi",
    "KnowledgeFSServiceResearchTasksApi",
    "KnowledgeFSServiceSettingsApi",
    "KnowledgeFSServiceSourcesApi",
    "KnowledgeFSServiceTracesApi",
]
