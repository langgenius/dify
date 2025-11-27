from flask_restx import Resource, fields, reqparse

from controllers.console import console_ns
from controllers.console.datasets.error import WebsiteCrawlError
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.website_service import WebsiteCrawlApiRequest, WebsiteCrawlStatusApiRequest, WebsiteService


@console_ns.route("/website/crawl")
class WebsiteCrawlApi(Resource):
    @console_ns.doc("crawl_website")
    @console_ns.doc(description="Crawl website content")
    @console_ns.expect(
        console_ns.model(
            "WebsiteCrawlRequest",
            {
                "provider": fields.String(
                    required=True,
                    description="Crawl provider (firecrawl/watercrawl/jinareader)",
                    enum=["firecrawl", "watercrawl", "jinareader"],
                ),
                "url": fields.String(required=True, description="URL to crawl"),
                "options": fields.Raw(required=True, description="Crawl options"),
            },
        )
    )
    @console_ns.response(200, "Website crawl initiated successfully")
    @console_ns.response(400, "Invalid crawl parameters")
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = (
            reqparse.RequestParser()
            .add_argument(
                "provider",
                type=str,
                choices=["firecrawl", "watercrawl", "jinareader"],
                required=True,
                nullable=True,
                location="json",
            )
            .add_argument("url", type=str, required=True, nullable=True, location="json")
            .add_argument("options", type=dict, required=True, nullable=True, location="json")
        )
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


@console_ns.route("/website/crawl/status/<string:job_id>")
class WebsiteCrawlStatusApi(Resource):
    @console_ns.doc("get_crawl_status")
    @console_ns.doc(description="Get website crawl status")
    @console_ns.doc(params={"job_id": "Crawl job ID", "provider": "Crawl provider (firecrawl/watercrawl/jinareader)"})
    @console_ns.response(200, "Crawl status retrieved successfully")
    @console_ns.response(404, "Crawl job not found")
    @console_ns.response(400, "Invalid provider")
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, job_id: str):
        parser = reqparse.RequestParser().add_argument(
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
