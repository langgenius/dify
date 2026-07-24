from flask_restx import (  # type: ignore
    Resource,  # type: ignore
)
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import current_user, login_required
from models import Account
from models.dataset import Pipeline
from services.rag_pipeline.rag_pipeline import RagPipelineService

DEFAULT_REF_TEMPLATE_SWAGGER_2_0 = "#/definitions/{model}"


class Parser(BaseModel):
    inputs: dict
    datasource_type: str
    credential_id: str | None = None


console_ns.schema_model(Parser.__name__, Parser.model_json_schema(ref_template=DEFAULT_REF_TEMPLATE_SWAGGER_2_0))


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/published/datasource/nodes/<string:node_id>/preview")
class DataSourceContentPreviewApi(Resource):
    @console_ns.expect(console_ns.models[Parser.__name__])
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

        args = Parser.model_validate(console_ns.payload)

        inputs = args.inputs
        datasource_type = args.datasource_type
        rag_pipeline_service = RagPipelineService()
        preview_content = rag_pipeline_service.run_datasource_node_preview(
            pipeline=pipeline,
            node_id=node_id,
            user_inputs=inputs,
            account=current_user,
            datasource_type=datasource_type,
            is_published=True,
            credential_id=args.credential_id,
        )
        return preview_content, 200
