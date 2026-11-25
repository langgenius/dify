"""Authenticated Tidy Console transport; all domain work remains in KnowledgeFS."""

from http import HTTPStatus

from flask import request
from flask_restx import Resource

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.knowledge_fs.error import KnowledgeFSResourceNotFoundHTTPError
from controllers.console.knowledge_fs.resources import (
    _SPACE_CALL_ERRORS,
    KnowledgeFSConflictHTTPError,
    KnowledgeFSStagedUploadScanBlockedError,
    _actor,
    _console_services,
    _knowledge_fs_errors,
)
from controllers.console.wraps import account_initialization_required, setup_required
from libs.exception import RelayedHTTPError
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import login_required
from services.file_scan import FileScanService, ScanScope
from services.file_scan.entities import SCOPE_KNOWLEDGE_FS_SPACE
from services.knowledge_fs.download_service import KnowledgeFSDownloadService
from services.knowledge_fs.errors import KnowledgeFSProductRemoteError, KnowledgeFSProductRequestRejectedError
from services.knowledge_fs.product_remote import KnowledgeFSRemoteMultipartFile
from services.knowledge_fs.tidy_dto import (
    KnowledgeFSTidyActionPayload,
    KnowledgeFSTidyFindingListResponse,
    KnowledgeFSTidyFindingQuery,
    KnowledgeFSTidyFindingResponse,
    KnowledgeFSTidyRetryResponse,
    KnowledgeFSTidyRewritePayload,
    KnowledgeFSTidyRewriteResponse,
    KnowledgeFSTidyScanListResponse,
    KnowledgeFSTidyScanQuery,
    KnowledgeFSTidySettingsPayload,
    KnowledgeFSTidySettingsResponse,
    KnowledgeFSTidySummaryResponse,
)
from services.knowledge_fs.tidy_rewrite import KnowledgeFSTidyRewriteError, prepare_tidy_rewrite

