"""Pure OAuth helpers and the MCP tool surface of knowledge-agent connections."""

from __future__ import annotations

import base64
import hashlib
from collections.abc import Iterable
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
from services.knowledge_fs.product_dto import KnowledgeFSLogicalDocumentListResponse
from services.knowledge_fs.retrieval_contracts import KnowledgeFSRetrievalTestPayload, KnowledgeFSRetrievalTestResponse
from tests.helpers.unit.knowledge_agent import FakeKnowledgeFacade, SpaceListing, SpaceRow, SpaceSummary, json_rows


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


EVIDENCE = KnowledgeFSRetrievalTestResponse.model_validate(
    {
        "items": [
            {
                "nodeId": "node-1",
                "projectionIds": [],
                "score": 0.91234,
                "sources": ["dense"],
                "text": "14 days",
                "citation": {
                    "artifactHash": "hash",
                    "documentAssetId": "asset-1",
                    "documentTitle": "Refund policy",
                    "documentVersion": 1,
                    "logicalDocumentId": "doc-1",
                    "logicalDocumentRevision": 2,
                    "sectionPath": ["Refunds"],
                    "pageNumber": 3,
                },
            }
        ],
        "metrics": {"totalMs": 12.5},
        "mode": "fast",
        "traceId": "trace-1",
    }
)
DOCUMENTS = KnowledgeFSLogicalDocumentListResponse.model_validate(
    {
        "data": [
            {
                "active": {
                    "contentHash": "hash",
                    "createdAt": "2026-11-01T08:00:00Z",
                    "documentAssetId": "asset-1",
                    "documentAssetVersion": 1,
                    "documentId": "doc-1",
                    "knowledgeSpaceId": "space-1",
                    "mimeType": "application/pdf",
                    "revision": 2,
                    "sizeBytes": 10,
                    "state": "active",
                },
                "createdAt": "2026-10-01T08:00:00Z",
                "id": "doc-1",
                "knowledgeSpaceId": "space-1",
                "rowVersion": 1,
                "status": "ready",
                "title": "Refund policy",
                "updatedAt": "2026-11-01T00:00:00Z",
                "userMetadata": {},
            }
        ],
        "nextCursor": "c2",
    }
)


def _facade() -> FakeKnowledgeFacade:
    """The facade answering the two operations these tests reach, with the real response models."""
    facade = FakeKnowledgeFacade()
    facade.answers["retrieve_evidence"] = EVIDENCE
    facade.answers["list_logical_documents"] = DOCUMENTS
    return facade


class StubSpaces:
    def __init__(self, allowed: set[str]) -> None:
        self.allowed = allowed
        self.asked: list[set[str] | None] = []

    def knowledge_bases_for(
        self, principal: KnowledgeAgentPrincipal, *, among: Iterable[str] | None = None
    ) -> set[str]:
        assert principal.tenant_id == "tenant"
        self.asked.append(None if among is None else set(among))
        return self.allowed if among is None else self.allowed & set(among)


class StubNames:
    """A workspace whose listing is far longer than any scan would cover; lookups by id always answer."""

    def __init__(self) -> None:
        self.lookups: list[dict[str, object]] = []

    def list_spaces(
        self, *, tenant_id: str, account_id: str, page: int, limit: int, control_space_ids: list[str] | None = None
    ) -> SpaceListing:
        assert (tenant_id, account_id) == ("tenant", "acct")
        self.lookups.append({"page": page, "limit": limit, "control_space_ids": control_space_ids})
        summary = SpaceSummary(name="Handbook", description="Policies")
        if control_space_ids is None:
            # The unfiltered listing: other bases only, page after page.
            return SpaceListing(data=[SpaceRow(control_space_id=f"kb-other-{page}", technical_summary=summary)])
        known = {"kb-1", "kb-9"}
        return SpaceListing(
            data=[
                SpaceRow(control_space_id=space_id, technical_summary=summary)
                for space_id in control_space_ids
                if space_id in known
            ]
        )


def _server(
    allowed: set[str] | None = None,
) -> tuple[KnowledgeAgentMcpServer, FakeKnowledgeFacade, list[dict[str, object]]]:
    return _wired(allowed)[:3]


def _wired(
    allowed: set[str] | None = None,
) -> tuple[KnowledgeAgentMcpServer, FakeKnowledgeFacade, list[dict[str, object]], StubSpaces, StubNames]:
    facade = _facade()
    events: list[dict[str, object]] = []
    spaces = StubSpaces(allowed if allowed is not None else {"kb-1"})
    names = StubNames()
    server = KnowledgeAgentMcpServer(
        facade=facade,
        spaces=spaces,
        names=names,
        console_url="https://cloud.dify.test/",
        on_tool_call=events.append,
    )
    return server, facade, events, spaces, names


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


def test_list_knowledge_bases_looks_its_bases_up_by_id_so_a_large_workspace_hides_none() -> None:
    """Regression: a scan of the first 1000 bases reported the rest as "no longer available"."""
    server, _, _, _, names = _wired({"kb-1", "kb-2"})
    result = _call(server, "list_knowledge_bases", {})["structuredContent"]
    assert names.lookups == [{"page": 1, "limit": 100, "control_space_ids": ["kb-1", "kb-2"]}]
    # kb-2 is granted and allowed but the listing no longer has it: that one is really gone.
    assert [base["id"] for base in json_rows(result["knowledgeBases"])] == ["kb-1"]
    assert "1 knowledge base" in str(result["note"])

    both, _, _, _, names = _wired({"kb-1"})
    listed = both.handle(
        KnowledgeAgentPrincipal(
            account_id="acct",
            tenant_id="tenant",
            grant_id="grant",
            token_id="token",
            kind="oauth",
            client_name="Claude Code",
            control_space_ids=("kb-1",),
        ),
        {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list_knowledge_bases"}},
    )
    assert listed is not None
    content = listed["result"]["structuredContent"]
    assert [base["id"] for base in content["knowledgeBases"]] == ["kb-1"]
    assert "note" not in content
    assert all(lookup["control_space_ids"] is not None for lookup in names.lookups)


def test_a_tool_that_reads_one_base_asks_about_that_base_only_and_the_protocol_asks_nothing() -> None:
    server, _, _, spaces, names = _wired({"kb-1", "kb-2"})
    for method in ("initialize", "ping", "tools/list"):
        assert server.handle(PRINCIPAL, {"jsonrpc": "2.0", "id": 1, "method": method}) is not None
    assert spaces.asked == []
    _call(server, "list_documents", {"knowledgeBaseId": "kb-1"})
    assert spaces.asked == [{"kb-1"}]
    assert names.lookups == []


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
            "updatedAt": "2026-11-01 00:00:00+00:00",
            "url": "https://cloud.dify.test/datasets/new/kb-1/documents/doc-1",
        }
    ]
    assert result["structuredContent"]["nextCursor"] == "c2"
