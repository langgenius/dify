from controllers.common import fields
from controllers.console import console_ns
from controllers.console.app.error import AppUnavailableError
from controllers.console.explore.wraps import InstalledAppResource
from core.app.app_config.common.parameters_mapping import AppParametersUnavailableError, get_app_parameters
from models.model import InstalledApp
from services.app_service import AppService


@console_ns.route("/installed-apps/<uuid:installed_app_id>/parameters", endpoint="installed_app_parameters")
class AppParameterApi(InstalledAppResource):
    """Resource for app variables."""

    def get(self, installed_app: InstalledApp):
        """Retrieve app parameters."""
        app_model = installed_app.app

        if app_model is None:
            raise AppUnavailableError()

        try:
            parameters = get_app_parameters(app_model)
        except AppParametersUnavailableError:
            raise AppUnavailableError()
        return fields.Parameters.model_validate(parameters).model_dump(mode="json")


@console_ns.route("/installed-apps/<uuid:installed_app_id>/meta", endpoint="installed_app_meta")
class ExploreAppMetaApi(InstalledAppResource):
    def get(self, installed_app: InstalledApp):
        """Get app meta"""
        app_model = installed_app.app
        if not app_model:
            raise ValueError("App not found")
        return AppService().get_app_meta(app_model)
