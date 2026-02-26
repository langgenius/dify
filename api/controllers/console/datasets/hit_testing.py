from flask_restx import Resource, fields

from controllers.common.schema import register_schema_model
from fields.hit_testing_fields import (
    child_chunk_fields,
    document_fields,
    files_fields,
    hit_testing_record_fields,
    segment_fields,
)
from libs.login import login_required

from .. import console_ns
from ..datasets.hit_testing_base import DatasetsHitTestingBase, HitTestingPayload
from ..wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    setup_required,
)

register_schema_model(console_ns, HitTestingPayload)


def _get_or_create_model(model_name: str, field_def):
    """Get or create a flask_restx model to avoid dict type issues in Swagger."""
    existing = console_ns.models.get(model_name)
    if existing is None:
        existing = console_ns.model(model_name, field_def)
    return existing


# Register models for flask_restx to avoid dict type issues in Swagger
document_model = _get_or_create_model("HitTestingDocument", document_fields)

segment_fields_copy = segment_fields.copy()
segment_fields_copy["document"] = fields.Nested(document_model)
segment_model = _get_or_create_model("HitTestingSegment", segment_fields_copy)

child_chunk_model = _get_or_create_model("HitTestingChildChunk", child_chunk_fields)
files_model = _get_or_create_model("HitTestingFile", files_fields)

hit_testing_record_fields_copy = hit_testing_record_fields.copy()
hit_testing_record_fields_copy["segment"] = fields.Nested(segment_model)
hit_testing_record_fields_copy["child_chunks"] = fields.List(fields.Nested(child_chunk_model))
hit_testing_record_fields_copy["files"] = fields.List(fields.Nested(files_model))
hit_testing_record_model = _get_or_create_model("HitTestingRecord", hit_testing_record_fields_copy)

# Response model for hit testing API
hit_testing_response_fields = {
    "query": fields.String,
    "records": fields.List(fields.Nested(hit_testing_record_model)),
}
hit_testing_response_model = _get_or_create_model("HitTestingResponse", hit_testing_response_fields)


@console_ns.route("/datasets/<uuid:dataset_id>/hit-testing")
class HitTestingApi(Resource, DatasetsHitTestingBase):
    @console_ns.doc("test_dataset_retrieval")
    @console_ns.doc(description="Test dataset knowledge retrieval")
    @console_ns.doc(params={"dataset_id": "Dataset ID"})
    @console_ns.expect(console_ns.models[HitTestingPayload.__name__])
    @console_ns.response(200, "Hit testing completed successfully", model=hit_testing_response_model)
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
