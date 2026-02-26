from flask import request
from flask_restx import Resource, fields, marshal_with  # type: ignore
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from controllers.common.schema import get_or_create_model, register_schema_models
from controllers.console import console_ns
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import (
    account_initialization_required,
    edit_permission_required,
    setup_required,
)
from extensions.ext_database import db
from fields.rag_pipeline_fields import (
    leaked_dependency_fields,
    pipeline_import_check_dependencies_fields,
    pipeline_import_fields,
)
from libs.login import current_account_with_tenant, login_required
from models.dataset import Pipeline
from services.app_dsl_service import ImportStatus
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
    include_secret: str = Field(default="false")


register_schema_models(console_ns, RagPipelineImportPayload, IncludeSecretQuery)


pipeline_import_model = get_or_create_model("RagPipelineImport", pipeline_import_fields)

leaked_dependency_model = get_or_create_model("RagPipelineLeakedDependency", leaked_dependency_fields)
pipeline_import_check_dependencies_fields_copy = pipeline_import_check_dependencies_fields.copy()
pipeline_import_check_dependencies_fields_copy["leaked_dependencies"] = fields.List(
    fields.Nested(leaked_dependency_model)
)
pipeline_import_check_dependencies_model = get_or_create_model(
    "RagPipelineImportCheckDependencies", pipeline_import_check_dependencies_fields_copy
)


@console_ns.route("/rag/pipelines/imports")
class RagPipelineImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @marshal_with(pipeline_import_model)
    @console_ns.expect(console_ns.models[RagPipelineImportPayload.__name__])
    def post(self):
        # Check user role first
        current_user, _ = current_account_with_tenant()
        payload = RagPipelineImportPayload.model_validate(console_ns.payload or {})

        # Create service with session
        with Session(db.engine) as session:
            import_service = RagPipelineDslService(session)
            # Import app
            account = current_user
            result = import_service.import_rag_pipeline(
                account=account,
                import_mode=payload.mode,
                yaml_content=payload.yaml_content,
                yaml_url=payload.yaml_url,
                pipeline_id=payload.pipeline_id,
                dataset_name=payload.name,
            )
            session.commit()

        # Return appropriate status code based on result
        status = result.status
        if status == ImportStatus.FAILED:
            return result.model_dump(mode="json"), 400
        elif status == ImportStatus.PENDING:
            return result.model_dump(mode="json"), 202
        return result.model_dump(mode="json"), 200


@console_ns.route("/rag/pipelines/imports/<string:import_id>/confirm")
class RagPipelineImportConfirmApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @edit_permission_required
    @marshal_with(pipeline_import_model)
    def post(self, import_id):
        current_user, _ = current_account_with_tenant()

        # Create service with session
        with Session(db.engine) as session:
            import_service = RagPipelineDslService(session)
            # Confirm import
            account = current_user
            result = import_service.confirm_import(import_id=import_id, account=account)
            session.commit()

        # Return appropriate status code based on result
        if result.status == ImportStatus.FAILED:
            return result.model_dump(mode="json"), 400
        return result.model_dump(mode="json"), 200


@console_ns.route("/rag/pipelines/imports/<string:pipeline_id>/check-dependencies")
class RagPipelineImportCheckDependenciesApi(Resource):
    @setup_required
    @login_required
    @get_rag_pipeline
    @account_initialization_required
    @edit_permission_required
    @marshal_with(pipeline_import_check_dependencies_model)
    def get(self, pipeline: Pipeline):
        with Session(db.engine) as session:
            import_service = RagPipelineDslService(session)
            result = import_service.check_dependencies(pipeline=pipeline)

        return result.model_dump(mode="json"), 200


@console_ns.route("/rag/pipelines/<string:pipeline_id>/exports")
class RagPipelineExportApi(Resource):
    @setup_required
    @login_required
    @get_rag_pipeline
    @account_initialization_required
    @edit_permission_required
    def get(self, pipeline: Pipeline):
        # Add include_secret params
        query = IncludeSecretQuery.model_validate(request.args.to_dict())

        with Session(db.engine) as session:
            export_service = RagPipelineDslService(session)
            result = export_service.export_rag_pipeline_dsl(
                pipeline=pipeline, include_secret=query.include_secret == "true"
            )

        return {"data": result}, 200
