from typing import cast

from flask_login import current_user  # type: ignore
from flask_restful import Resource, marshal_with, reqparse  # type: ignore
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.datasets.wraps import get_rag_pipeline
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
)
from core.plugin.impl.datasource import PluginDatasourceManager
from extensions.ext_database import db
from fields.rag_pipeline_fields import pipeline_import_check_dependencies_fields, pipeline_import_fields
from libs.login import login_required
from models import Account
from models.dataset import Pipeline
from services.app_dsl_service import ImportStatus
from services.rag_pipeline.rag_pipeline_dsl_service import RagPipelineDslService


class DatasourcePluginOauthApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, datasource_type, datasource_name):
        # Check user role first
        if not current_user.is_editor:
            raise Forbidden()
        # get all builtin providers
        manager = PluginDatasourceManager()
        providers = manager.get_provider_oauth_url()
        return providers




# Import Rag Pipeline
api.add_resource(
    DatasourcePluginOauthApi,
    "/datasource/<string:datasoruce_type>/<string:datasource_name>/oauth",
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
