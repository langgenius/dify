import logging
from typing import Any

from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

from configs import dify_config
from controllers.common.fields import SimpleDataResponse
from controllers.common.schema import (
    JsonResponseWithStatus,
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.app.wraps import with_session
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    enterprise_license_required,
    knowledge_pipeline_publish_enabled,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models.account import Account
from models.dataset import Pipeline
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, PipelineTemplateInfoEntity
from services.errors.account import NoPermissionError
from services.errors.rag_pipeline import RagPipelineResourceNotFoundError
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
    @with_session
    @model_validate(PipelineTemplateListQuery)
    def get(
        self,
        req_data: PipelineTemplateListQuery,
        session: Session,
        current_tenant_id: str,
    ) -> JsonResponseWithStatus:
        # get pipeline templates
        pipeline_templates = RagPipelineService.get_pipeline_templates(
            type=req_data.type,
            language=req_data.language,
            current_tenant_id=current_tenant_id,
            session=session,
        )
        return dump_response(PipelineTemplateListResponse, pipeline_templates), 200


@console_ns.route("/rag/pipeline/templates/<string:template_id>")
class PipelineTemplateDetailApi(Resource):
    @console_ns.doc(params=query_params_from_model(PipelineTemplateDetailQuery))
    @console_ns.response(200, "Pipeline template", console_ns.models[PipelineTemplateDetailResponse.__name__])
    @console_ns.response(404, "Pipeline template not found")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_tenant_id
    @with_session(write=False)
    @model_validate(PipelineTemplateDetailQuery)
    def get(
        self,
        req_data: PipelineTemplateDetailQuery,
        session: Session,
        current_tenant_id: str,
        template_id: str,
    ) -> JsonResponseWithStatus:
        pipeline_template = RagPipelineService.get_pipeline_template_detail(
            template_id,
            current_tenant_id,
            type=req_data.type,
            session=session,
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
    @model_validate(CustomizedPipelineTemplatePayload)
    def patch(
        self,
        req_data: CustomizedPipelineTemplatePayload,
        current_tenant_id: str,
        current_user: Account,
        template_id: str,
    ) -> tuple[str, int]:
        pipeline_template_info = PipelineTemplateInfoEntity.model_validate(req_data.model_dump())
        RagPipelineService.update_customized_pipeline_template(
            template_id, pipeline_template_info, current_user, current_tenant_id, session=db.session()
        )
        return "", 204

    @console_ns.response(204, "Pipeline template deleted")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @with_current_tenant_id
    def delete(self, current_tenant_id: str, template_id: str) -> tuple[str, int]:
        RagPipelineService.delete_customized_pipeline_template(template_id, current_tenant_id, session=db.session())
        return "", 204

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @console_ns.response(200, "Success", console_ns.models[SimpleDataResponse.__name__])
    @console_ns.response(404, "Customized pipeline template not found")
    @with_current_tenant_id
    @with_session(write=False)
    def post(self, session: Session, current_tenant_id: str, template_id: str) -> JsonResponseWithStatus:
        try:
            yaml_content = RagPipelineService.get_customized_pipeline_template_yaml(
                template_id, current_tenant_id, session=session
            )
        except RagPipelineResourceNotFoundError as exc:
            raise NotFound(str(exc)) from exc

        return dump_response(SimpleDataResponse, {"data": yaml_content}), 200


@console_ns.route("/rag/pipelines/<string:pipeline_id>/customized/publish")
class PublishCustomizedPipelineTemplateApi(Resource):
    @console_ns.expect(console_ns.models[CustomizedPipelineTemplatePayload.__name__])
    @console_ns.response(204, "Pipeline template published")
    @console_ns.response(404, "Pipeline, workflow, or dataset not found")
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @knowledge_pipeline_publish_enabled
    @with_current_user
    @get_rag_pipeline
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_PIPELINE_RELEASE)
    @model_validate(CustomizedPipelineTemplatePayload)
    def post(
        self,
        req_data: CustomizedPipelineTemplatePayload,
        current_user: Account,
        pipeline: Pipeline,
    ) -> tuple[str, int]:
        session = db.session()
        dataset = pipeline.retrieve_dataset(session=session)
        if dataset is None:
            raise NotFound("Dataset not found")

        if not dify_config.RBAC_ENABLED:
            if not current_user.is_dataset_editor:
                raise Forbidden()
            try:
                DatasetService.check_dataset_permission(dataset, current_user, session)
            except NoPermissionError as exc:
                raise Forbidden(str(exc)) from exc

        try:
            RagPipelineService.publish_customized_pipeline_template(
                pipeline, dataset, req_data.model_dump(), current_user, session=session
            )
        except RagPipelineResourceNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        return "", 204
