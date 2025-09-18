from typing import cast

from flask_login import current_user  # type: ignore
from flask_restx import Resource, marshal_with, reqparse  # type: ignore
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
)
from extensions.ext_database import db
from fields.rag_pipeline_fields import pipeline_import_check_dependencies_fields, pipeline_import_fields
from libs.login import login_required
from models import Account
from models.dataset import Pipeline
from services.app_dsl_service import ImportStatus
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService


class RagPipelineImportApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(pipeline_import_fields)
    def post(self):
        # Check user role first
        if not current_user.is_editor:
            raise Forbidden()

        parser = reqparse.RequestParser()
        parser.add_argument("mode", type=str, required=True, location="json")
        parser.add_argument("yaml_content", type=str, location="json")
        parser.add_argument("yaml_url", type=str, location="json")
        parser.add_argument("name", type=str, location="json")
        parser.add_argument("description", type=str, location="json")
        parser.add_argument("icon_type", type=str, location="json")
        parser.add_argument("icon", type=str, location="json")
        parser.add_argument("icon_background", type=str, location="json")
        parser.add_argument("pipeline_id", type=str, location="json")
        args = parser.parse_args()

        # Create service with session
        with Session(db.engine) as session:
            import_service = RagPipelineDslService(session)
            # Import app
            account = cast(Account, current_user)
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
        if status == ImportStatus.FAILED.value:
            return result.model_dump(mode="json"), 400
        elif status == ImportStatus.PENDING.value:
            return result.model_dump(mode="json"), 202
        return result.model_dump(mode="json"), 200


class RagPipelineImportConfirmApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    @marshal_with(pipeline_import_fields)
    def post(self, import_id):
        # Check user role first
        if not current_user.is_editor:
            raise Forbidden()

        # Create service with session
        with Session(db.engine) as session:
            import_service = RagPipelineDslService(session)
            # Confirm import
            account = cast(Account, current_user)
            result = import_service.confirm_import(import_id=import_id, account=account)
            session.commit()

        # Return appropriate status code based on result
        if result.status == ImportStatus.FAILED.value:
            return result.model_dump(mode="json"), 400
        return result.model_dump(mode="json"), 200


class RagPipelineImportCheckDependenciesApi(Resource):
    @setup_required
    @login_required
    @get_rag_pipeline
    @account_initialization_required
    @marshal_with(pipeline_import_check_dependencies_fields)
    def get(self, pipeline: Pipeline):
        if not current_user.is_editor:
            raise Forbidden()

        with Session(db.engine) as session:
            import_service = RagPipelineDslService(session)
            result = import_service.check_dependencies(pipeline=pipeline)

        return result.model_dump(mode="json"), 200


class RagPipelineExportApi(Resource):
    @setup_required
    @login_required
    @get_rag_pipeline
    @account_initialization_required
    def get(self, pipeline: Pipeline):
        if not current_user.is_editor:
            raise Forbidden()

            # Add include_secret params
        parser = reqparse.RequestParser()
        parser.add_argument("include_secret", type=bool, default=False, location="args")
        args = parser.parse_args()

        with Session(db.engine) as session:
            export_service = RagPipelineDslService(session)
            result = export_service.export_rag_pipeline_dsl(pipeline=pipeline, include_secret=args["include_secret"])

        return {"data": result}, 200


# Import Rag Pipeline
api.add_resource(
    RagPipelineImportApi,
    "/rag/pipelines/imports",
)
api.add_resource(
    RagPipelineImportConfirmApi,
    "/rag/pipelines/imports/<string:import_id>/confirm",
)
api.add_resource(
    RagPipelineImportCheckDependenciesApi,
    "/rag/pipelines/imports/<string:pipeline_id>/check-dependencies",
)
api.add_resource(
    RagPipelineExportApi,
    "/rag/pipelines/<string:pipeline_id>/exports",
)
