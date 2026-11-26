"""Personal agents (Claude Code, Codex, any MCP client) reading Agent Knowledge Bases over MCP.

Public URLs and the ``Host`` header
-----------------------------------
The issuer, the MCP resource and the token endpoints live on ``SERVICE_API_URL``; the consent page
lives on ``CONSOLE_WEB_URL``. A deployment that sets neither still works: the URLs are then built
from the request's own host, which is whatever the caller put in the ``Host`` header. That value
is good enough to answer the caller, but it is never trusted for a security decision:

- the Origin allow-list of the MCP endpoint (the DNS-rebinding defence) holds configured origins
  only. With no public URL configured it admits only loopback origins, which a rebinding page,
  whose origin is its own host name, cannot present. The request's host is never added to it;
- a discovery document that contains a Host-derived URL is answered ``Cache-Control: no-store``,
  so a shared cache cannot hand one caller's ``Host`` to the next. Only a document built
  entirely from configured URLs is publicly cacheable.

Production deployments should set both variables.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from configs import dify_config
from core.db.session_factory import session_factory
from core.helper import ssrf_proxy
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from services.knowledge_agent.access_service import KnowledgeAgentAccessService
from services.knowledge_agent.clients import CLIENT_METADATA_MAX_BYTES
from services.knowledge_agent.contracts import (
    KnowledgeAgentAccessError,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentPrincipal,
    KnowledgeAgentUrls,
)
from services.knowledge_agent.oauth import KnowledgeAgentOAuthError, is_loopback_url
from services.knowledge_agent.spaces import SQLKnowledgeAgentSpacePort


def _fetch_client_metadata(url: str) -> tuple[int, bytes]:
    """Client metadata documents come from arbitrary HTTPS URLs: go through the SSRF proxy.

    The body is streamed and reading stops at the size cap, so an oversized (or endless) document
    is refused without being loaded: ``ResponseLimitError`` for the registry to report.
    """
    response = ssrf_proxy.make_request(
        "GET",
        url,
        max_retries=0,
        stream_response=True,
        timeout=5.0,
        follow_redirects=False,
        # The cap is on decoded bytes, which only an identity response lets the reader enforce.
        headers={"Accept": "application/json", "Accept-Encoding": "identity"},
    )
    buffered = ssrf_proxy.buffer_response(response, max_response_bytes=CLIENT_METADATA_MAX_BYTES)
    return buffered.status_code, buffered.content


def knowledge_agent_access_service() -> KnowledgeAgentAccessService:
    """The service wired to this process: database sessions, Redis, the SSRF-safe metadata fetcher."""
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


def knowledge_agent_urls_configured() -> bool:
    """Whether every public URL comes from configuration, none from the request's ``Host`` header."""
    return bool(dify_config.SERVICE_API_URL and dify_config.CONSOLE_WEB_URL)


def knowledge_agent_origin_allowed(origin: str | None) -> bool:
    """Whether a request carrying this ``Origin`` may reach the MCP endpoint (DNS-rebinding defence).

    Browsers send Origin; CLI agents do not, and are admitted. A browser origin must be one of the
    configured public origins. The request's own host is never consulted: a rebinding page makes
    that host equal to its origin. A deployment with no public URL configured admits loopback
    origins only, which keeps a local setup usable from a local browser tool.
    """
    if not origin:
        return True
    configured = {_origin_of(value) for value in (dify_config.CONSOLE_WEB_URL, dify_config.SERVICE_API_URL) if value}
    if configured:
        return origin.rstrip("/") in configured
    return is_loopback_url(origin)


def _origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def knowledge_agent_urls(request_root: str) -> KnowledgeAgentUrls:
    """Public URLs: the MCP resource and token endpoints on the API host, consent in the web app.

    ``request_root`` (the request's own host) stands in for a URL that is not configured; see the
    module docstring for what such a URL may and may not be used for.
    """
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
    "knowledge_agent_origin_allowed",
    "knowledge_agent_urls",
    "knowledge_agent_urls_configured",
]
