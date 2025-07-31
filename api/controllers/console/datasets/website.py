from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.datasets.error import WebsiteCrawlError
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.website_service import WebsiteCrawlApiRequest, WebsiteCrawlStatusApiRequest, WebsiteService


class WebsiteCrawlApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument(
            "provider",
            type=str,
            choices=["firecrawl", "watercrawl", "jinareader"],
            required=True,
            nullable=True,
            location="json",
        )
        parser.add_argument("url", type=str, required=True, nullable=True, location="json")
        parser.add_argument("options", type=dict, required=True, nullable=True, location="json")
        args = parser.parse_args()

        # Create typed request and validate
        try:
            api_request = WebsiteCrawlApiRequest.from_args(args)
        except ValueError as e:
            raise WebsiteCrawlError(str(e))

        # Crawl URL using typed request
        try:
            result = WebsiteService.crawl_url(api_request)
        except Exception as e:
            raise WebsiteCrawlError(str(e))
        return result, 200


class WebsiteCrawlStatusApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, job_id: str):
        parser = reqparse.RequestParser()
        parser.add_argument(
            "provider", type=str, choices=["firecrawl", "watercrawl", "jinareader"], required=True, location="args"
        )
        args = parser.parse_args()

        # Create typed request and validate
        try:
            api_request = WebsiteCrawlStatusApiRequest.from_args(args, job_id)
        except ValueError as e:
            raise WebsiteCrawlError(str(e))

        # Get crawl status using typed request
        try:
            result = WebsiteService.get_crawl_status_typed(api_request)
        except Exception as e:
            raise WebsiteCrawlError(str(e))
        return result, 200


api.add_resource(WebsiteCrawlApi, "/website/crawl")
api.add_resource(WebsiteCrawlStatusApi, "/website/crawl/status/<string:job_id>")
