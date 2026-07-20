from typing import Any, cast

from flask import request
from flask_restx import Namespace, Resource
from pydantic import BaseModel, Field, RootModel
from sqlalchemy import select

from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.console import api
from controllers.console.explore.wraps import explore_banner_enabled
from extensions.ext_database import db
from fields.base import ResponseModel
from models.enums import BannerStatus
from models.model import ExporleBanner


class BannerListQuery(BaseModel):
    language: str = Field(default="en-US", description="Banner language")


class BannerResponse(ResponseModel):
    id: str
    content: Any
    link: str | None = None
    sort: int
    status: str
    created_at: str | None = None


class BannerListResponse(RootModel[list[BannerResponse]]):
    root: list[BannerResponse]


register_response_schema_models(cast(Namespace, api), BannerListResponse)


class BannerApi(Resource):
    """Resource for banner list."""

    @api.doc(params=query_params_from_model(BannerListQuery))
    @api.response(200, "Success", api.models[BannerListResponse.__name__])
    @explore_banner_enabled
    def get(self):
        """Get banner list."""
        language = request.args.get("language", "en-US")

        # Build base query for enabled banners
        base_query = select(ExporleBanner).where(ExporleBanner.status == BannerStatus.ENABLED)

        # Try to get banners in the requested language
        banners = db.session.scalars(
            base_query.where(ExporleBanner.language == language).order_by(ExporleBanner.sort)
        ).all()

        # Fallback to en-US if no banners found and language is not en-US
        if not banners and language != "en-US":
            banners = db.session.scalars(
                base_query.where(ExporleBanner.language == "en-US").order_by(ExporleBanner.sort)
            ).all()
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
