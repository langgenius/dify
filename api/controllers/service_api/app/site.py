from flask_restful import Resource, marshal_with
from werkzeug.exceptions import Forbidden

from controllers.common import fields
from controllers.service_api import api
from controllers.service_api.wraps import validate_app_token
from extensions.ext_database import db
from models.account import TenantStatus
from models.model import App, Site


class AppSiteApi(Resource):
    """Resource for app sites."""

    @validate_app_token
    @marshal_with(fields.site_fields)
    def get(self, app_model: App):
        """Retrieve app site info."""
        site = db.session.query(Site).where(Site.app_id == app_model.id).first()

        if not site:
            raise Forbidden()

        if app_model.tenant.status == TenantStatus.ARCHIVE:
            raise Forbidden()

        return site


api.add_resource(AppSiteApi, "/site")
