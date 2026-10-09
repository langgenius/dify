from typing import Any

from flask_restx import Resource
from pydantic import BaseModel, Field
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.fields import SimpleDataResponse
from controllers.common.rbac import DatasetByPipeline, RBACCheck
from controllers.common.schema import (
    JsonResponseWithStatus,
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.console import console_ns
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    RBACPermission,
    knowledge_pipeline_publish_enabled,
    model_validate,
    rbac_permission_required,
)
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import current_account_with_tenant
from machinery.context import RequestContext
from models.dataset import Pipeline
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, PipelineTemplateInfoEntity
from services.knowledge.dataset_access import DatasetAccessDeniedError, DatasetNotFoundError
from services.knowledge.pipeline_templates.application import (
    PipelineTemplateInput,
    PipelineTemplateNameConflictError,
    PipelineTemplateNotFoundError,
    PipelineTemplatePublishForbiddenError,
)


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
    @console_account_admission(require_valid_enterprise_license=True)
    @model_validate(PipelineTemplateListQuery)
    def get(
        self,
        req_data: PipelineTemplateListQuery,
        request_context: RequestContext,
    ) -> JsonResponseWithStatus:
        result = application_services().knowledge.pipeline_templates.list_templates(
            request_context, req_data.type, req_data.language
        )
        return dump_response(PipelineTemplateListResponse, result), 200


@console_ns.route("/rag/pipeline/templates/<string:template_id>")
class PipelineTemplateDetailApi(Resource):
    @console_ns.doc(params=query_params_from_model(PipelineTemplateDetailQuery))
    @console_ns.response(200, "Pipeline template", console_ns.models[PipelineTemplateDetailResponse.__name__])
    @console_ns.response(404, "Pipeline template not found")
    @console_account_admission(require_valid_enterprise_license=True)
    @model_validate(PipelineTemplateDetailQuery)
    def get(
        self,
        req_data: PipelineTemplateDetailQuery,
        request_context: RequestContext,
        template_id: str,
    ) -> JsonResponseWithStatus:
        result = application_services().knowledge.pipeline_templates.get_template(
            request_context, template_id, req_data.type
        )
        if result is None:
            raise NotFound("Pipeline template not found from upstream service.")
        return dump_response(PipelineTemplateDetailResponse, result), 200


@console_ns.route("/rag/pipeline/customized/templates/<string:template_id>")
class CustomizedPipelineTemplateApi(Resource):
    @console_ns.expect(console_ns.models[CustomizedPipelineTemplatePayload.__name__])
    @console_ns.response(204, "Pipeline template updated")
    @console_account_admission(require_valid_enterprise_license=True)
    @model_validate(CustomizedPipelineTemplatePayload)
    def patch(
        self,
        req_data: CustomizedPipelineTemplatePayload,
        request_context: RequestContext,
        template_id: str,
    ) -> tuple[str, int]:
        info = PipelineTemplateInfoEntity.model_validate(req_data.model_dump())
        try:
            application_services().knowledge.pipeline_templates.update(
                request_context,
                template_id,
                PipelineTemplateInput(info.name, info.description, info.icon_info.model_dump()),
            )
        except (PipelineTemplateNotFoundError, PipelineTemplateNameConflictError) as exc:
            raise ValueError(str(exc)) from exc
        return "", 204

    @console_ns.response(204, "Pipeline template deleted")
    @console_account_admission(require_valid_enterprise_license=True)
    def delete(self, request_context: RequestContext, template_id: str) -> tuple[str, int]:
        try:
            application_services().knowledge.pipeline_templates.delete(request_context, template_id)
        except PipelineTemplateNotFoundError as exc:
            raise ValueError(str(exc)) from exc
        return "", 204

    @console_ns.response(200, "Success", console_ns.models[SimpleDataResponse.__name__])
    @console_ns.response(404, "Customized pipeline template not found")
    @console_account_admission(require_valid_enterprise_license=True)
    def post(self, request_context: RequestContext, template_id: str) -> JsonResponseWithStatus:
        try:
            yaml_content = application_services().knowledge.pipeline_templates.get_yaml(request_context, template_id)
        except PipelineTemplateNotFoundError as exc:
            raise NotFound(str(exc)) from exc
        return dump_response(SimpleDataResponse, {"data": yaml_content}), 200


@console_ns.route("/rag/pipelines/<string:pipeline_id>/customized/publish")
class PublishCustomizedPipelineTemplateApi(Resource):
    @console_ns.expect(console_ns.models[CustomizedPipelineTemplatePayload.__name__])
    @console_ns.response(204, "Pipeline template published")
    @console_ns.response(404, "Pipeline, workflow, or dataset not found")
    @console_account_admission(require_valid_enterprise_license=True)
    @knowledge_pipeline_publish_enabled
    @get_rag_pipeline
    @rbac_permission_required(RBACCheck(RBACPermission.DATASET_PIPELINE_RELEASE, DatasetByPipeline()))
    @model_validate(CustomizedPipelineTemplatePayload)
    def post(
        self,
        req_data: CustomizedPipelineTemplatePayload,
        request_context: RequestContext,
        pipeline: Pipeline,
    ) -> tuple[str, int]:
        account, _ = current_account_with_tenant()
        try:
            application_services().knowledge.pipeline_templates.publish(
                request_context,
                pipeline.id,
                PipelineTemplateInput(req_data.name, req_data.description, req_data.icon_info),
                can_edit_datasets=account.is_dataset_editor,
            )
        except (PipelineTemplateNotFoundError, DatasetNotFoundError) as exc:
            raise NotFound(str(exc)) from exc
        except PipelineTemplateNameConflictError as exc:
            raise ValueError(str(exc)) from exc
        except PipelineTemplatePublishForbiddenError as exc:
            raise Forbidden() from exc
        except DatasetAccessDeniedError as exc:
            raise Forbidden("You do not have permission to access this dataset.") from exc
        return "", 204
