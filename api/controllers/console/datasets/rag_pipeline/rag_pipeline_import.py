from flask_restx import Resource
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound

from controllers.common.fields import SimpleDataResponse
from controllers.common.schema import (
    JsonResponseWithStatus,
    query_params_from_model,
    register_response_schema_models,
    register_schema_models,
)
from controllers.common.wraps import enforce_rbac_access
from controllers.console import console_ns
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import (
    RBACPermission,
    RBACResourceScope,
    account_initialization_required,
    edit_permission_required,
    model_validate,
    rbac_permission_required,
    setup_required,
    with_current_user,
)
from core.plugin.entities.plugin import PluginDependency
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from models.account import Account
from models.dataset import Pipeline
from services.entities.dsl_entities import ImportStatus
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService


class RagPipelineImportPayload(BaseModel):
    mode: str
    yaml_content: str | None = None
    yaml_url: str | None = None
    name: str | None = None
    description: str | None = None
    icon_type: str | None = None
    icon: str | None = None
    icon_background: str | None = None
    pipeline_id: str | None = None


class IncludeSecretQuery(BaseModel):
    include_secret: str = Field(default="false", description="Whether to include secret values in the exported DSL")


class RagPipelineImportResponse(ResponseModel):
    id: str
    status: ImportStatus
    pipeline_id: str | None = None
    dataset_id: str | None = None
    current_dsl_version: str
    imported_dsl_version: str
    error: str = ""


class RagPipelineImportCheckDependenciesResponse(ResponseModel):
    leaked_dependencies: list[PluginDependency] = Field(default_factory=list)


register_schema_models(console_ns, RagPipelineImportPayload, IncludeSecretQuery)
register_response_schema_models(
    console_ns,
    RagPipelineImportCheckDependenciesResponse,
    RagPipelineImportResponse,
    SimpleDataResponse,
)


def _require_dataset_dsl_access(*, account: Account, dataset_id: str) -> None:
    tenant_id = account.current_tenant_id
    if tenant_id is None:
        raise ValueError("Current tenant is not set")

    enforce_rbac_access(
        tenant_id=tenant_id,
        account_id=account.id,
        resource_type=RBACResourceScope.DATASET,
        scene=RBACPermission.DATASET_IMPORT_EXPORT_DSL,
        path_args={"dataset_id": dataset_id},
    )


