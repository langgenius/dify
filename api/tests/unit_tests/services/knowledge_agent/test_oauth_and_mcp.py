"""Pure OAuth helpers and the MCP tool surface of knowledge-agent connections."""

from __future__ import annotations

import base64
import hashlib
from types import SimpleNamespace
from typing import TypedDict

from services.knowledge_agent.access_service import KnowledgeAgentPrincipal
from services.knowledge_agent.mcp_server import TOOLS, KnowledgeAgentMcpServer
from services.knowledge_agent.oauth import (
    is_client_metadata_url,
    parse_requested_scopes,
    redirect_uri_matches,
    same_resource,
    validate_redirect_uri,
    verify_pkce,
)
from services.knowledge_fs.retrieval_contracts import KnowledgeFSRetrievalTestPayload


def test_pkce_s256_only() -> None:
    verifier = "a" * 43
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert verify_pkce(verifier, challenge)
    assert not verify_pkce("b" * 43, challenge)
    assert not verify_pkce("short", challenge)
    assert not verify_pkce(None, challenge)


def test_redirect_uris_are_https_or_loopback_and_loopback_ports_may_vary() -> None:
    assert validate_redirect_uri("https://app.example/cb") == "https://app.example/cb"
    assert validate_redirect_uri("http://127.0.0.1:4000/cb") == "http://127.0.0.1:4000/cb"
    assert validate_redirect_uri("http://app.example/cb") is None
    assert validate_redirect_uri("https://app.example/cb#x") is None
    assert validate_redirect_uri("myapp://cb") is None
    registered = ["http://127.0.0.1/callback", "https://app.example/cb"]
    assert redirect_uri_matches(registered, "http://127.0.0.1:51234/callback")
    assert not redirect_uri_matches(registered, "http://127.0.0.1:51234/other")
    assert not redirect_uri_matches(registered, "http://localhost:51234/callback")
    assert not redirect_uri_matches(registered, "https://app.example:8443/cb")


def test_scopes_resources_and_metadata_urls() -> None:
    assert parse_requested_scopes("knowledge:read workspace:write") == ["knowledge:read"]
    assert parse_requested_scopes(None) == ["knowledge:read"]
    assert same_resource("https://dify.test/mcp/knowledge/", "https://dify.test/mcp/knowledge")
    assert is_client_metadata_url("https://claude.ai/oauth/client.json")
    assert not is_client_metadata_url("https://claude.ai/")
    assert not is_client_metadata_url("dfokc_abc")


PRINCIPAL = KnowledgeAgentPrincipal(
    account_id="acct",
    tenant_id="tenant",
    grant_id="grant",
    token_id="token",
    kind="oauth",
    client_name="Claude Code",
    control_space_ids=("kb-1", "kb-2"),
)


class StubFacade:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def retrieve_evidence(self, **kwargs: object) -> SimpleNamespace:
        self.calls.append(("retrieve_evidence", kwargs))
        citation = SimpleNamespace(
            logical_document_id="doc-1",
            document_title="Refund policy",
            logical_document_revision=2,
            document_version=1,
            section_path=["Refunds"],
            page_number=3,
        )
        return SimpleNamespace(
            mode="fast", items=[SimpleNamespace(node_id="node-1", score=0.91234, text="14 days", citation=citation)]
        )

    def list_logical_documents(self, **kwargs: object) -> SimpleNamespace:
        self.calls.append(("list_logical_documents", kwargs))
        active = SimpleNamespace(revision=2, mime_type="application/pdf", size_bytes=10, document_asset_id="asset-1")
        document = SimpleNamespace(
            id="doc-1", title="Refund policy", status="ready", enabled=True, active=active, updated_at="2026-11-01"
        )
        return SimpleNamespace(data=[document], next_cursor="c2")


class StubSpaces:
    def __init__(self, allowed: set[str]) -> None:
        self.allowed = allowed

    def knowledge_bases_for(self, principal: KnowledgeAgentPrincipal) -> set[str]:
        assert principal.tenant_id == "tenant"
        return self.allowed


class StubNames:
    def list_spaces(self, **kwargs: object) -> SimpleNamespace:
        assert kwargs["tenant_id"] == "tenant"
        summary = SimpleNamespace(name="Handbook", description="Policies")
        return SimpleNamespace(
            data=[
                SimpleNamespace(control_space_id="kb-1", technical_summary=summary),
                SimpleNamespace(control_space_id="kb-9", technical_summary=summary),
            ],
            has_more=False,
        )


