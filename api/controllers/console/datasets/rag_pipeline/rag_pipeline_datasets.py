from flask_restx import Resource, marshal, reqparse
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

import services
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.wraps import (
    account_initialization_required,
    cloud_edition_billing_rate_limit_check,
    setup_required,
)
from extensions.ext_database import db
from fields.dataset_fields import dataset_detail_fields
from libs.login import current_account_with_tenant, login_required
from models.dataset import DatasetPermissionEnum
from services.dataset_service import DatasetPermissionService, DatasetService
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, RagPipelineDatasetCreateEntity
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService


@console_ns.route("/rag/pipeline/dataset")
class CreateRagPipelineDatasetApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @cloud_edition_billing_rate_limit_check("knowledge")
    def post(self):
        parser = reqparse.RequestParser().add_argument(
            "yaml_content",
            type=str,
            nullable=False,
            required=True,
            help="yaml_content is required.",
        )

        args = parser.parse_args()
        current_user, current_tenant_id = current_account_with_tenant()
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
            yaml_content=args["yaml_content"],
        )
        try:
            with Session(db.engine) as session:
                rag_pipeline_dsl_service = RagPipelineDslService(session)
                import_info = rag_pipeline_dsl_service.create_rag_pipeline_dataset(
                    tenant_id=current_tenant_id,
                    rag_pipeline_dataset_create_entity=rag_pipeline_dataset_create_entity,
                )
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
    def post(self):
        # The role of the current user in the ta table must be admin, owner, or editor, or dataset_operator
        current_user, current_tenant_id = current_account_with_tenant()

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