@console_ns.route("/rag/pipelines/imports")
class RagPipelineImportApi(Resource):
    @console_ns.expect(console_ns.models[RagPipelineImportPayload.__name__])
    @console_ns.response(200, "Import completed", console_ns.models[RagPipelineImportResponse.__name__])
    @console_ns.response(202, "Import pending confirmation", console_ns.models[RagPipelineImportResponse.__name__])
    @console_ns.response(400, "Import failed", console_ns.models[RagPipelineImportResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.DATASET, RBACPermission.DATASET_IMPORT_EXPORT_DSL, resource_required=False
    )
    @with_current_user
    @model_validate(RagPipelineImportPayload)
    def post(self, req_data: RagPipelineImportPayload, current_user: Account) -> JsonResponseWithStatus:
        # Check user role first

        # Use a plain Session so that caught exceptions inside the service
        # (which return FAILED status instead of re-raising) do not leave the
        # transaction in a closed state that a .begin() context manager cannot
        # handle.  See app_import.py for the canonical pattern.
        with Session(db.engine, expire_on_commit=False) as session:
            import_service = RagPipelineDslService(session)
            account = current_user
            if req_data.pipeline_id:
                dataset_id = import_service.get_pipeline_dataset_id(
                    pipeline_id=req_data.pipeline_id,
                    account=account,
                )
                if not dataset_id:
                    raise NotFound("Dataset not found for pipeline")
                _require_dataset_dsl_access(account=account, dataset_id=dataset_id)
            result = import_service.import_rag_pipeline(
                account=account,
                import_mode=req_data.mode,
                yaml_content=req_data.yaml_content,
                yaml_url=req_data.yaml_url,
                pipeline_id=req_data.pipeline_id,
                dataset_name=req_data.name,
            )
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()

        # Return appropriate status code based on result
        status = result.status
        match status:
            case ImportStatus.FAILED:
                return dump_response(RagPipelineImportResponse, result), 400
            case ImportStatus.PENDING:
                return dump_response(RagPipelineImportResponse, result), 202
            case ImportStatus.COMPLETED | ImportStatus.COMPLETED_WITH_WARNINGS:
                return dump_response(RagPipelineImportResponse, result), 200


@console_ns.route("/rag/pipelines/imports/<string:import_id>/confirm")
class RagPipelineImportConfirmApi(Resource):
    @console_ns.response(200, "Import confirmed", console_ns.models[RagPipelineImportResponse.__name__])
    @console_ns.response(400, "Import failed", console_ns.models[RagPipelineImportResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(
        RBACResourceScope.DATASET, RBACPermission.DATASET_IMPORT_EXPORT_DSL, resource_required=False
    )
    @with_current_user
    def post(self, current_user: Account, import_id: str) -> JsonResponseWithStatus:
        with Session(db.engine, expire_on_commit=False) as session:
            import_service = RagPipelineDslService(session)
            account = current_user
            pipeline_id = import_service.get_pending_pipeline_id(import_id=import_id, account=account)
            if pipeline_id:
                dataset_id = import_service.get_pipeline_dataset_id(
                    pipeline_id=pipeline_id,
                    account=account,
                )
                if not dataset_id:
                    raise NotFound("Dataset not found for pipeline")
                _require_dataset_dsl_access(account=account, dataset_id=dataset_id)
            result = import_service.confirm_import(import_id=import_id, account=account)
            if result.status == ImportStatus.FAILED:
                session.rollback()
            else:
                session.commit()

        # Return appropriate status code based on result
        if result.status == ImportStatus.FAILED:
            return dump_response(RagPipelineImportResponse, result), 400
        return dump_response(RagPipelineImportResponse, result), 200


@console_ns.route("/rag/pipelines/imports/<string:pipeline_id>/check-dependencies")
class RagPipelineImportCheckDependenciesApi(Resource):
    @console_ns.response(
        200,
        "Dependencies checked",
        console_ns.models[RagPipelineImportCheckDependenciesResponse.__name__],
    )
    @setup_required
    @login_required
    @get_rag_pipeline
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_READONLY)
    def get(self, pipeline: Pipeline) -> JsonResponseWithStatus:
        with Session(db.engine, expire_on_commit=False) as session:
            import_service = RagPipelineDslService(session)
            result = import_service.check_dependencies(pipeline=pipeline)

        return dump_response(RagPipelineImportCheckDependenciesResponse, result), 200


@console_ns.route("/rag/pipelines/<string:pipeline_id>/exports")
class RagPipelineExportApi(Resource):
    @console_ns.doc(params=query_params_from_model(IncludeSecretQuery))
    @console_ns.response(200, "Pipeline exported", console_ns.models[SimpleDataResponse.__name__])
    @setup_required
    @login_required
    @get_rag_pipeline
    @account_initialization_required
    @edit_permission_required
    @rbac_permission_required(RBACResourceScope.DATASET, RBACPermission.DATASET_IMPORT_EXPORT_DSL)
    @model_validate(IncludeSecretQuery)
    def get(self, req_data: IncludeSecretQuery, pipeline: Pipeline) -> JsonResponseWithStatus:
        # Add include_secret params

        with Session(db.engine, expire_on_commit=False) as session:
            export_service = RagPipelineDslService(session)
            result = export_service.export_rag_pipeline_dsl(
                pipeline=pipeline, include_secret=req_data.include_secret == "true"
            )

        return dump_response(SimpleDataResponse, {"data": result}), 200
