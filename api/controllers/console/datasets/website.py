from typing import Literal

from flask import request
from flask_restx import Resource
from pydantic import BaseModel

from controllers.common.schema import register_schema_models
from controllers.console import console_ns
from controllers.console.datasets.error import WebsiteCrawlError
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.website_service import WebsiteCrawlApiRequest, WebsiteCrawlStatusApiRequest, WebsiteService


class WebsiteCrawlPayload(BaseModel):
    provider: Literal["firecrawl", "watercrawl", "jinareader"]
    url: str
    options: dict[str, object]


class WebsiteCrawlStatusQuery(BaseModel):
    provider: Literal["firecrawl", "watercrawl", "jinareader"]


register_schema_models(console_ns, WebsiteCrawlPayload, WebsiteCrawlStatusQuery)


@console_ns.route("/website/crawl")
class WebsiteCrawlApi(Resource):
    @console_ns.doc("crawl_website")
    @console_ns.doc(description="Crawl website content")
    @console_ns.expect(console_ns.models[WebsiteCrawlPayload.__name__])
    @console_ns.response(200, "Website crawl initiated successfully")
    @console_ns.response(400, "Invalid crawl parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        payload = WebsiteCrawlPayload.model_validate(console_ns.payload or {})

        # Create typed request and validate
        try:
            api_request = WebsiteCrawlApiRequest.from_args(payload.model_dump())
        except ValueError as e:
            raise WebsiteCrawlError(str(e))

        # Crawl URL using typed request
        try:
            result = WebsiteService.crawl_url(api_request)
        except Exception as e:
            raise WebsiteCrawlError(str(e))
        return result, 200


@console_ns.route("/website/crawl/status/<string:job_id>")
class WebsiteCrawlStatusApi(Resource):
    @console_ns.doc("get_crawl_status")
    @console_ns.doc(description="Get website crawl status")
    @console_ns.doc(params={"job_id": "Crawl job ID", "provider": "Crawl provider (firecrawl/watercrawl/jinareader)"})
    @console_ns.expect(console_ns.models[WebsiteCrawlStatusQuery.__name__])
    @console_ns.response(200, "Crawl status retrieved successfully")
    @console_ns.response(404, "Crawl job not found")
    @console_ns.response(400, "Invalid provider")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, job_id: str):
        args = WebsiteCrawlStatusQuery.model_validate(request.args.to_dict())

        # Create typed request and validate
        try:
            api_request = WebsiteCrawlStatusApiRequest.from_args(args.model_dump(), job_id)
        except ValueError as e:
            raise WebsiteCrawlError(str(e))

        # Get crawl status using typed request
        try:
            result = WebsiteService.get_crawl_status_typed(api_request)
        except Exception as e:
            raise WebsiteCrawlError(str(e))
        return result, 200
