import logging

from flask import request
from flask_restful import Resource, reqparse
from sqlalchemy.orm import Session

from controllers.console import api
from controllers.console.wraps import (
    account_initialization_required,
    enterprise_license_required,
    setup_required,
)
from extensions.ext_database import db
from libs.login import login_required
from models.dataset import Pipeline, PipelineCustomizedTemplate
from services.entities.knowledge_entities.rag_pipeline_entities import PipelineTemplateInfoEntity
from services.rag_pipeline.rag_pipeline import RagPipelineService
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService

logger = logging.getLogger(__name__)


def _validate_name(name):
    if not name or len(name) < 1 or len(name) > 40:
        raise ValueError("Name must be between 1 to 40 characters.")
    return name


def _validate_description_length(description):
    if len(description) > 400:
        raise ValueError("Description cannot exceed 400 characters.")
    return description


class PipelineTemplateListApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self):
        type = request.args.get("type", default="built-in", type=str)
        language = request.args.get("language", default="en-US", type=str)
        # get pipeline templates
        pipeline_templates = RagPipelineService.get_pipeline_templates(type, language)
        return pipeline_templates, 200


class PipelineTemplateDetailApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self, pipeline_id: str):
        pipeline_template = RagPipelineService.get_pipeline_template_detail(pipeline_id)
        return pipeline_template, 200


class CustomizedPipelineTemplateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def patch(self, template_id: str):
        parser = reqparse.RequestParser()
        parser.add_argument(
            "name",
            nullable=False,
            required=True,
            help="Name must be between 1 to 40 characters.",
            type=_validate_name,
        )
        parser.add_argument(
            "description",
            type=str,
            nullable=True,
            required=False,
            default="",
        )
        parser.add_argument(
            "icon_info",
            type=dict,
            location="json",
            nullable=True,
        )
        args = parser.parse_args()
        pipeline_template_info = PipelineTemplateInfoEntity(**args)
        pipeline_template = RagPipelineService.update_customized_pipeline_template(template_id, pipeline_template_info)
        return pipeline_template, 200

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def delete(self, template_id: str):
        RagPipelineService.delete_customized_pipeline_template(template_id)
        return 200

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def post(self, template_id: str):
        with Session(db.engine) as session:
            template = session.query(PipelineCustomizedTemplate).filter(PipelineCustomizedTemplate.id == template_id).first()
            if not template:
                raise ValueError("Customized pipeline template not found.")
            pipeline = session.query(Pipeline).filter(Pipeline.id == template.pipeline_id).first()
            if not pipeline:
                raise ValueError("Pipeline not found.")

            dsl = RagPipelineDslService.export_rag_pipeline_dsl(pipeline, include_secret=True)
        return {"data": dsl}, 200


api.add_resource(
    PipelineTemplateListApi,
    "/rag/pipeline/templates",
)
api.add_resource(
    PipelineTemplateDetailApi,
    "/rag/pipeline/templates/<string:pipeline_id>",
)
api.add_resource(
    CustomizedPipelineTemplateApi,
    "/rag/pipeline/customized/templates/<string:template_id>",
)
