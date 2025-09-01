from flask_restx import Resource
from werkzeug.exceptions import Forbidden

from controllers.common.fields import build_site_model
from controllers.service_api import service_api_ns
from controllers.service_api.wraps import validate_app_token
from extensions.ext_database import db
from models.account import TenantStatus
from models.model import App, Site


@service_api_ns.route("/site")
class AppSiteApi(Resource):
    """Resource for app sites."""

    @service_api_ns.doc("get_app_site")
    @service_api_ns.doc(description="Get application site configuration")
    @service_api_ns.doc(
        responses={
            200: "Site configuration retrieved successfully",
            401: "Unauthorized - invalid API token",
            403: "Forbidden - site not found or tenant archived",
        }
    )
    @validate_app_token
    @service_api_ns.marshal_with(build_site_model(service_api_ns))
    def get(self, app_model: App):
        """Retrieve app site info.

        Returns the site configuration for the application including theme, icons, and text.
        """
        site = db.session.query(Site).where(Site.app_id == app_model.id).first()

        if not site:
            raise Forbidden()

        assert app_model.tenant
        if app_model.tenant.status == TenantStatus.ARCHIVE:
            raise Forbidden()

        return site
