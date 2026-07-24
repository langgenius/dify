import logging

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
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


@console_ns.route("/rag/pipeline/templates")
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


@console_ns.route("/rag/pipeline/templates/<string:template_id>")
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


class Payload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    description: str = Field(default="", max_length=400)
    icon_info: dict[str, object] | None = None


register_schema_models(console_ns, Payload)


@console_ns.route("/rag/pipeline/customized/templates/<string:template_id>")
class CustomizedPipelineTemplateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def patch(self, template_id: str):
        payload = Payload.model_validate(console_ns.payload or {})
        pipeline_template_info = PipelineTemplateInfoEntity.model_validate(payload.model_dump())
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


@console_ns.route("/rag/pipelines/<string:pipeline_id>/customized/publish")
class PublishCustomizedPipelineTemplateApi(Resource):
    @console_ns.expect(console_ns.models[Payload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @knowledge_pipeline_publish_enabled
    def post(self, pipeline_id: str):
        payload = Payload.model_validate(console_ns.payload or {})
        rag_pipeline_service = RagPipelineService()
        rag_pipeline_service.publish_customized_pipeline_template(pipeline_id, payload.model_dump())
        return {"result": "success"}
