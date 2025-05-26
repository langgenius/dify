
from flask_login import current_user  # type: ignore
from flask_restful import Resource  # type: ignore
from werkzeug.exceptions import Forbidden

from controllers.console import api
from controllers.console.wraps import (
    account_initialization_required,
    setup_required,
)
from core.plugin.impl.datasource import PluginDatasourceManager
from libs.login import login_required


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
