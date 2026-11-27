"""Console side of knowledge-agent connections: consent page, connections, personal tokens."""

from collections.abc import Callable
from functools import wraps
from http import HTTPStatus

from flask import request
from flask_restx import Resource
from werkzeug.exceptions import NotFound

from controllers.common.schema import query_params_from_model, register_response_schema_models, register_schema_models
from controllers.console import console_ns
from controllers.console.wraps import account_initialization_required, setup_required
from libs.exception import RelayedHTTPError
from libs.external_api import error_responses
from libs.helper import dump_response
from libs.login import current_account_with_tenant, login_required
from services.knowledge_agent import KnowledgeAgentAccessError, knowledge_agent_access_service, knowledge_agent_urls
from services.knowledge_agent.dto import (
    KnowledgeAgentAuthorizationDecisionResponse,
    KnowledgeAgentAuthorizationPayload,
    KnowledgeAgentAuthorizationQuery,
    KnowledgeAgentAuthorizationResponse,
    KnowledgeAgentGrantResponse,
    KnowledgeAgentGrantUpdatePayload,
    KnowledgeAgentMineResponse,
    KnowledgeAgentTokenCreatedResponse,
    KnowledgeAgentTokenPayload,
    KnowledgeAgentWorkspacePayload,
    KnowledgeAgentWorkspaceResponse,
)
from services.knowledge_fs.feature_service import get_knowledge_fs_features

register_schema_models(
    console_ns,
    KnowledgeAgentAuthorizationQuery,
    KnowledgeAgentAuthorizationPayload,
    KnowledgeAgentTokenPayload,
    KnowledgeAgentGrantUpdatePayload,
    KnowledgeAgentWorkspacePayload,
)
register_response_schema_models(
    console_ns,
    KnowledgeAgentAuthorizationResponse,
    KnowledgeAgentAuthorizationDecisionResponse,
    KnowledgeAgentMineResponse,
    KnowledgeAgentWorkspaceResponse,
    KnowledgeAgentTokenCreatedResponse,
    KnowledgeAgentGrantResponse,
)


