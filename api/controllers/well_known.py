"""Root-level OAuth discovery for the knowledge MCP endpoint (RFC 9728 and RFC 8414).

MCP clients look these up at the API origin's root, so they cannot live under a blueprint prefix.
"""

from __future__ import annotations

import json

from flask import Blueprint, Response, request

from configs import dify_config
from services.knowledge_agent import KnowledgeAgentAccessService, knowledge_agent_urls

bp = Blueprint("well_known", __name__)


def _metadata(body: dict) -> Response:
    response = Response(json.dumps(body), status=200, mimetype="application/json")
    response.headers["Cache-Control"] = "public, max-age=3600"
    # Browser-based MCP inspectors read discovery documents cross-origin; they carry no secrets.
    response.headers["Access-Control-Allow-Origin"] = "*"
    return response


def _not_found() -> Response:
    return Response(json.dumps({"error": "not_found"}), status=404, mimetype="application/json")


@bp.get("/.well-known/oauth-protected-resource")
@bp.get("/.well-known/oauth-protected-resource/mcp/knowledge")
def oauth_protected_resource() -> Response:
    if not dify_config.KNOWLEDGE_AGENT_ACCESS_ENABLED:
        return _not_found()
    return _metadata(KnowledgeAgentAccessService.protected_resource_metadata(knowledge_agent_urls(request.host_url)))


@bp.get("/.well-known/oauth-authorization-server")
def oauth_authorization_server() -> Response:
    if not dify_config.KNOWLEDGE_AGENT_ACCESS_ENABLED:
        return _not_found()
    return _metadata(KnowledgeAgentAccessService.authorization_server_metadata(knowledge_agent_urls(request.host_url)))
