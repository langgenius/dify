from datetime import datetime
from typing import cast

from flask import request
from flask_restx import Namespace, Resource
from pydantic import BaseModel, Field, RootModel, field_validator
from sqlalchemy import select

from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.console import api
from extensions.ext_database import db
from fields.base import ResponseModel
from libs.helper import dump_response
from models.enums import BannerStatus
from models.model import ExporleBanner
from services.feature_service import FeatureService


class BannerListQuery(BaseModel):
    language: str = Field(default="en-US", description="Banner language")


class BannerContentResponse(ResponseModel):
    category: str
    title: str = Field(min_length=1)
    description: str
    image_source: str = Field(
        min_length=1,
        validation_alias="img-src",
        serialization_alias="img-src",
    )


class BannerResponse(ResponseModel):
    id: str
    content: BannerContentResponse
    link: str
    sort: int
    status: BannerStatus
    created_at: str

    @field_validator("created_at", mode="before")
    @classmethod
    def serialize_created_at(cls, value: datetime | str) -> str:
        if isinstance(value, datetime):
            return value.isoformat()
        return value


class BannerListResponse(RootModel[list[BannerResponse]]):
    root: list[BannerResponse]


register_response_schema_models(
    cast(Namespace, api),
    BannerContentResponse,
    BannerResponse,
    BannerListResponse,
)


class BannerApi(Resource):
    """Resource for banner list."""

    @api.doc(params=query_params_from_model(BannerListQuery))
    @api.response(200, "Success", api.models[BannerListResponse.__name__])
    def get(self):
        """Get banner list."""
        if not FeatureService.is_explore_banner_enabled():
            return dump_response(BannerListResponse, [])

        query = BannerListQuery.model_validate(request.args.to_dict(flat=True))

        # Build base query for enabled banners
        base_query = select(ExporleBanner).where(ExporleBanner.status == BannerStatus.ENABLED)

        # Try to get banners in the requested language
        banners = db.session.scalars(
            base_query.where(ExporleBanner.language == query.language).order_by(ExporleBanner.sort)
        ).all()

        # Fallback to en-US if no banners found and language is not en-US
        if not banners and query.language != "en-US":
            banners = db.session.scalars(
                base_query.where(ExporleBanner.language == "en-US").order_by(ExporleBanner.sort)
            ).all()

        return dump_response(BannerListResponse, banners)


api.add_resource(BannerApi, "/explore/banners")
