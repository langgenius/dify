from uuid import UUID

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.datasets.hit_testing_base import DatasetsHitTestingBase, HitTestingPayload
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import DatasetApiResource, cloud_edition_billing_rate_limit_check
from fields.hit_testing_fields import HitTestingResponse
from libs.helper import dump_response

from sqlalchemy.orm import Session
from controllers.console.app.wraps import with_session

register_schema_models(service_api_ns, HitTestingPayload)
register_response_schema_models(service_api_ns, HitTestingResponse)


@service_api_ns.route("/datasets/<uuid:dataset_id>/hit-testing", "/datasets/<uuid:dataset_id>/retrieve")
class HitTestingApi(DatasetApiResource, DatasetsHitTestingBase):
    @service_api_ns.doc(
        summary="Retrieve Chunks from a Knowledge Base / Test Retrieval",
        description=(
            "Performs a search query against a knowledge base to retrieve the most relevant chunks. This "
            "endpoint can be used for both production retrieval and test retrieval."
        ),
        tags=["Knowledge Bases"],
        responses={
            200: "Retrieval results.",
            400: (
                "- `dataset_not_initialized` : The dataset is still being initialized or indexing. Please "
                "wait a moment.\n"
                "- `provider_not_initialize` : No valid model provider credentials found. Please go to "
                "Settings -> Model Provider to complete your provider credentials.\n"
                "- `provider_quota_exceeded` : Your quota for Dify Hosted OpenAI has been exhausted. Please "
                "go to Settings -> Model Provider to complete your own provider credentials.\n"
                "- `model_currently_not_support` : Dify Hosted OpenAI trial currently not support the GPT-4 "
                "model.\n"
                "- `completion_request_error` : Completion request failed.\n"
                "- `invalid_param` : Invalid parameter value."
            ),
            403: "`forbidden` : Insufficient permissions.",
            404: "`not_found` : Knowledge base not found.",
            500: "`internal_server_error` : An internal error occurred during retrieval.",
        },
    )
    @service_api_ns.doc("dataset_hit_testing")
    @service_api_ns.doc(description="Perform hit testing on a dataset")
    @service_api_ns.doc(params={"dataset_id": "Knowledge base ID."})
    @service_api_ns.response(
        200,
        "Hit testing results",
        model=service_api_ns.models[HitTestingResponse.__name__],
    )
    @service_api_ns.response(401, "Unauthorized - invalid API token")
    @service_api_ns.response(404, "Dataset not found")
    @service_api_ns.expect(service_api_ns.models[HitTestingPayload.__name__])
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    @with_session
    def post(self, session: Session, tenant_id: str, dataset_id: UUID) -> dict[str, object]:
        """Perform hit testing on a dataset.

        Tests retrieval performance for the specified dataset.
        """
        dataset_id_str = str(dataset_id)
        dataset = self.get_and_validate_dataset(dataset_id_str)
        args = self.parse_args(service_api_ns.payload)
        self.hit_testing_args_check(args)

        return dump_response(HitTestingResponse, self.perform_hit_testing(session, dataset, args))
