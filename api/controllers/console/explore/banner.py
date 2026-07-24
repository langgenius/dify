from flask import request
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
        language = request.args.get("language", "en-US")

        # Build base query for enabled banners
        base_query = db.session.query(ExporleBanner).where(ExporleBanner.status == "enabled")

        # Try to get banners in the requested language
        banners = base_query.where(ExporleBanner.language == language).order_by(ExporleBanner.sort).all()

        # Fallback to en-US if no banners found and language is not en-US
        if not banners and language != "en-US":
            banners = base_query.where(ExporleBanner.language == "en-US").order_by(ExporleBanner.sort).all()
        # Convert banners to serializable format
        result = []
        for banner in banners:
            banner_data = {
                "id": banner.id,
                "content": banner.content,  # Already parsed as JSON by SQLAlchemy
                "link": banner.link,
                "sort": banner.sort,
                "status": banner.status,
                "created_at": banner.created_at.isoformat() if banner.created_at else None,
            }
            result.append(banner_data)

        return result


api.add_resource(BannerApi, "/explore/banners")
