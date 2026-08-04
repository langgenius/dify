from __future__ import annotations

from flask import request
from flask_restx import Resource
from sqlalchemy import select
from werkzeug.exceptions import NotFound

from controllers.common.site import build_site_icon_url
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import enterprise_inner_api_only
from extensions.ext_database import db
from models import App, Site


@inner_api_ns.route("/enterprise/app-deploy/sites/<string:app_id>")
class EnterpriseAppDeploySite(Resource):
    @enterprise_inner_api_only
    def get(self, app_id: str):
        tenant_id = request.headers.get("X-AppDeploy-Tenant-ID")
        app_model = db.session.scalar(select(App).where(App.id == app_id, App.tenant_id == tenant_id).limit(1))
        if app_model is None:
            raise NotFound("App not found")

        site = db.session.scalar(select(Site).where(Site.app_id == app_model.id).limit(1))
        if site is None:
            raise NotFound("Site not found")

        return {
            "app_id": app_model.id,
            "title": site.title,
            "icon_type": getattr(site.icon_type, "value", site.icon_type),
            "icon": site.icon,
            "icon_background": site.icon_background,
            "icon_url": build_site_icon_url(site=site, tenant_id=app_model.tenant_id),
            "description": site.description,
            "copyright": site.copyright,
            "privacy_policy": site.privacy_policy,
            "custom_disclaimer": site.custom_disclaimer,
            "default_language": site.default_language,
            "show_workflow_steps": site.show_workflow_steps,
            "use_icon_as_answer_icon": site.use_icon_as_answer_icon,
        }, 200
