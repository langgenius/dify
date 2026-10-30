from flask_restx import Resource
from pydantic import BaseModel
from werkzeug.exceptions import Forbidden

import services
from configs import dify_config
from controllers.common.schema import JsonResponseWithStatus, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.datasets.permission_keys import get_dataset_permission_keys
from controllers.console.datasets.rag_pipeline.rag_pipeline_import import RagPipelineImportResponse
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    model_validate,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from core.logging.context import get_request_id, get_trace_id
from extensions.ext_application_services import application_services
from extensions.ext_database import db
from fields.dataset_fields import (
    DatasetDetailResponse,
)
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import login_required
from machinery.context import RequestContext
from models import Account
from models.dataset import DatasetPermissionEnum
from services.enterprise import rbac_service as enterprise_rbac_service
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, RagPipelineDatasetCreateEntity
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService
from services.rbac import contracts as rbac_contracts


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
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @with_current_tenant_id
    @model_validate(RagPipelineDatasetImportPayload)
    def post(
        self,
        req_data: RagPipelineDatasetImportPayload,
        current_tenant_id: str,
        current_user: Account,
    ) -> JsonResponseWithStatus:
        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()
        rag_pipeline_dataset_create_entity = RagPipelineDatasetCreateEntity(
            name="",
            description="",
            icon_info=IconInfo(
                icon="📙",
                icon_background="#FFF4ED",
                icon_type="emoji",
            ),
            permission=DatasetPermissionEnum.ONLY_ME,
            partial_member_list=None,
            yaml_content=req_data.yaml_content,
        )
        try:
            rag_pipeline_dsl_service = RagPipelineDslService(db.session())
            import_info = rag_pipeline_dsl_service.create_rag_pipeline_dataset(
                tenant_id=current_tenant_id,
                rag_pipeline_dataset_create_entity=rag_pipeline_dataset_create_entity,
            )
            dataset_id = import_info["dataset_id"]
            db.session.commit()
        except services.errors.dataset.DatasetNameDuplicateError as caught_error:
            raise DatasetNameDuplicateError() from caught_error

        if dify_config.RBAC_ENABLED and dataset_id is not None:
            enterprise_rbac_service.RBACService.DatasetAccess.replace_whitelist(
                current_tenant_id,
                current_user.id,
                dataset_id,
                rbac_contracts.ReplaceMemberBindings(automatic_include_workspace_members=False),
            )
            enterprise_rbac_service.try_sync_creator_access_policy_member_bindings(
                current_tenant_id,
                current_user.id,
                rbac_contracts.RBACResourceType.DATASET,
                dataset_id,
            )

        return dump_response(RagPipelineImportResponse, import_info), 201


@console_ns.route("/rag/pipeline/empty-dataset")
class CreateEmptyRagPipelineDatasetApi(Resource):
    @console_ns.response(201, "RAG pipeline dataset created", console_ns.models[DatasetDetailResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account) -> JsonResponseWithStatus:
        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()
        context = RequestContext(
            request_id=get_request_id(),
            trace_id=get_trace_id(),
            account_id=current_user.id,
            active_workspace_id=current_tenant_id,
        )
        dataset = application_services().knowledge.datasets.create_rag_pipeline_dataset(
            context,
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
        return dump_response(
            DatasetDetailResponse,
            {**dataset, "permission_keys": get_dataset_permission_keys(context, dataset["id"])},
        ), 201
