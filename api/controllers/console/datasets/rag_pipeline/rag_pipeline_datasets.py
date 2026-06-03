from flask_restx import Resource, marshal
from pydantic import BaseModel
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

import services
from controllers.common.schema import register_schema_model
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.dataset_fields import dataset_detail_fields
from libs.login import login_required
from models import Account
from models.dataset import DatasetPermissionEnum
from services.dataset_service import DatasetPermissionService, DatasetService
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, RagPipelineDatasetCreateEntity
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService


class RagPipelineDatasetImportPayload(BaseModel):
    yaml_content: str


register_schema_model(console_ns, RagPipelineDatasetImportPayload)


@console_ns.route("/rag/pipeline/dataset")
class CreateRagPipelineDatasetApi(Resource):
    @console_ns.expect(console_ns.models[RagPipelineDatasetImportPayload.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        payload = RagPipelineDatasetImportPayload.model_validate(console_ns.payload or {})
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
            yaml_content=payload.yaml_content,
        )
        try:
            with Session(db.engine, expire_on_commit=False) as session:
                rag_pipeline_dsl_service = RagPipelineDslService(session)
                import_info = rag_pipeline_dsl_service.create_rag_pipeline_dataset(
                    tenant_id=current_tenant_id,
                    rag_pipeline_dataset_create_entity=rag_pipeline_dataset_create_entity,
                )
                session.commit()
            if rag_pipeline_dataset_create_entity.permission == "partial_members":
                DatasetPermissionService.update_partial_member_list(
                    current_tenant_id,
                    import_info["dataset_id"],
                    rag_pipeline_dataset_create_entity.partial_member_list,
                )
        except services.errors.dataset.DatasetNameDuplicateError:
            raise DatasetNameDuplicateError()

        return import_info, 201


@console_ns.route("/rag/pipeline/empty-dataset")
class CreateEmptyRagPipelineDatasetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    @with_current_user
    @with_current_tenant_id
    def post(self, current_tenant_id: str, current_user: Account):
        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        if not current_user.is_dataset_editor:
            raise Forbidden()
        dataset = DatasetService.create_empty_rag_pipeline_dataset(
            tenant_id=current_tenant_id,
            rag_pipeline_dataset_create_entity=RagPipelineDatasetCreateEntity(
                name="",
                description="",
                icon_info=IconInfo(
                    icon="📙",
                    icon_background="#FFF4ED",
                    icon_type="emoji",
                ),
                permission=DatasetPermissionEnum.ONLY_ME,
                partial_member_list=None,
            ),
        )
        return marshal(dataset, dataset_detail_fields), 201
