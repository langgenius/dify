from flask_restx import Resource
from pydantic import BaseModel

import services
from controllers.common.schema import JsonResponseWithStatus, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.datasets.rag_pipeline.rag_pipeline_import import RagPipelineImportResponse
from controllers.console.flask_admission import console_account_admission
from controllers.console.wraps import (
    cloud_edition_billing_rate_limit_check,
    model_validate,
)
from extensions.ext_application_services import application_services
from fields.dataset_fields import (
    DatasetDetailResponse,
)
from libs.external_api import error_responses
from libs.helper import dump_response
from machinery.context import RequestContext
from models.account import TenantAccountRole
from models.dataset import DatasetPermissionEnum
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo

_DATASET_EDIT_ROLES = frozenset(
    {TenantAccountRole.OWNER, TenantAccountRole.ADMIN, TenantAccountRole.EDITOR, TenantAccountRole.DATASET_OPERATOR}
)


class RagPipelineDatasetImportPayload(BaseModel):
    yaml_content: str


register_schema_models(console_ns, RagPipelineDatasetImportPayload)
register_response_schema_models(console_ns, DatasetDetailResponse, RagPipelineImportResponse)


@console_ns.route("/rag/pipeline/dataset")
class CreateRagPipelineDatasetApi(Resource):
    @error_responses(DatasetNameDuplicateError)
    @console_ns.expect(console_ns.models[RagPipelineDatasetImportPayload.__name__])
    @console_ns.response(
        201,
        "RAG pipeline dataset import started",
        console_ns.models[RagPipelineImportResponse.__name__],
    )
    @console_account_admission(allowed_roles=_DATASET_EDIT_ROLES)
    @cloud_edition_billing_rate_limit_check("knowledge")
    @model_validate(RagPipelineDatasetImportPayload)
    def post(
        self,
        req_data: RagPipelineDatasetImportPayload,
        request_context: RequestContext,
    ) -> JsonResponseWithStatus:
        try:
            import_info = application_services().knowledge.pipeline_workflows.import_dataset(
                request_context,
                yaml_content=req_data.yaml_content,
            )
        except services.errors.dataset.DatasetNameDuplicateError as caught_error:
            raise DatasetNameDuplicateError() from caught_error

        return dump_response(RagPipelineImportResponse, import_info), 201


@console_ns.route("/rag/pipeline/empty-dataset")
class CreateEmptyRagPipelineDatasetApi(Resource):
    @console_ns.response(201, "RAG pipeline dataset created", console_ns.models[DatasetDetailResponse.__name__])
    @console_account_admission(
        allowed_roles=_DATASET_EDIT_ROLES,
    )
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self, request_context: RequestContext) -> JsonResponseWithStatus:
        try:
            dataset = application_services().knowledge.datasets.create_rag_pipeline_dataset(
                request_context,
                values={
                    "name": "",
                    "description": "",
                    "icon_info": IconInfo(
                        icon="📙",
                        icon_background="#FFF4ED",
                        icon_type="emoji",
                    ).model_dump(),
                    "permission": DatasetPermissionEnum.ONLY_ME,
                    "partial_member_list": None,
                },
            )
        except services.errors.dataset.DatasetNameDuplicateError as error:
            raise DatasetNameDuplicateError() from error
        return dump_response(DatasetDetailResponse, dataset), 201
