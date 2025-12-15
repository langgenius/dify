from flask_restx import Resource, fields

from controllers.console import console_ns
from controllers.console.datasets.hit_testing_base import DatasetsHitTestingBase
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    setup_required,
)
from libs.login import login_required


@console_ns.route("/datasets/<uuid:dataset_id>/hit-testing")
class HitTestingApi(Resource, DatasetsHitTestingBase):
    @console_ns.doc("test_dataset_retrieval")
    @console_ns.doc(description="Test dataset knowledge retrieval")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(
        console_ns.model(
            "HitTestingRequest",
            {
                "query": fields.String(required=True, description="Query text for testing"),
                "retrieval_model": fields.Raw(description="Retrieval model configuration"),
                "top_k": fields.Integer(description="Number of top results to return"),
                "score_threshold": fields.Float(description="Score threshold for filtering results"),
            },
        )
    )
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
        args = self.parse_args()
        self.hit_testing_args_check(args)

        return self.perform_hit_testing(dataset, args)
