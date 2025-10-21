from controllers.console.datasets.hit_testing_base import DatasetsHitTestingBase
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import DatasetApiResource, cloud_edition_billing_rate_limit_check


@service_api_ns.route("/datasets/<uuid:dataset_id>/hit-testing", "/datasets/<uuid:dataset_id>/retrieve")
class HitTestingApi(DatasetApiResource, DatasetsHitTestingBase):
    @service_api_ns.doc("dataset_hit_testing")
    @service_api_ns.doc(description="Perform hit testing on a dataset")
    @service_api_ns.doc(params={"dataset_id": "Dataset ID"})
    @service_api_ns.doc(
        responses={
            200: "Hit testing results",
            401: "Unauthorized - invalid API token",
            404: "Dataset not found",
        }
    )
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id):
        """Perform hit testing on a dataset.

        Tests retrieval performance for the specified dataset.
        """
        dataset_id_str = str(dataset_id)

        dataset = self.get_and_validate_dataset(dataset_id_str)
        args = self.parse_args()
        self.hit_testing_args_check(args)

        return self.perform_hit_testing(dataset, args)
