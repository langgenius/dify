from typing import Literal

from flask_restx import Resource
from pydantic import BaseModel, Field, RootModel

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.datasets.error import WebsiteCrawlError
from controllers.console.wraps import account_initialization_required, model_validate, setup_required
from extensions.ext_application_services import application_services
from fields.base import ResponseModel
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import login_required
from services.data_source.entities.website import CrawledPage, ScrapedPage
from services.data_source.website_service import WebsiteCrawlApiRequest, WebsiteCrawlStatusApiRequest


class WebsiteCrawlPayload(BaseModel):
    provider: Literal["firecrawl", "watercrawl", "jinareader"]
    url: str
    options: dict[str, object]


class WebsiteCrawlStatusQuery(BaseModel):
    provider: Literal["firecrawl", "watercrawl", "jinareader"]


class WebsiteCrawlStartedResponse(ResponseModel):
    status: str
    job_id: str


class WebsitePageCrawledResponse(ResponseModel):
    status: str
    data: ScrapedPage


class WebsiteCrawlResponse(RootModel[WebsiteCrawlStartedResponse | WebsitePageCrawledResponse]):
    """A remote crawl job or the immediately available single-page content."""


class WebsiteCrawlProgressResponse(ResponseModel):
    status: str
    job_id: str
    total: int
    current: int
    data: list[CrawledPage]
    time_consuming: str | float | None = Field(default=None, exclude_if=lambda value: value is None)


register_schema_models(console_ns, WebsiteCrawlPayload, WebsiteCrawlStatusQuery)
register_response_schema_models(console_ns, WebsiteCrawlResponse, WebsiteCrawlProgressResponse)


@console_ns.route("/website/crawl")
class WebsiteCrawlApi(Resource):
    @error_responses(WebsiteCrawlError)
    @console_ns.doc("crawl_website")
    @console_ns.doc(description="Crawl website content")
    @console_ns.expect(console_ns.models[WebsiteCrawlPayload.__name__])
    @console_ns.response(200, "Website crawl initiated successfully", console_ns.models[WebsiteCrawlResponse.__name__])
    @console_ns.response(400, "Invalid crawl parameters")
    @setup_required
    @login_required
    @account_initialization_required
    @model_validate(WebsiteCrawlPayload)
    def post(self, req_data: WebsiteCrawlPayload) -> tuple[dict[str, object], int]:
        # Create typed request and validate
        try:
            api_request = WebsiteCrawlApiRequest.from_args(req_data.model_dump())
        except ValueError as e:
            raise WebsiteCrawlError(str(e)) from e

        # Crawl URL using typed request
        try:
            result = application_services().data_sources.website.crawl_url(api_request)
        except Exception as e:
            raise WebsiteCrawlError(str(e)) from e
        return dump_response(WebsiteCrawlResponse, result, exclude_unset=True), 200


@console_ns.route("/website/crawl/status/<string:job_id>")
class WebsiteCrawlStatusApi(Resource):
    @error_responses(WebsiteCrawlError)
    @console_ns.doc("get_crawl_status")
    @console_ns.doc(description="Get website crawl status")
    @console_ns.doc(params={"job_id": "Crawl job ID", "provider": "Crawl provider (firecrawl/watercrawl/jinareader)"})
    @console_ns.doc(params=query_params_from_model(WebsiteCrawlStatusQuery))
    @console_ns.response(
        200, "Crawl status retrieved successfully", console_ns.models[WebsiteCrawlProgressResponse.__name__]
    )
    @console_ns.response(400, "Invalid provider")
    @setup_required
    @login_required
    @account_initialization_required
    @model_validate(WebsiteCrawlStatusQuery)
    def get(self, req_data: WebsiteCrawlStatusQuery, job_id: str) -> tuple[dict[str, object], int]:
        # Create typed request and validate
        try:
            api_request = WebsiteCrawlStatusApiRequest.from_args(req_data.model_dump(), job_id)
        except ValueError as e:
            raise WebsiteCrawlError(str(e)) from e

        # Get crawl status using typed request
        try:
            result = application_services().data_sources.website.get_crawl_status_typed(api_request)
        except Exception as e:
            raise WebsiteCrawlError(str(e)) from e
        return dump_response(WebsiteCrawlProgressResponse, result), 200
