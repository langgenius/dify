from datetime import datetime
from typing import cast

from flask_restx import Namespace, Resource
from pydantic import BaseModel, Field, RootModel, field_validator

from controllers.common.schema import query_params_from_model, register_response_schema_models
from controllers.console import api
from controllers.console.wraps import model_validate
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.helper import dump_response
from models.enums import BannerStatus


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
    @model_validate(BannerListQuery)
    def get(self, req_data: BannerListQuery):
        """Get banner list."""
        banners = application_services().explore_banner_queries.list_for_language(req_data.language)
        return dump_response(BannerListResponse, banners)


api.add_resource(BannerApi, "/explore/banners")
