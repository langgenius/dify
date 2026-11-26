"""Knowledge MCP for personal agents: `/mcp/knowledge` plus its OAuth endpoints.

Stateless Streamable HTTP (POST only, JSON responses). Bearers are `dfok_` knowledge-agent tokens;
the general openapi authenticator never resolves them, and this endpoint resolves nothing else.

Request bodies are capped at ``_MAX_BODY`` while they are read: a declared ``Content-Length`` over
the cap is refused outright and at most one byte more than the cap is ever taken from the stream.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qsl

from flask import Response, request
from flask_restx import Resource

from configs import dify_config
from controllers.mcp import mcp_ns
from core.db.session_factory import session_factory
from core.mcp import types as mcp_types
from core.mcp.server.streamable_http import negotiate_protocol_version
from libs.helper import extract_remote_ip
from services.knowledge_agent import (
    KnowledgeAgentAccessError,
    KnowledgeAgentAuthFailure,
    KnowledgeAgentOAuthError,
    knowledge_agent_access_service,
    knowledge_agent_origin_allowed,
    knowledge_agent_urls,
)
from services.knowledge_agent.mcp_server import KnowledgeAgentMcpServer
from services.knowledge_fs.feature_service import get_knowledge_fs_features
from services.knowledge_fs.runtime import get_knowledge_fs_runtime

_MAX_BODY = 1024 * 1024


def _json(body: Any, status: int = 200, headers: dict[str, str] | None = None) -> Response:
    response = Response(json.dumps(body, ensure_ascii=False), status=status, mimetype="application/json")
    response.headers["Cache-Control"] = "no-store"
    for name, value in (headers or {}).items():
        response.headers[name] = value
    return response


def _oauth_error(exc: KnowledgeAgentOAuthError) -> Response:
    """The RFC 6749 error body; rate-limit refusals also say when to retry (``Retry-After``)."""
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after is not None else None
    return _json({"error": exc.error, "error_description": exc.description}, exc.status, headers)


def _urls():
    return knowledge_agent_urls(request.host_url)


class _BodyTooLargeError(Exception):
    """The request body is larger than ``_MAX_BODY``."""


def _body() -> str:
    """The request body as text, never holding more than the cap (plus one byte) in memory."""
    declared = request.content_length
    if declared is not None and declared > _MAX_BODY:
        raise _BodyTooLargeError
    raw = request.stream.read(_MAX_BODY + 1)
    if len(raw) > _MAX_BODY:
        raise _BodyTooLargeError
    return raw.decode("utf-8", errors="replace")


def _too_large() -> Response:
    return _json({"error": "payload_too_large", "error_description": "The request body is too large"}, 413)


def _form() -> dict[str, Any]:
    """Token and revocation bodies are form-encoded; JSON is tolerated."""
    try:
        raw = _body()
    except _BodyTooLargeError as exc:
        raise KnowledgeAgentOAuthError("invalid_request", "The request body is too large", 413) from exc
    if (request.mimetype or "").endswith("json"):
        try:
            parsed = json.loads(raw or "{}")
        except ValueError as exc:
            raise KnowledgeAgentOAuthError("invalid_request", "Body must be a JSON object") from exc
        if not isinstance(parsed, dict):
            raise KnowledgeAgentOAuthError("invalid_request", "Body must be a JSON object")
        return parsed
    return dict(parse_qsl(raw, keep_blank_values=True))


@mcp_ns.route("/knowledge")
class KnowledgeAgentMcpApi(Resource):
    @mcp_ns.doc("knowledge_agent_mcp")
    @mcp_ns.doc(description="Model Context Protocol endpoint for personal agents reading Agent Knowledge Bases")
    def post(self):
        # response-contract:ignore MCP route returns a Flask Response carrying JSON-RPC
        if not knowledge_agent_origin_allowed(request.headers.get("Origin")):
            return _json({"error": "forbidden_origin", "error_description": "Origin not allowed"}, 403)
        service = knowledge_agent_access_service()
        urls = _urls()
        if not dify_config.KNOWLEDGE_AGENT_ACCESS_ENABLED:
            return _json({"error": "not_found", "error_description": "Agent connections are not enabled"}, 404)
        challenge = {
            "WWW-Authenticate": (
                f'Bearer resource_metadata="{urls.issuer}/.well-known/oauth-protected-resource/mcp/knowledge", '
                'scope="knowledge:read"'
            )
        }
        header = request.headers.get("Authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            return _json(
                {"error": "unauthorized", "error_description": "Sign in to use the knowledge base"}, 401, challenge
            )
        auth = service.authenticate(token.strip())
        if isinstance(auth, KnowledgeAgentAuthFailure):
            if auth.status == 401:
                challenge["WWW-Authenticate"] += ', error="invalid_token"'
                return _json(
                    {"error": auth.error, "error_description": "The access token is invalid or expired"}, 401, challenge
                )
            return _json(
                {"error": auth.error, "error_description": "Agent access is turned off for this workspace"}, auth.status
            )

        try:
            message = json.loads(_body() or "null")
        except _BodyTooLargeError:
            return _too_large()
        except ValueError:
            return _json(
                {"jsonrpc": "2.0", "id": None, "error": {"code": mcp_types.PARSE_ERROR, "message": "Parse error"}}, 400
            )
        if not isinstance(message, dict):
            return _json(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": mcp_types.INVALID_REQUEST, "message": "Invalid request"},
                },
                400,
            )
        is_initialize = message.get("method") == "initialize"
        header_version = request.headers.get("MCP-Protocol-Version")
        if negotiate_protocol_version(header_version, is_initialize) is None:
            return _json(
                {
                    "jsonrpc": "2.0",
                    "id": message.get("id"),
                    "error": {
                        "code": mcp_types.INVALID_REQUEST,
                        "message": f"Unsupported MCP-Protocol-Version: {header_version}",
                    },
                },
                400,
            )
        if not get_knowledge_fs_features().enabled:
            return _json({"error": "not_found", "error_description": "Agent Knowledge Base is not enabled"}, 404)
        runtime = get_knowledge_fs_runtime(session_factory.get_session_maker())
        server = KnowledgeAgentMcpServer(
            facade=runtime.facade,
            spaces=service,
            names=runtime.application,
            console_url=dify_config.CONSOLE_WEB_URL or request.host_url,
        )
        reply = server.handle(auth, message)
        if reply is None:
            return Response("", status=202)
        return _json(reply)

    def get(self):
        # response-contract:ignore stateless MCP: no standalone SSE stream
        return _json({"error": "method_not_allowed", "error_description": "Use POST"}, 405, {"Allow": "POST"})

    def delete(self):
        # response-contract:ignore stateless MCP: no sessions to end
        return _json({"error": "method_not_allowed", "error_description": "Use POST"}, 405, {"Allow": "POST"})


@mcp_ns.route("/knowledge/oauth/register")
class KnowledgeAgentRegisterApi(Resource):
    @mcp_ns.doc("knowledge_agent_register_client")
    def post(self):
        # response-contract:ignore RFC 7591 registration response
        service = knowledge_agent_access_service()
        try:
            service.require_enabled()
            try:
                body = json.loads(_body() or "null") if request.is_json else None
            except _BodyTooLargeError:
                return _too_large()
            except ValueError:
                body = None
            if not isinstance(body, dict):
                raise KnowledgeAgentOAuthError("invalid_client_metadata", "Body must be a JSON object")
            return _json(service.register_client(body, ip_address=extract_remote_ip(request)), 201)
        except KnowledgeAgentOAuthError as exc:
            return _oauth_error(exc)
        except KnowledgeAgentAccessError as exc:
            return _json({"error": exc.code, "error_description": exc.message}, 404 if exc.status == 404 else 400)


@mcp_ns.route("/knowledge/oauth/token")
class KnowledgeAgentTokenApi(Resource):
    @mcp_ns.doc("knowledge_agent_token")
    def post(self):
        # response-contract:ignore RFC 6749 token response
        try:
            tokens = knowledge_agent_access_service().exchange_token(_form(), _urls())
        except KnowledgeAgentOAuthError as exc:
            return _oauth_error(exc)
        return _json(tokens, 200, {"Pragma": "no-cache"})


@mcp_ns.route("/knowledge/oauth/revoke")
class KnowledgeAgentRevokeApi(Resource):
    @mcp_ns.doc("knowledge_agent_revoke")
    def post(self):
        # response-contract:ignore RFC 7009 revocation response
        try:
            knowledge_agent_access_service().revoke_token(_form())
        except KnowledgeAgentOAuthError as exc:
            return _oauth_error(exc)
        return Response("", status=200)
