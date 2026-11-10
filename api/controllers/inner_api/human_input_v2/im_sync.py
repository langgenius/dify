"""Design-only deployment manual sync and latest-only reads.

Only sync creation carries an EE sys_users.id, taken from authenticated EE
context. Dify stores the identifier and never resolves the administrator's name.
Reusing an active run preserves its original initiator. The runtime registry does not load these stubs.
"""

from uuid import UUID

from flask_restx import Resource
from pydantic import Field

from controllers.common.human_input_v2_contracts import (
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
from fields.base import ResponseModel

from .contracts import APIErrorResponse, RequestModel


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
    def post(self) -> DeploymentIMSyncRunResponse:
        """Start or reuse a manual directory sync run for the current Channel revision.

        POST /inner/api/enterprise/human-input/v2/sync-runs.

        Pre: authenticated EE caller and a sys_users.id derived from EE authentication.
        Post: create or reuse the current revision's active run, preserving its initiator.
        Dispatch follows commit; a dispatch 503 can leave a queued run persisted.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/sync-runs/latest")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class LatestDeploymentIMSyncRunApi(Resource):
    @inner_api_ns.response(200, "Success", inner_api_ns.models[DeploymentIMSyncRunResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> DeploymentIMSyncRunResponse:
        """Read the current Channel's latest sync run and its aggregate result counts.

        GET /inner/api/enterprise/human-input/v2/sync-runs/latest.

        Pre: authenticated EE caller and empty query.
        Post: return the current Channel's latest run or 404; no EE lookup, repair, or sync.
        """
        ...


@inner_api_ns.route("/enterprise/human-input/v2/sync-runs/latest/records")
@inner_api_ns.response("default", "Error", inner_api_ns.models[APIErrorResponse.__name__])
class LatestDeploymentIMSyncRunResultsApi(Resource):
    @inner_api_ns.doc(params=query_params_from_model(ListLatestIMSyncRunResultsQuery))
    @inner_api_ns.response(200, "Success", inner_api_ns.models[ListLatestIMSyncRunResultsResponse.__name__])
    @enterprise_inner_api_only
    def get(self) -> ListLatestIMSyncRunResultsResponse:
        """Page through one result bucket of the current Channel's latest sync run.

        GET /inner/api/enterprise/human-input/v2/sync-runs/latest/records.

        Pre: authenticated EE caller and exactly one CE result bucket with page/limit.
        Post: return the frozen result page and total for one latest run, without repeated run metadata.
        Separate summary/result requests need not select the same run. No state changes occur.
        """
        ...
