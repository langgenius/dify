from flask_restx import (  # type: ignore
    Resource,  # type: ignore
    reqparse,
)
from werkzeug.exceptions import Forbidden

from controllers.console import api, console_ns
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import current_user, login_required
from models import Account
from models.dataset import Pipeline
from services.rag_pipeline.rag_pipeline import RagPipelineService

parser = (
    reqparse.RequestParser()
    .add_argument("inputs", type=dict, required=True, nullable=False, location="json")
    .add_argument("datasource_type", type=str, required=True, location="json")
    .add_argument("credential_id", type=str, required=False, location="json")
)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/published/datasource/nodes/<string:node_id>/preview")
class DataSourceContentPreviewApi(Resource):
    @api.expect(parser)
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    def post(self, pipeline: Pipeline, node_id: str):
        """
        Run datasource content preview
        """
        if not isinstance(current_user, Account):
            raise Forbidden()

        args = parser.parse_args()

        inputs = args.get("inputs")
        if inputs is None:
            raise ValueError("missing inputs")
        datasource_type = args.get("datasource_type")
        if datasource_type is None:
            raise ValueError("missing datasource_type")

        rag_pipeline_service = RagPipelineService()
        preview_content = rag_pipeline_service.run_datasource_node_preview(
            pipeline=pipeline,
            node_id=node_id,
            user_inputs=inputs,
            account=current_user,
            datasource_type=datasource_type,
            is_published=True,
            credential_id=args.get("credential_id"),
        )
        return preview_content, 200
