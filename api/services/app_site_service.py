from typing import Optional

from extensions.ext_database import db
from models.model import App, Site


class AppSiteService:
    """Service for managing app sites"""

    @classmethod
    def update_site_with_app(cls, app_model: App) -> Optional[Site]:
        """Update the site with the given app model"""
        site = db.session.query(Site).filter(Site.app_id == app_model.id).first()
        if not site:
            return None

        site.title = app_model.name
        site.icon = app_model.icon
        site.icon_background = app_model.icon_background
        site.description = app_model.description

        db.session.commit()
        return site
