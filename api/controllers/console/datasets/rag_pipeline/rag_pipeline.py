import logging

from flask import request
from flask_restx import Resource, reqparse
from sqlalchemy.orm import Session

from controllers.console import api
from controllers.console.wraps import (
    account_initialization_required,
    enterprise_license_required,
    knowledge_pipeline_publish_enabled,
    setup_required,
)
from extensions.ext_database import db
from libs.login import login_required
from models.dataset import PipelineCustomizedTemplate
from services.entities.knowledge_entities.rag_pipeline_entities import PipelineTemplateInfoEntity
from services.rag_pipeline.rag_pipeline import RagPipelineService

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
    def get(self, template_id: str):
        type = request.args.get("type", default="built-in", type=str)
        rag_pipeline_service = RagPipelineService()
        pipeline_template = rag_pipeline_service.get_pipeline_template_detail(template_id, type)
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
        RagPipelineService.update_customized_pipeline_template(template_id, pipeline_template_info)
        return 200

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
            template = (
                session.query(PipelineCustomizedTemplate).where(PipelineCustomizedTemplate.id == template_id).first()
            )
            if not template:
                raise ValueError("Customized pipeline template not found.")

        return {"data": template.yaml_content}, 200


class PublishCustomizedPipelineTemplateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @knowledge_pipeline_publish_enabled
    def post(self, pipeline_id: str):
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
        rag_pipeline_service = RagPipelineService()
        rag_pipeline_service.publish_customized_pipeline_template(pipeline_id, args)
        return {"result": "success"}


api.add_resource(
    PipelineTemplateListApi,
    "/rag/pipeline/templates",
)
api.add_resource(
    PipelineTemplateDetailApi,
    "/rag/pipeline/templates/<string:template_id>",
)
api.add_resource(
    CustomizedPipelineTemplateApi,
    "/rag/pipeline/customized/templates/<string:template_id>",
)
api.add_resource(
    PublishCustomizedPipelineTemplateApi,
    "/rag/pipelines/<string:pipeline_id>/customized/publish",
)
