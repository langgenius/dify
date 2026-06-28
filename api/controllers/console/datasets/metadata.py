from typing import Literal
from uuid import UUID

from flask_restx import Resource
from werkzeug.exceptions import Forbidden, NotFound

from controllers.common.controller_schemas import MetadataUpdatePayload
from controllers.common.schema import register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    enterprise_license_required,
    rbac_permission_required,
    setup_required,
    with_current_tenant_id,
    with_current_user,
)
from extensions.ext_database import db
from fields.dataset_fields import (
    DatasetMetadataBuiltInFieldsResponse,
    DatasetMetadataListResponse,
    DatasetMetadataResponse,
)
from libs.helper import dump_response
from libs.login import login_required
from models.account import Account
from services.dataset_service import DatasetService
from services.entities.knowledge_entities.knowledge_entities import (
    DocumentMetadataOperation,
    MetadataArgs,
    MetadataDetail,
    MetadataOperationData,
)
from services.errors.account import NoPermissionError
from services.metadata_service import MetadataService

register_schema_models(
    console_ns, MetadataArgs, MetadataOperationData, MetadataUpdatePayload, DocumentMetadataOperation, MetadataDetail
)
register_response_schema_models(
    console_ns,
    DatasetMetadataBuiltInFieldsResponse,
    DatasetMetadataListResponse,
    DatasetMetadataResponse,
)


@console_ns.route("/datasets/<uuid:dataset_id>/metadata")
class DatasetMetadataCreateApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @console_ns.response(201, "Metadata created successfully", console_ns.models[DatasetMetadataResponse.__name__])
    @console_ns.expect(console_ns.models[MetadataArgs.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def post(self, current_tenant_id: str, current_user: Account, dataset_id: UUID):
        metadata_args = MetadataArgs.model_validate(console_ns.payload or {})

        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        metadata = MetadataService.create_metadata(
            db.session(), dataset_id_str, metadata_args, current_user, current_tenant_id
        )
        return dump_response(DatasetMetadataResponse, metadata), 201

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @console_ns.response(
        200, "Metadata retrieved successfully", console_ns.models[DatasetMetadataListResponse.__name__]
    )
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_CREATE_AND_MANAGEMENT)
    def get(self, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        try:
            DatasetService.check_dataset_permission(dataset, current_user, db.session)
        except NoPermissionError as e:
            raise Forbidden(str(e))
        metadata = MetadataService.get_dataset_metadatas(db.session(), dataset)
        return dump_response(DatasetMetadataListResponse, metadata), 200


@console_ns.route("/datasets/<uuid:dataset_id>/metadata/<uuid:metadata_id>")
class DatasetMetadataApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @console_ns.response(200, "Metadata updated successfully", console_ns.models[DatasetMetadataResponse.__name__])
    @console_ns.expect(console_ns.models[MetadataUpdatePayload.__name__])
    @with_current_user
    @with_current_tenant_id
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def patch(self, current_tenant_id: str, current_user: Account, dataset_id: UUID, metadata_id: UUID):
        payload = MetadataUpdatePayload.model_validate(console_ns.payload or {})
        name = payload.name

        dataset_id_str = str(dataset_id)
        metadata_id_str = str(metadata_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        metadata = MetadataService.update_metadata_name(
            db.session(), dataset_id_str, metadata_id_str, name, current_user, current_tenant_id
        )
        return dump_response(DatasetMetadataResponse, metadata), 200

    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @console_ns.response(204, "Metadata deleted successfully")
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def delete(self, current_user: Account, dataset_id: UUID, metadata_id: UUID):
        dataset_id_str = str(dataset_id)
        metadata_id_str = str(metadata_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        MetadataService.delete_metadata(db.session(), dataset_id_str, metadata_id_str)
        # Frontend callers only await success and invalidate metadata caches; no response body is consumed.
        return "", 204


@console_ns.route("/datasets/metadata/built-in")
class DatasetMetadataBuiltInFieldApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @console_ns.response(
        200,
        "Built-in fields retrieved successfully",
        console_ns.models[DatasetMetadataBuiltInFieldsResponse.__name__],
    )
    def get(self):
        built_in_fields = MetadataService.get_built_in_fields()
        return dump_response(DatasetMetadataBuiltInFieldsResponse, {"fields": built_in_fields}), 200


@console_ns.route("/datasets/<uuid:dataset_id>/metadata/built-in/<string:action>")
class DatasetMetadataBuiltInFieldActionApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @console_ns.response(204, "Action completed successfully")
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def post(self, current_user: Account, dataset_id: UUID, action: Literal["enable", "disable"]):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        match action:
            case "enable":
                MetadataService.enable_built_in_field(db.session(), dataset)
            case "disable":
                MetadataService.disable_built_in_field(db.session(), dataset)
        # Frontend callers only await success and invalidate metadata caches; no response body is consumed.
        return "", 204


@console_ns.route("/datasets/<uuid:dataset_id>/documents/metadata")
class DocumentMetadataEditApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @enterprise_license_required
    @console_ns.expect(console_ns.models[MetadataOperationData.__name__])
    @console_ns.response(
        204,
        "Documents metadata updated successfully",
    )
    @with_current_user
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_EDIT)
    def post(self, current_user: Account, dataset_id: UUID):
        dataset_id_str = str(dataset_id)
        dataset = DatasetService.get_dataset(dataset_id_str)
        if dataset is None:
            raise NotFound("Dataset not found.")
        DatasetService.check_dataset_permission(dataset, current_user, db.session)

        metadata_args = MetadataOperationData.model_validate(console_ns.payload or {})

        MetadataService.update_documents_metadata(db.session(), dataset, metadata_args, current_user)

        # Frontend callers only await success and invalidate caches; no response body is consumed.
        return "", 204
