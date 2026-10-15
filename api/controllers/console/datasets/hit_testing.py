from __future__ import annotations

from uuid import UUID

from flask_restx import Resource

from controllers.common.rbac import DatasetId, RBACCheck
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.datasets.error import raise_hit_testing_error
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import RBACPermission, model_validate
from extensions.ext_application_services import application_services
from fields.hit_testing_fields import HitTestingPayload, HitTestingResponse
from libs.helper import dump_response
from machinery.context import RequestContext
from services.knowledge.entities.hit_testing import HitTestingRequest

from .. import console_ns

register_schema_models(console_ns, HitTestingPayload)
register_response_schema_models(console_ns, HitTestingResponse)


@console_ns.route("/datasets/<uuid:dataset_id>/hit-testing")
class HitTestingApi(Resource):
    @console_ns.doc("test_dataset_retrieval")
    @console_ns.doc(description="Test dataset knowledge retrieval")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[HitTestingPayload.__name__])
    @console_ns.response(
        200,
        "Hit testing completed successfully",
        model=console_ns.models[HitTestingResponse.__name__],
    )
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(400, "Invalid parameters")
    @console_account_admission(
        billing_rate_limit="knowledge",
        rbac_checks=(RBACCheck(RBACPermission.DATASET_PIPELINE_TEST, DatasetId()),),
    )
    @model_validate(HitTestingPayload)
    def post(self, req_data: HitTestingPayload, request_context: RequestContext, dataset_id: UUID) -> dict[str, object]:
        try:
            result = application_services().knowledge.hit_testing.hit_testing(
                request_context,
                dataset_id=str(dataset_id),
                request=HitTestingRequest(
                    query=req_data.query,
                    retrieval_model=req_data.retrieval_model.model_dump(exclude_none=True)
                    if req_data.retrieval_model is not None
                    else None,
                    attachment_ids=req_data.attachment_ids,
                ),
            )
        except Exception as error:
            raise_hit_testing_error(error)
        return dump_response(HitTestingResponse, result)
