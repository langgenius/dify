"""Authenticated Tidy Console transport; all domain work remains in KnowledgeFS."""

from flask import request
from flask_restx import Resource

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.knowledge_fs.error import KnowledgeFSResourceNotFoundHTTPError
from controllers.console.knowledge_fs.resources import (
    _SPACE_CALL_ERRORS,
    _actor,
    _console_services,
    _knowledge_fs_errors,
)
from controllers.console.wraps import account_initialization_required, setup_required
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import login_required
from services.knowledge_fs.tidy_dto import (
    KnowledgeFSTidyActionPayload,
    KnowledgeFSTidyFindingListResponse,
    KnowledgeFSTidyFindingQuery,
    KnowledgeFSTidyFindingResponse,
    KnowledgeFSTidyRetryResponse,
    KnowledgeFSTidyScanListResponse,
    KnowledgeFSTidyScanQuery,
    KnowledgeFSTidySettingsPayload,
    KnowledgeFSTidySettingsResponse,
    KnowledgeFSTidySummaryResponse,
)

register_schema_models(
    console_ns,
    KnowledgeFSTidySettingsPayload,
    KnowledgeFSTidyActionPayload,
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
