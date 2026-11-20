"""Deployment manual sync and latest-only reads; initiator names remain owned by EE."""

from uuid import UUID

from flask import request
from flask_restx import Resource
from pydantic import Field

from controllers.common.human_input_v2.im_sync import sync_result_response, sync_run_response
from controllers.common.human_input_v2_contracts import (
    IMSyncResultItem,
    IMSyncRun,
    ListLatestIMSyncRunResultsQuery,
    ListLatestIMSyncRunResultsResponse,
)
from controllers.common.schema import (
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from core.human_input_v2.im_integration.sync_records import SysUserId, SysUserIMSyncInitiator
from core.human_input_v2.shared import DeploymentScope
from fields.base import ResponseModel
from libs.exception import RelayedHTTPError
from services.human_input_v2.im_contact_sync.composition import build_im_sync_service
from services.human_input_v2.im_contact_sync.service import (
    IMChannelNotConfiguredError,
    IMSyncDispatchUnavailableError,
    IMSyncRevisionChangedError,
    IMSyncRunNotFoundError,
    IMSyncRunSummary,
)

from .contracts import APIErrorResponse, RequestModel, parse_request


class CreateDeploymentIMSyncRunPayload(RequestModel):
    """Internal metadata supplied by EE, never an EE public request field."""

    started_by_sys_user_id: UUID = Field(description="Authenticated EE administrator's upstream sys_users.id.")


class DeploymentIMSyncRun(IMSyncRun):
    """CE run fields plus the persisted EE initiator needed by the EE name lookup."""

    started_by_sys_user_id: UUID | None = Field(
        description=(
            "Persisted EE initiator, including when an active run is reused. None identifies an Account-initiated "
            "run; use the inherited initiator_display_name in that case. Dify returns an empty name for EE initiators."
        )
    )


class DeploymentIMSyncRunResponse(ResponseModel):
    run: DeploymentIMSyncRun


register_schema_models(inner_api_ns, CreateDeploymentIMSyncRunPayload)
register_response_schema_models(inner_api_ns, DeploymentIMSyncRunResponse, ListLatestIMSyncRunResultsResponse)


@inner_api_ns.route("/enterprise/human-input/v2/sync-runs")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class DeploymentIMSyncRunsApi(Resource):
    @inner_api_ns.expect(inner_api_ns.models[CreateDeploymentIMSyncRunPayload.__name__])
    @inner_api_ns.response(200, "Success", inner_api_ns.models[DeploymentIMSyncRunResponse.__name__])
    @enterprise_inner_api_only
    def post(self) -> dict[str, object]:
        """Start or reuse a manual directory sync run for the current Channel revision.

        POST /inner/api/enterprise/human-input/v2/sync-runs.

        Pre: authenticated EE caller and a sys_users.id derived from EE authentication.
        Post: create or reuse the current revision's active run, preserving its initiator.
        Dispatch follows commit; a dispatch 503 can leave a queued run persisted.
        """
        payload = parse_request(CreateDeploymentIMSyncRunPayload, inner_api_ns.payload or {})
        try:
            summary = build_im_sync_service().create_or_get_active_run(
                DeploymentScope(),
                SysUserIMSyncInitiator(SysUserId(str(payload.started_by_sys_user_id))),
            )
        except IMChannelNotConfiguredError:
            raise RelayedHTTPError(
                status=404, error_code="im_integration_not_configured", message="IM Channel is not configured"
            ) from None
        except IMSyncRevisionChangedError:
            raise RelayedHTTPError(
                status=409, error_code="im_sync_revision_changed", message="IM Channel revision changed"
            ) from None
        except IMSyncDispatchUnavailableError:
            raise RelayedHTTPError(
                status=503,
                error_code="im_sync_dispatch_unavailable",
                message="IM synchronization dispatch is unavailable",
            ) from None
        return DeploymentIMSyncRunResponse(run=_run(summary)).model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/sync-runs/latest")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class LatestDeploymentIMSyncRunApi(Resource):
    @inner_api_ns.response(200, "Success", inner_api_ns.models[DeploymentIMSyncRunResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> dict[str, object]:
        """Read the current Channel's latest sync run and its aggregate result counts.

        GET /inner/api/enterprise/human-input/v2/sync-runs/latest.

        Pre: authenticated EE caller and empty query.
        Post: return the current Channel's latest run or 404; no EE lookup, repair, or sync.
        """
        parse_request(RequestModel, request.args.to_dict(flat=True))
        try:
            summary = build_im_sync_service().get_latest_run(DeploymentScope())
        except IMChannelNotConfiguredError:
            raise RelayedHTTPError(
                status=404, error_code="im_integration_not_configured", message="IM Channel is not configured"
            ) from None
        except IMSyncRunNotFoundError:
            raise RelayedHTTPError(
                status=404, error_code="im_sync_run_not_found", message="IM synchronization run was not found"
            ) from None
        return DeploymentIMSyncRunResponse(run=_run(summary)).model_dump(mode="json")


@inner_api_ns.route("/enterprise/human-input/v2/sync-runs/latest/records")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class LatestDeploymentIMSyncRunResultsApi(Resource):
    @inner_api_ns.doc(params=query_params_from_model(ListLatestIMSyncRunResultsQuery))
    @inner_api_ns.response(200, "Success", inner_api_ns.models[ListLatestIMSyncRunResultsResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> dict[str, object]:
        """Page through one result bucket of the current Channel's latest sync run.

        GET /inner/api/enterprise/human-input/v2/sync-runs/latest/records.

        Pre: authenticated EE caller and exactly one CE result bucket with page/limit.
        Post: return the frozen result page and total for one latest run, without repeated run metadata.
        Separate summary/result requests need not select the same run. No state changes occur.
        """
        query = parse_request(ListLatestIMSyncRunResultsQuery, request.args.to_dict(flat=True))
        try:
            results = build_im_sync_service().list_latest_results(
                DeploymentScope(), query.result, page=query.page, limit=query.limit
            )
        except IMChannelNotConfiguredError:
            raise RelayedHTTPError(
                status=404, error_code="im_integration_not_configured", message="IM Channel is not configured"
            ) from None
        except IMSyncRunNotFoundError:
            raise RelayedHTTPError(
                status=404, error_code="im_sync_run_not_found", message="IM synchronization run was not found"
            ) from None
        return ListLatestIMSyncRunResultsResponse(
            data=[IMSyncResultItem(id=result.id, result=sync_result_response(result)) for result in results.items],
            page=results.page,
            limit=results.limit,
            total=results.total,
        ).model_dump(mode="json")


def _run(summary: IMSyncRunSummary) -> DeploymentIMSyncRun:
    """Use the persisted initiator, including active-run reuse; never look up EE names."""
    initiator = summary.run.started_by
    return DeploymentIMSyncRun(
        **sync_run_response(summary).model_dump(),
        started_by_sys_user_id=initiator.sys_user_id if isinstance(initiator, SysUserIMSyncInitiator) else None,
    )