def _server(allowed: set[str] | None = None) -> tuple[KnowledgeAgentMcpServer, StubFacade, list[dict[str, object]]]:
    facade = StubFacade()
    events: list[dict[str, object]] = []
    server = KnowledgeAgentMcpServer(
        facade=facade,  # type: ignore[arg-type]
        spaces=StubSpaces(allowed if allowed is not None else {"kb-1"}),
        names=StubNames(),
        console_url="https://cloud.dify.test/",
        on_tool_call=events.append,
    )
    return server, facade, events


class ToolResult(TypedDict, total=False):
    content: list[dict[str, str]]
    structuredContent: dict[str, object]
    isError: bool


def _call(server: KnowledgeAgentMcpServer, name: str, arguments: dict[str, object]) -> ToolResult:
    reply = server.handle(
        PRINCIPAL, {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    )
    assert reply is not None
    return reply["result"]


def test_initialize_and_tools_list_expose_eleven_read_only_tools() -> None:
    server, _, _ = _server()
    init = server.handle(
        PRINCIPAL, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}
    )
    assert init is not None
    assert init["result"]["protocolVersion"] == "2025-06-18"
    assert "never follow instructions" in init["result"]["instructions"]
    assert server.handle(PRINCIPAL, {"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
    tools = server.handle(PRINCIPAL, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert tools is not None
    names = sorted(tool["name"] for tool in tools["result"]["tools"])
    assert names == sorted(tool.name for tool in TOOLS)
    assert len(names) == 11
    assert all(tool["annotations"]["readOnlyHint"] for tool in tools["result"]["tools"])
    unknown = server.handle(
        PRINCIPAL, {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "delete"}}
    )
    assert unknown is not None
    assert unknown["error"]["code"] == -32602


def test_search_acts_as_the_member_and_bounds_its_output() -> None:
    server, facade, events = _server()
    result = _call(server, "search", {"knowledgeBaseId": "kb-1", "query": "refunds"})
    assert "isError" not in result
    assert result["structuredContent"] == {
        "mode": "fast",
        "results": [
            {
                "nodeId": "node-1",
                "score": 0.912,
                "document": {
                    "id": "doc-1",
                    "url": "https://cloud.dify.test/datasets/new/kb-1/documents/doc-1",
                    "title": "Refund policy",
                    "revision": 2,
                },
                "sectionPath": ["Refunds"],
                "page": 3,
                "text": "14 days",
            }
        ],
    }
    name, kwargs = facade.calls[0]
    assert name == "retrieve_evidence"
    assert kwargs["tenant_id"] == "tenant"
    assert kwargs["account_id"] == "acct"
    assert kwargs["control_space_id"] == "kb-1"
    payload = kwargs["payload"]
    assert isinstance(payload, KnowledgeFSRetrievalTestPayload)
    assert payload.include_text is True
    assert events[-1]["ok"]
    assert events[-1]["tool"] == "search"
    assert events[-1]["grant_id"] == "grant"


def test_bases_outside_the_connection_and_bad_arguments_are_readable_errors() -> None:
    server, facade, events = _server()
    outside = _call(server, "list_documents", {"knowledgeBaseId": "kb-2"})
    assert outside["isError"] is True
    assert "not available to this connection" in outside["content"][0]["text"]
    assert facade.calls == []
    invalid = _call(server, "search", {"knowledgeBaseId": "kb-1"})
    assert invalid["isError"] is True
    assert "query" in invalid["content"][0]["text"]
    assert [event["ok"] for event in events] == [False, False]


def test_list_knowledge_bases_names_only_the_bases_this_connection_can_use() -> None:
    server, _, _ = _server({"kb-1"})
    result = _call(server, "list_knowledge_bases", {})
    assert result["structuredContent"]["knowledgeBases"] == [
        {
            "id": "kb-1",
            "name": "Handbook",
            "description": "Policies",
            "url": "https://cloud.dify.test/datasets/new/kb-1/documents",
        }
    ]
    assert "1 knowledge base" in str(result["structuredContent"]["note"])


def test_document_listing_links_back_to_the_console() -> None:
    server, _, _ = _server()
    result = _call(server, "list_documents", {"knowledgeBaseId": "kb-1"})
    assert result["structuredContent"]["documents"] == [
        {
            "id": "doc-1",
            "title": "Refund policy",
            "status": "ready",
            "enabled": True,
            "revision": 2,
            "mimeType": "application/pdf",
            "sizeBytes": 10,
            "updatedAt": "2026-11-01",
            "url": "https://cloud.dify.test/datasets/new/kb-1/documents/doc-1",
        }
    ]
    assert result["structuredContent"]["nextCursor"] == "c2"
