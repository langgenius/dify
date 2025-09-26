from flask_restx import Resource

from controllers.console import api
from controllers.console.explore.wraps import explore_banner_enabled
from extensions.ext_database import db
from models.model import ExporleBanner


class BannerApi(Resource):
    """Resource for banner list."""

    @explore_banner_enabled
    def get(self):
        """Get banner list."""
        banners = (
            db.session.query(ExporleBanner).where(ExporleBanner.status == "enabled").order_by(ExporleBanner.sort).all()
        )

        # Convert banners to serializable format
        result = []
        for banner in banners:
            banner_data = {
                "content": banner.content,  # Already parsed as JSON by SQLAlchemy
                "link": banner.link,
                "sort": banner.sort,
                "status": banner.status,
                "created_at": banner.created_at.isoformat() if banner.created_at else None,
            }
            result.append(banner_data)

        return result


api.add_resource(BannerApi, "/explore/banners")
