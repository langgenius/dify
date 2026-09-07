"""Private authorization bridge for run-scoped, read-only Agent knowledge CLI."""

from dify_agent.protocol.knowledge_fs import KnowledgeFsError, KnowledgeFsPreparedRequest, KnowledgeFsPrepareRequest
from flask import request
from flask_restx import Resource
from pydantic import ValidationError

from controllers.common.schema import register_schema_models
from controllers.console.wraps import setup_required
from controllers.inner_api import inner_api_ns
from controllers.inner_api.wraps import plugin_inner_api_only
from services.agent.knowledge_gateway import AgentKnowledgeGateway
from services.agent_config_service import AgentConfigServiceError
from services.knowledge_fs.app_admission_service import KnowledgeFSAppAdmissionError
from services.knowledge_fs.product_authorization import KnowledgeFSProductNotFoundError
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError
from services.knowledge_fs.query_images import KnowledgeFSQueryImageError
from services.knowledge_fs_capability import KnowledgeFSCapabilityConfigurationError, KnowledgeFSCapabilityPolicyError

register_schema_models(inner_api_ns, KnowledgeFsPrepareRequest, KnowledgeFsPreparedRequest)


@inner_api_ns.route("/agent/knowledge/prepare")
class AgentKnowledgePrepareApi(Resource):
    @setup_required
    @plugin_inner_api_only
    @inner_api_ns.doc("inner_agent_knowledge_prepare")
    @inner_api_ns.expect(inner_api_ns.models[KnowledgeFsPrepareRequest.__name__])
    @inner_api_ns.response(200, "Private prepared command", inner_api_ns.models[KnowledgeFsPreparedRequest.__name__])
    def post(self):
        try:
            payload = KnowledgeFsPrepareRequest.model_validate(request.get_json(silent=True) or {})
            return AgentKnowledgeGateway().prepare(payload).model_dump(mode="json", exclude_none=True)
        except ValidationError:
            return {
                "code": "KNOWLEDGE_INVALID_REQUEST",
                "message": "Invalid knowledge command or execution context.",
            }, 400
        except KnowledgeFsError as exc:
            return {"code": exc.code, "message": exc.message}, exc.status_code
        except (
            KnowledgeFSAppAdmissionError,
            KnowledgeFSProductNotFoundError,
            AgentConfigServiceError,
            KnowledgeFSCapabilityPolicyError,
            PermissionError,
        ):
            return {"code": "KNOWLEDGE_ACCESS_DENIED", "message": "Knowledge access is unavailable or revoked."}, 403
        except (KnowledgeFSOperationUnavailableError, KnowledgeFSCapabilityConfigurationError):
            return {"code": "KNOWLEDGE_UNAVAILABLE", "message": "KnowledgeFS capability is unavailable."}, 503
        except (KnowledgeFSQueryImageError, ValueError):
            return {
                "code": "KNOWLEDGE_INVALID_REQUEST",
                "message": "Query image or knowledge reference is unavailable.",
            }, 400
