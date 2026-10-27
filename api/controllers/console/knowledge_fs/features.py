"""Console availability of the KnowledgeFS product surfaces."""

from http import HTTPStatus

from flask_restx import Resource

from controllers.common.schema import register_response_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from fields.base import ResponseModel
from libs.helper import dump_response
from libs.login import login_required
from services.knowledge_fs.feature_service import get_knowledge_fs_features


class KnowledgeFSFeaturesResponse(ResponseModel):
    enabled: bool
    upload_enabled: bool
    agent_enabled: bool


register_response_schema_models(console_ns, KnowledgeFSFeaturesResponse)


@console_ns.route("/knowledge-fs/features")
class KnowledgeFSFeaturesApi(Resource):
    @console_ns.doc(description="Get which Agent Knowledge Base surfaces this deployment offers")
    @console_ns.response(
        HTTPStatus.OK,
        "Agent Knowledge Base availability",
        console_ns.models[KnowledgeFSFeaturesResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    def get(self):
        return dump_response(KnowledgeFSFeaturesResponse, get_knowledge_fs_features())
