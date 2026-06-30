import logging
from typing import Any

from flask import request
from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker
from werkzeug.exceptions import NotFound

from controllers.common.fields import SimpleDataResponse
from controllers.common.schema import (
    JsonResponseWithStatus,
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.wraps import (
    account_initialization_required,
    enterprise_license_required,
    knowledge_pipeline_publish_enabled,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models.account import Account
from models.dataset import PipelineCustomizedTemplate
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, PipelineTemplateInfoEntity
from services.rag_pipeline.rag_pipeline import RagPipelineService

logger: logging.Logger = logging.getLogger(__name__)


class PipelineTemplateListQuery(BaseModel):
    type: str = Field(default="built-in", description="Template source: built-in or customized")
    language: str = Field(default="en-US", description="Template language")


class PipelineTemplateDetailQuery(BaseModel):
    type: str = Field(default="built-in", description="Template source: built-in or customized")


class PipelineTemplateItemResponse(ResponseModel):
    id: str
    name: str
    icon: dict[str, Any]
    description: str
    position: int
    chunk_structure: str
    copyright: str | None = None
    privacy_policy: str | None = None


class PipelineTemplateListResponse(ResponseModel):
    pipeline_templates: list[PipelineTemplateItemResponse]


class PipelineTemplateDetailResponse(ResponseModel):
    id: str
    name: str
    icon_info: dict[str, Any]
    description: str
    chunk_structure: str
    export_data: str
    graph: dict[str, Any]
    created_by: str | None = None


class CustomizedPipelineTemplatePayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    description: str = Field(default="", max_length=400)
    icon_info: dict[str, object] = Field(
        default_factory=lambda: IconInfo(icon="").model_dump(),
    )


register_schema_models(
    console_ns,
    CustomizedPipelineTemplatePayload,
    PipelineTemplateDetailQuery,
    PipelineTemplateListQuery,
)
register_response_schema_models(
    console_ns,
    PipelineTemplateDetailResponse,
    PipelineTemplateListResponse,
    SimpleDataResponse,
)


@console_ns.route("/rag/pipeline/templates")
class PipelineTemplateListApi(Resource):
    @console_ns.doc(params=query_params_from_model(PipelineTemplateListQuery))
    @console_ns.response(200, "Pipeline templates", console_ns.models[PipelineTemplateListResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_tenant_id
    def get(self, current_tenant_id: str) -> JsonResponseWithStatus:
        query = PipelineTemplateListQuery.model_validate(request.args.to_dict(flat=True))
        # get pipeline templates
        pipeline_templates = RagPipelineService.get_pipeline_templates(
            query.type, query.language, current_tenant_id, session=db.session()
        )
        return dump_response(PipelineTemplateListResponse, pipeline_templates), 200


@console_ns.route("/rag/pipeline/templates/<string:template_id>")
class PipelineTemplateDetailApi(Resource):
    @console_ns.doc(params=query_params_from_model(PipelineTemplateDetailQuery))
    @console_ns.response(200, "Pipeline template", console_ns.models[PipelineTemplateDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    def get(self, template_id: str) -> JsonResponseWithStatus:
        query = PipelineTemplateDetailQuery.model_validate(request.args.to_dict(flat=True))
        rag_pipeline_service = RagPipelineService()
        pipeline_template = rag_pipeline_service.get_pipeline_template_detail(
            template_id, query.type, session=db.session()
        )
        if pipeline_template is None:
            raise NotFound("Pipeline template not found from upstream service.")
        return dump_response(PipelineTemplateDetailResponse, pipeline_template), 200


@console_ns.route("/rag/pipeline/customized/templates/<string:template_id>")
class CustomizedPipelineTemplateApi(Resource):
    @console_ns.expect(console_ns.models[CustomizedPipelineTemplatePayload.__name__])
    @console_ns.response(204, "Pipeline template updated")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_user
    @with_current_tenant_id
    def patch(self, current_tenant_id: str, current_user: Account, template_id: str) -> tuple[str, int]:
        payload = CustomizedPipelineTemplatePayload.model_validate(console_ns.payload or {})
        pipeline_template_info = PipelineTemplateInfoEntity.model_validate(payload.model_dump())
        RagPipelineService.update_customized_pipeline_template(
            template_id, pipeline_template_info, current_user, current_tenant_id
        )
        return "", 204

    @console_ns.response(204, "Pipeline template deleted")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, template_id: str) -> tuple[str, int]:
        RagPipelineService.delete_customized_pipeline_template(template_id, current_tenant_id)
        return "", 204

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @console_ns.response(200, "Success", console_ns.models[SimpleDataResponse.__name__])
    def post(self, template_id: str) -> JsonResponseWithStatus:
        with sessionmaker(db.engine, expire_on_commit=False).begin() as session:
            template = session.scalar(
                select(PipelineCustomizedTemplate).where(PipelineCustomizedTemplate.id == template_id).limit(1)
            )
            if not template:
                raise ValueError("Customized pipeline template not found.")

        return dump_response(SimpleDataResponse, {"data": template.yaml_content}), 200


@console_ns.route("/rag/pipelines/<string:pipeline_id>/customized/publish")
class PublishCustomizedPipelineTemplateApi(Resource):
    @console_ns.expect(console_ns.models[CustomizedPipelineTemplatePayload.__name__])
    @console_ns.response(204, "Pipeline template published")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @knowledge_pipeline_publish_enabled
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account, pipeline_id: str) -> tuple[str, int]:
        payload = CustomizedPipelineTemplatePayload.model_validate(console_ns.payload or {})
        rag_pipeline_service = RagPipelineService()
        rag_pipeline_service.publish_customized_pipeline_template(
            pipeline_id, payload.model_dump(), current_user, current_tenant_id
        )
        return "", 204
