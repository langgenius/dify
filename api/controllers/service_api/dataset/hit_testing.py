from uuid import UUID

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console.datasets.hit_testing_base import DatasetsHitTestingBase, HitTestingPayload
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import DatasetApiResource, cloud_edition_billing_rate_limit_check
from fields.hit_testing_fields import HitTestingResponse
from libs.helper import dump_response

register_schema_models(service_api_ns, HitTestingPayload)
register_response_schema_models(service_api_ns, HitTestingResponse)


@service_api_ns.route("/datasets/<uuid:dataset_id>/hit-testing", "/datasets/<uuid:dataset_id>/retrieve")
class HitTestingApi(DatasetApiResource, DatasetsHitTestingBase):
    @service_api_ns.doc("dataset_hit_testing")
    @service_api_ns.doc(description="Perform hit testing on a dataset")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.response(
        200,
        "Hit testing results",
        model=service_api_ns.models[HitTestingResponse.__name__],
    )
    @service_api_ns.response(401, "Unauthorized - invalid API token")
    @service_api_ns.response(404, "Dataset not found")
    @service_api_ns.expect(service_api_ns.models[HitTestingPayload.__name__])
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id: str, dataset_id: UUID) -> dict[str, object]:
        """Perform hit testing on a dataset.

        Tests retrieval performance for the specified dataset.
        """
        dataset_id_str = str(dataset_id)

        dataset = self.get_and_validate_dataset(dataset_id_str)
        args = self.parse_args(service_api_ns.payload)
        self.hit_testing_args_check(args)

        return dump_response(HitTestingResponse, self.perform_hit_testing(dataset, args))