def _agent_errors[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    """Agent connections live inside Agent Knowledge Base; their failures keep their codes."""

    @wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        if not get_knowledge_fs_features().enabled:
            raise NotFound()
        try:
            return view(*args, **kwargs)
        except KnowledgeAgentAccessError as exc:
            raise RelayedHTTPError(
                status=exc.status, error_code=exc.code, message=exc.message, details=exc.details or None
            ) from exc

    return decorated


def _context():
    account, tenant_id = current_account_with_tenant()
    role = account.current_role.value if account.current_role else None
    return account, tenant_id, role


def _urls():
    return knowledge_agent_urls(request.host_url)


@console_ns.route("/knowledge-fs/agent-access")
class KnowledgeAgentMineApi(Resource):
    @error_responses(RelayedHTTPError)
    @console_ns.response(
        HTTPStatus.OK, "Your agent connections", console_ns.models[KnowledgeAgentMineResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_agent_errors
    def get(self):
        """Your agent connections in the current workspace, the MCP URL and both switches."""
        account, tenant_id, _ = _context()
        result = knowledge_agent_access_service().list_mine(account=account, tenant_id=tenant_id, urls=_urls())
        return dump_response(KnowledgeAgentMineResponse, result)


@console_ns.route("/knowledge-fs/agent-access/tokens")
class KnowledgeAgentTokensApi(Resource):
    @error_responses(RelayedHTTPError)
    @console_ns.expect(console_ns.models[KnowledgeAgentTokenPayload.__name__])
    @console_ns.response(
        HTTPStatus.CREATED, "Personal token created", console_ns.models[KnowledgeAgentTokenCreatedResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_agent_errors
    def post(self):
        """Create a personal token for chosen knowledge bases; the token is shown once."""
        account, tenant_id, _ = _context()
        payload = KnowledgeAgentTokenPayload.model_validate(console_ns.payload or {})
        result = knowledge_agent_access_service().create_personal_token(
            account=account, tenant_id=tenant_id, body=payload.model_dump()
        )
        return dump_response(KnowledgeAgentTokenCreatedResponse, result), HTTPStatus.CREATED


@console_ns.route("/knowledge-fs/agent-access/grants/<string:grant_id>")
class KnowledgeAgentGrantApi(Resource):
    @error_responses(RelayedHTTPError)
    @console_ns.expect(console_ns.models[KnowledgeAgentGrantUpdatePayload.__name__])
    @console_ns.response(HTTPStatus.OK, "Connection updated", console_ns.models[KnowledgeAgentGrantResponse.__name__])
    @setup_required
    @login_required
    @account_initialization_required
    @_agent_errors
    def patch(self, grant_id: str):
        """Change which knowledge bases your connection may read."""
        account, tenant_id, _ = _context()
        payload = KnowledgeAgentGrantUpdatePayload.model_validate(console_ns.payload or {})
        result = knowledge_agent_access_service().update_grant(
            account=account, tenant_id=tenant_id, grant_id=grant_id, body=payload.model_dump()
        )
        return dump_response(KnowledgeAgentGrantResponse, result)

    @error_responses(RelayedHTTPError)
    @console_ns.response(HTTPStatus.NO_CONTENT, "Disconnected")
    @setup_required
    @login_required
    @account_initialization_required
    @_agent_errors
    def delete(self, grant_id: str):
        """Disconnect: yours, or any member's for workspace admins. Takes effect at once."""
        account, tenant_id, role = _context()
        knowledge_agent_access_service().revoke_grant(
            account=account, tenant_id=tenant_id, role=role, grant_id=grant_id
        )
        return "", HTTPStatus.NO_CONTENT


@console_ns.route("/knowledge-fs/agent-access/workspace")
class KnowledgeAgentWorkspaceApi(Resource):
    @error_responses(RelayedHTTPError)
    @console_ns.response(
        HTTPStatus.OK, "Workspace agent access", console_ns.models[KnowledgeAgentWorkspaceResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_agent_errors
    def get(self):
        """The workspace switch and every member's connections (workspace admins)."""
        _, tenant_id, role = _context()
        result = knowledge_agent_access_service().workspace_settings(tenant_id=tenant_id, role=role)
        return dump_response(KnowledgeAgentWorkspaceResponse, result)

    @error_responses(RelayedHTTPError)
    @console_ns.expect(console_ns.models[KnowledgeAgentWorkspacePayload.__name__])
    @console_ns.response(
        HTTPStatus.OK, "Workspace agent access updated", console_ns.models[KnowledgeAgentWorkspaceResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_agent_errors
    def patch(self):
        """Turn personal agents on or off for the whole workspace (workspace admins)."""
        account, tenant_id, role = _context()
        payload = KnowledgeAgentWorkspacePayload.model_validate(console_ns.payload or {})
        result = knowledge_agent_access_service().update_workspace_settings(
            account=account, tenant_id=tenant_id, role=role, body=payload.model_dump()
        )
        return dump_response(KnowledgeAgentWorkspaceResponse, result)


@console_ns.route("/knowledge-fs/agent-access/authorize")
class KnowledgeAgentAuthorizeApi(Resource):
    @error_responses(RelayedHTTPError)
    @console_ns.doc(params=query_params_from_model(KnowledgeAgentAuthorizationQuery))
    @console_ns.response(
        HTTPStatus.OK, "Authorization request", console_ns.models[KnowledgeAgentAuthorizationResponse.__name__]
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_agent_errors
    def get(self):
        """Validate an agent's authorization request for the consent page."""
        account, tenant_id, _ = _context()
        query = KnowledgeAgentAuthorizationQuery.model_validate(request.args.to_dict())
        result = knowledge_agent_access_service().describe_authorization(
            account=account, tenant_id=tenant_id, params=query.model_dump(exclude_none=True), urls=_urls()
        )
        return dump_response(KnowledgeAgentAuthorizationResponse, result)

    @error_responses(RelayedHTTPError)
    @console_ns.expect(console_ns.models[KnowledgeAgentAuthorizationPayload.__name__])
    @console_ns.response(
        HTTPStatus.OK,
        "Where the browser goes next",
        console_ns.models[KnowledgeAgentAuthorizationDecisionResponse.__name__],
    )
    @setup_required
    @login_required
    @account_initialization_required
    @_agent_errors
    def post(self):
        """Approve (with chosen knowledge bases) or deny; returns the agent's redirect URI."""
        account, tenant_id, _ = _context()
        payload = KnowledgeAgentAuthorizationPayload.model_validate(console_ns.payload or {})
        result = knowledge_agent_access_service().decide_authorization(
            account=account, tenant_id=tenant_id, body=payload.model_dump(exclude_none=True), urls=_urls()
        )
        return dump_response(KnowledgeAgentAuthorizationDecisionResponse, result)
