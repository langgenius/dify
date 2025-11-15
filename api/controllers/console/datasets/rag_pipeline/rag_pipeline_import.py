from flask_restx import Resource, marshal_with, reqparse  # type: ignore
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console import console_ns
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
)
from extensions.ext_database import db
from fields.rag_pipeline_fields import pipeline_import_check_dependencies_fields, pipeline_import_fields
from libs.login import current_account_with_tenant, login_required
from models.dataset import Pipeline
from services.app_dsl_service import ImportStatus
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService


@console_ns.route("/rag/pipelines/imports")
class RagPipelineImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(pipeline_import_fields)
    def post(self):
        # Check user role first
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

        parser = (
            reqparse.RequestParser()
            .add_argument("mode", type=str, required=True, location="json")
            .add_argument("yaml_content", type=str, location="json")
            .add_argument("yaml_url", type=str, location="json")
            .add_argument("name", type=str, location="json")
            .add_argument("description", type=str, location="json")
            .add_argument("icon_type", type=str, location="json")
            .add_argument("icon", type=str, location="json")
            .add_argument("icon_background", type=str, location="json")
            .add_argument("pipeline_id", type=str, location="json")
        )
        args = parser.parse_args()

        # Create service with session
        with Session(db.engine) as session:
            import_service = RagPipelineDslService(session)
            # Import app
            account = current_user
            result = import_service.import_rag_pipeline(
                account=account,
                import_mode=args["mode"],
                yaml_content=args.get("yaml_content"),
                yaml_url=args.get("yaml_url"),
                pipeline_id=args.get("pipeline_id"),
                dataset_name=args.get("name"),
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
    @marshal_with(pipeline_import_fields)
    def post(self, import_id):
        current_user, _ = current_account_with_tenant()
        # Check user role first
        if not current_user.has_edit_permission:
            raise Forbidden()

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
    @marshal_with(pipeline_import_check_dependencies_fields)
    def get(self, pipeline: Pipeline):
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

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
    def get(self, pipeline: Pipeline):
        current_user, _ = current_account_with_tenant()
        if not current_user.has_edit_permission:
            raise Forbidden()

            # Add include_secret params
        parser = reqparse.RequestParser().add_argument("include_secret", type=str, default="false", location="args")
        args = parser.parse_args()

        with Session(db.engine) as session:
            export_service = RagPipelineDslService(session)
            result = export_service.export_rag_pipeline_dsl(
                pipeline=pipeline, include_secret=args["include_secret"] == "true"
            )

        return {"data": result}, 200
