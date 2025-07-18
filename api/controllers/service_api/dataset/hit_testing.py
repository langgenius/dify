from controllers.console.datasets.hit_testing_base import DatasetsHitTestingBase
from controllers.service_api import api
from controllers.service_api.wraps import DatasetApiResource, cloud_edition_billing_rate_limit_check


class HitTestingApi(DatasetApiResource, DatasetsHitTestingBase):
    @cloud_edition_billing_rate_limit_check("knowledge", "dataset")
    def post(self, tenant_id, dataset_id):
        dataset_id_str = str(dataset_id)

        dataset = self.get_and_validate_dataset(dataset_id_str)
        args = self.parse_args()
        self.hit_testing_args_check(args)

        return self.perform_hit_testing(dataset, args)


api.add_resource(HitTestingApi, "/datasets/<uuid:dataset_id>/hit-testing", "/datasets/<uuid:dataset_id>/retrieve")