register_schema_models(
    console_ns,
    KnowledgeFSTidySettingsPayload,
    KnowledgeFSTidyActionPayload,
    KnowledgeFSTidyRewritePayload,
    KnowledgeFSTidyFindingQuery,
    KnowledgeFSTidyScanQuery,
)
register_response_schema_models(
    console_ns,
    KnowledgeFSTidySettingsResponse,
    KnowledgeFSTidySummaryResponse,
    KnowledgeFSTidyFindingResponse,
    KnowledgeFSTidyFindingListResponse,
    KnowledgeFSTidyScanListResponse,
    KnowledgeFSTidyRetryResponse,
    KnowledgeFSTidyRewriteResponse,
)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/tidy/settings")
class KnowledgeFSTidySettingsApi(Resource):
    @error_responses(*_SPACE_CALL_ERRORS, KnowledgeFSResourceNotFoundHTTPError)
    @console_ns.response(200, "Tidy result", console_ns.models[KnowledgeFSTidySettingsResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        """Validate admitted input, forward scoped operation, and preserve upstream errors."""
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_tidy_settings(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id
        )
        return dump_response(KnowledgeFSTidySettingsResponse, result)

    @error_responses(*_SPACE_CALL_ERRORS, KnowledgeFSResourceNotFoundHTTPError)
    @console_ns.response(200, "Tidy result", console_ns.models[KnowledgeFSTidySettingsResponse.__name__])
    @console_ns.expect(console_ns.models[KnowledgeFSTidySettingsPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def patch(self, control_space_id: str):
        """Validate admitted input, forward scoped operation, and preserve upstream errors."""
        actor_id, tenant_id = _actor()
        payload = KnowledgeFSTidySettingsPayload.model_validate(console_ns.payload or {})
        result = _console_services().facade.update_tidy_settings(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, payload=payload
        )
        return dump_response(KnowledgeFSTidySettingsResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/tidy/summary")
class KnowledgeFSTidySummaryApi(Resource):
    @error_responses(*_SPACE_CALL_ERRORS, KnowledgeFSResourceNotFoundHTTPError)
    @console_ns.response(200, "Tidy result", console_ns.models[KnowledgeFSTidySummaryResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        """Validate admitted input, forward scoped operation, and preserve upstream errors."""
        actor_id, tenant_id = _actor()
        result = _console_services().facade.get_tidy_summary(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id
        )
        return dump_response(KnowledgeFSTidySummaryResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/tidy/findings")
class KnowledgeFSTidyFindingsApi(Resource):
    @error_responses(*_SPACE_CALL_ERRORS, KnowledgeFSResourceNotFoundHTTPError)
    @console_ns.response(200, "Tidy result", console_ns.models[KnowledgeFSTidyFindingListResponse.__name__])
    @console_ns.doc(params=query_params_from_model(KnowledgeFSTidyFindingQuery))
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        """Validate admitted input, forward scoped operation, and preserve upstream errors."""
        actor_id, tenant_id = _actor()
        query = KnowledgeFSTidyFindingQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_tidy_findings(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, query=query
        )
        return dump_response(KnowledgeFSTidyFindingListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/tidy/scans")
class KnowledgeFSTidyScansApi(Resource):
    @error_responses(*_SPACE_CALL_ERRORS, KnowledgeFSResourceNotFoundHTTPError)
    @console_ns.response(200, "Tidy result", console_ns.models[KnowledgeFSTidyScanListResponse.__name__])
    @console_ns.doc(params=query_params_from_model(KnowledgeFSTidyScanQuery))
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def get(self, control_space_id: str):
        """Validate admitted input, forward scoped operation, and preserve upstream errors."""
        actor_id, tenant_id = _actor()
        query = KnowledgeFSTidyScanQuery.model_validate(request.args.to_dict())
        result = _console_services().facade.list_tidy_scans(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id, query=query
        )
        return dump_response(KnowledgeFSTidyScanListResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/tidy/findings/<string:finding_id>/actions")
class KnowledgeFSTidyActionApi(Resource):
    @error_responses(*_SPACE_CALL_ERRORS, KnowledgeFSResourceNotFoundHTTPError)
    @console_ns.response(200, "Tidy result", console_ns.models[KnowledgeFSTidyFindingResponse.__name__])
    @console_ns.expect(console_ns.models[KnowledgeFSTidyActionPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, finding_id: str):
        """Validate admitted input, forward scoped operation, and preserve upstream errors."""
        actor_id, tenant_id = _actor()
        payload = KnowledgeFSTidyActionPayload.model_validate(console_ns.payload or {})
        result = _console_services().facade.act_on_tidy_finding(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            payload=payload,
            finding_id=finding_id,
        )
        return dump_response(KnowledgeFSTidyFindingResponse, result)


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/tidy/findings/<string:finding_id>/rewrite")
class KnowledgeFSTidyRewriteApi(Resource):
    @error_responses(
        *_SPACE_CALL_ERRORS, KnowledgeFSResourceNotFoundHTTPError, KnowledgeFSConflictHTTPError, RelayedHTTPError
    )
    @console_ns.response(
        HTTPStatus.ACCEPTED, "Rewrite accepted", console_ns.models[KnowledgeFSTidyRewriteResponse.__name__]
    )
    @console_ns.expect(console_ns.models[KnowledgeFSTidyRewritePayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str, finding_id: str):
        """Adopt one side of a conflict: rewrite the passage in the other document as a new revision.

        The upload is compare-and-swap on the document, so a document that changed meanwhile is
        refused upstream. The finding is marked reviewed afterwards; if that fails the rewrite still
        stands and the next scan retires the finding.
        """
        actor_id, tenant_id = _actor()
        payload = KnowledgeFSTidyRewritePayload.model_validate(console_ns.payload or {})
        facade = _console_services().facade
        try:
            upload, target = prepare_tidy_rewrite(
                facade=facade,
                downloads=KnowledgeFSDownloadService(),
                tenant_id=tenant_id,
                account_id=actor_id,
                control_space_id=control_space_id,
                document_id=payload.documentId,
                passage=payload.passage,
                replacement=payload.replacement,
            )
        except KnowledgeFSTidyRewriteError as exc:
            raise RelayedHTTPError(status=exc.status, error_code=exc.code, message=exc.message) from exc

        def scanned(max_bytes: int) -> KnowledgeFSRemoteMultipartFile:
            # The edited source goes through the same malware policy as any other upload.
            outcome = FileScanService().scan_content(
                tenant_id=tenant_id,
                scope=ScanScope(SCOPE_KNOWLEDGE_FS_SPACE, control_space_id),
                file_name=upload.filename,
                mime_type=upload.content_type,
                content=upload.body,
            )
            if not outcome.allowed:
                raise KnowledgeFSStagedUploadScanBlockedError(outcome)
            return upload

        accepted = facade.create_document(
            tenant_id=tenant_id,
            account_id=actor_id,
            control_space_id=control_space_id,
            body_reader=scanned,
            revision_of=target,
        )
        try:
            finding = facade.act_on_tidy_finding(
                tenant_id=tenant_id,
                account_id=actor_id,
                control_space_id=control_space_id,
                finding_id=finding_id,
                payload=KnowledgeFSTidyActionPayload(expectedRevision=payload.expectedRevision, action="review"),
            )
        except (KnowledgeFSProductRemoteError, KnowledgeFSProductRequestRejectedError):
            finding = None
        return (
            dump_response(
                KnowledgeFSTidyRewriteResponse,
                {
                    "documentId": accepted.logical_document_id,
                    "documentRevision": accepted.document_revision,
                    "taskId": accepted.compilation_job.id,
                    "finding": finding,
                },
            ),
            HTTPStatus.ACCEPTED,
        )


@console_ns.route("/knowledge-fs/spaces/<string:control_space_id>/tidy/retry")
class KnowledgeFSTidyRetryApi(Resource):
    @error_responses(*_SPACE_CALL_ERRORS, KnowledgeFSResourceNotFoundHTTPError)
    @console_ns.response(200, "Tidy result", console_ns.models[KnowledgeFSTidyRetryResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @_knowledge_fs_errors
    def post(self, control_space_id: str):
        """Validate admitted input, forward scoped operation, and preserve upstream errors."""
        actor_id, tenant_id = _actor()
        result = _console_services().facade.retry_tidy_scans(
            tenant_id=tenant_id, account_id=actor_id, control_space_id=control_space_id
        )
        return dump_response(KnowledgeFSTidyRetryResponse, result)
