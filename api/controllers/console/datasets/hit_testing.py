from flask_restx import Resource

from controllers.common.schema import register_schema_model
from libs.login import login_required

from .. import console_ns
from ..datasets.hit_testing_base import DatasetsHitTestingBase, HitTestingPayload
from ..wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    setup_required,
)

register_schema_model(console_ns, HitTestingPayload)


@console_ns.route("/datasets/<uuid:dataset_id>/hit-testing")
class HitTestingApi(Resource, DatasetsHitTestingBase):
    @console_ns.doc("test_dataset_retrieval")
    @console_ns.doc(description="Test dataset knowledge retrieval")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[HitTestingPayload.__name__])
    @console_ns.response(200, "Hit testing completed successfully")
    @console_ns.response(404, "Dataset not found")
    @console_ns.response(400, "Invalid parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, dataset_id):
        dataset_id_str = str(dataset_id)

        dataset = self.get_and_validate_dataset(dataset_id_str)
        payload = HitTestingPayload.model_validate(console_ns.payload or {})
        args = payload.model_dump(exclude_none=True)
        self.hit_testing_args_check(args)

        return self.perform_hit_testing(dataset, args)
