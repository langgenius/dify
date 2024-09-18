from flask import request
from flask_login import current_user
from flask_restful import Resource, marshal, reqparse
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import api
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.setup import setup_required
from controllers.console.wraps import account_initialization_required
from fields.dataset_fields import dataset_detail_fields
from libs.login import login_required
from services.external_knowledge_service import ExternalDatasetService

class TestExternalApi(Resource):
    @setup_required
    @login_required
    @account_initialization_required
    def post(self):
        parser = reqparse.RequestParser()
        parser.add_argument(
            "top_k",
            nullable=False,
            required=True,
            type=int,
        )
        parser.add_argument(
            "score_threshold",
            nullable=False,
            required=True,
            type=float,
        )
        args = parser.parse_args()
        result = ExternalDatasetService.test_external_knowledge_retrival(
            args["top_k"], args["score_threshold"]
        )
        response = {
            "data": [item.to_dict() for item in api_templates],
            "has_more": len(api_templates) == limit,
            "limit": limit,
            "total": total,
            "page": page,
        }
        return response, 200



api.add_resource(TestExternalApi, "/dify/external-knowledge/retrival-documents")
