from flask_restful import Resource, reqparse

from controllers.console import api
from controllers.console.datasets.error import WebsiteCrawlError
from controllers.console.wraps import account_initialization_required, setup_required
from libs.login import login_required
from services.website_service import WebsiteService


class WebsiteCrawlApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument(
            "provider", type=str, choices=["firecrawl", "jinareader"], required=True, nullable=True, location="json"
        )
        parser.add_argument("url", type=str, required=True, nullable=True, location="json")
        parser.add_argument("options", type=dict, required=True, nullable=True, location="json")
        args = parser.parse_args()
        WebsiteService.document_create_args_validate(args)
        # crawl url
        try:
            result = WebsiteService.crawl_url(args)
        except Exception as e:
            raise WebsiteCrawlError(str(e))
        return result, 200


class WebsiteCrawlStatusApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def get(self, job_id: str):
        parser = reqparse.RequestParser()
        parser.add_argument("provider", type=str, choices=["firecrawl", "jinareader"], required=True, location="args")
        args = parser.parse_args()
        # get crawl status
        try:
            result = WebsiteService.get_crawl_status(job_id, args["provider"])
        except Exception as e:
            raise WebsiteCrawlError(str(e))
        return result, 200


api.add_resource(WebsiteCrawlApi, "/website/crawl")
api.add_resource(WebsiteCrawlStatusApi, "/website/crawl/status/<string:job_id>")
