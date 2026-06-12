from typing import Any

from flask_restx import (  # type: ignore
    Resource,  # type: ignore
)
from pydantic import BaseModel, RootModel

from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import account_initialization_required, setup_required, with_current_user
from libs.login import login_required
from models import Account
from models.dataset import Pipeline
from services.rag_pipeline.rag_pipeline import RagPipelineService


class Parser(BaseModel):
    inputs: dict[str, Any]
    datasource_type: str
    credential_id: str | None = None


class DataSourceContentPreviewResponse(RootModel[Any]):
    root: Any


register_schema_models(console_ns, Parser)
register_response_schema_models(console_ns, DataSourceContentPreviewResponse)


@console_ns.route("/rag/pipelines/<uuid:pipeline_id>/workflows/published/datasource/nodes/<string:node_id>/preview")
class DataSourceContentPreviewApi(Resource):
    @console_ns.expect(console_ns.models[Parser.__name__])
    @console_ns.response(200, "Success", console_ns.models[DataSourceContentPreviewResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @get_rag_pipeline
    @with_current_user
    def post(self, current_user: Account, pipeline: Pipeline, node_id: str):
        """
        Run datasource content preview
        """
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
