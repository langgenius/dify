"""Personal agents (Claude Code, Codex, any MCP client) reading Agent Knowledge Bases over MCP."""

from __future__ import annotations

from configs import dify_config
from core.db.session_factory import session_factory
from core.helper import ssrf_proxy
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from services.knowledge_agent.access_service import (
    KnowledgeAgentAccessError,
    KnowledgeAgentAccessService,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
    KnowledgeAgentUrls,
)
from services.knowledge_agent.oauth import KnowledgeAgentOAuthError
from services.knowledge_agent.spaces import SQLKnowledgeAgentSpacePort


def _fetch_client_metadata(url: str) -> tuple[int, bytes]:
    """Client metadata documents come from arbitrary HTTPS URLs: go through the SSRF proxy."""
    response = ssrf_proxy.get(
        url,
        max_retries=0,
        timeout=5.0,
        follow_redirects=False,
        headers={"Accept": "application/json"},
    )
    return response.status_code, response.content[: 64 * 1024 + 1]


def knowledge_agent_access_service() -> KnowledgeAgentAccessService:
    session_maker = session_factory.get_session_maker()
    return KnowledgeAgentAccessService(
        session_maker=session_maker,
        # The request-scoped session (as the OpenAPI authenticator uses); request teardown closes it.
        bearer_session=lambda: db.session(),
        redis_client=redis_client,
        spaces=SQLKnowledgeAgentSpacePort(session_maker),
        fetch_client_metadata=_fetch_client_metadata,
        enabled=lambda: bool(dify_config.KNOWLEDGE_AGENT_ACCESS_ENABLED),
    )


def knowledge_agent_urls(request_root: str) -> KnowledgeAgentUrls:
    """Public URLs: the MCP resource and token endpoints on the API host, consent in the web app."""
    api_base = (dify_config.SERVICE_API_URL or request_root).rstrip("/")
    web_base = (dify_config.CONSOLE_WEB_URL or request_root).rstrip("/")
    return KnowledgeAgentUrls(
        issuer=api_base,
        resource=f"{api_base}/mcp/knowledge",
        authorize=f"{web_base}/account/knowledge-agent/authorize",
        token=f"{api_base}/mcp/knowledge/oauth/token",
        register=f"{api_base}/mcp/knowledge/oauth/register",
        revocation=f"{api_base}/mcp/knowledge/oauth/revoke",
    )


__all__ = [
    "KnowledgeAgentAccessError",
    "KnowledgeAgentAccessService",
    "KnowledgeAgentAuthFailure",
    "KnowledgeAgentOAuthError",
    "KnowledgeAgentPrincipal",
    "KnowledgeAgentUrls",
    "knowledge_agent_access_service",
    "knowledge_agent_urls",
]
