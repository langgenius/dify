from flask_restful import Resource

from controllers.console import api
from controllers.console.datasets.hit_testing_base import DatasetsHitTestingBase
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from libs.login import login_required


class HitTestingApi(Resource, DatasetsHitTestingBase):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self, dataset_id):
        dataset_id_str = str(dataset_id)

        dataset = self.get_and_validate_dataset(dataset_id_str)
        args = self.parse_args()
        self.hit_testing_args_check(args)

        return self.perform_hit_testing(dataset, args)


api.add_resource(HitTestingApi, "/datasets/<uuid:dataset_id>/hit-testing")
