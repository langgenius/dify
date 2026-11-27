"""The MCP server of a knowledge-agent connection: the protocol, every tool, and how failures read."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from dataclasses import dataclass
from typing import TypedDict

import pytest
from pydantic import BaseModel, Field

from core.mcp import types as mcp_types
from services.knowledge_agent.contracts import KnowledgeAgentPrincipal
from services.knowledge_agent.mcp_server import (
    AUDIT_TOOL_CALL,
    INSTRUCTIONS,
    MAX_ITEM_TEXT,
    MAX_READ_TEXT,
    MAX_RESULT_TEXT,
    TOOLS,
    KnowledgeAgentMcpServer,
    _Args,
    input_schema_for,
)
from services.knowledge_fs.errors import (
    KnowledgeFSOperationUnavailableError,
    KnowledgeFSProductRequestRejectedError,
    KnowledgeFSProductResourceNotFoundError,
)
from services.knowledge_fs.product_authorization import KnowledgeFSProductNotFoundError
from services.knowledge_fs.product_dto import (
    KnowledgeFSCatQuery,
    KnowledgeFSCatResponse,
    KnowledgeFSDocumentChunkListResponse,
    KnowledgeFSDocumentOutlineResponse,
    KnowledgeFSGrepQuery,
    KnowledgeFSGrepResponse,
    KnowledgeFSListQuery,
    KnowledgeFSListResponse,
    KnowledgeFSLogicalDocumentListResponse,
    KnowledgeFSLogicalDocumentResponse,
)
from services.knowledge_fs.retrieval_contracts import KnowledgeFSRetrievalTestPayload, KnowledgeFSRetrievalTestResponse
from services.knowledge_fs.tidy_dto import (
    KnowledgeFSTidyFindingListResponse,
    KnowledgeFSTidyFindingQuery,
    KnowledgeFSTidySummaryResponse,
)
from tests.helpers.unit.knowledge_agent import FakeKnowledgeFacade, SpaceListing, SpaceRow, SpaceSummary, json_rows

KB = "kb-1"
CONSOLE = "https://cloud.dify.test"
SCOPE = {"tenant_id": "tenant", "account_id": "acct", "control_space_id": KB}
PRINCIPAL = KnowledgeAgentPrincipal(
    account_id="acct",
    tenant_id="tenant",
    grant_id="grant",
    token_id="token",
    kind="oauth",
    client_name="Claude Code",
    control_space_ids=(KB,),
)


class GrantedSpaces:
    """Every base the connection was given is usable, until ``usable`` is cleared."""

    def __init__(self) -> None:
        self.usable = True

    def knowledge_bases_for(
        self, principal: KnowledgeAgentPrincipal, *, among: Iterable[str] | None = None
    ) -> set[str]:
        granted = set(principal.control_space_ids) if self.usable else set()
        return granted if among is None else granted & set(among)


@dataclass(frozen=True)
class _Row:
    """A row of the prepared listing; a ``stray`` one is returned whether or not it was asked for."""

    space: SpaceRow
    stray: bool = False


class Names:
    """The workspace listing by id: answers with the prepared rows, or fails as prepared."""

    def __init__(self) -> None:
        self.rows: list[_Row] = []
        self.lookups: list[list[str] | None] = []
        self.failure: Exception | None = None

    def list_spaces(
        self, *, tenant_id: str, account_id: str, page: int, limit: int, control_space_ids: list[str] | None = None
    ) -> SpaceListing:
        assert (tenant_id, account_id, page, limit) == ("tenant", "acct", 1, 100)
        self.lookups.append(control_space_ids)
        if self.failure is not None:
            raise self.failure
        asked = set(control_space_ids or [])
        return SpaceListing(data=[row.space for row in self.rows if row.space.control_space_id in asked or row.stray])


def _space(space_id: str, name: str | None, description: str | None = None, *, stray: bool = False) -> _Row:
    summary = None if name is None else SpaceSummary(name=name, description=description)
    return _Row(SpaceRow(control_space_id=space_id, technical_summary=summary), stray=stray)


class ToolResult(TypedDict, total=False):
    content: list[dict[str, str]]
    structuredContent: dict[str, object]
    isError: bool


class Harness:
    """A server over the fake facade, with what it audited."""

    def __init__(self, *, audited: bool = True) -> None:
        self.facade = FakeKnowledgeFacade()
        self.names = Names()
        self.spaces = GrantedSpaces()
        self.events: list[dict[str, object]] = []
        self.server = KnowledgeAgentMcpServer(
            facade=self.facade,
            spaces=self.spaces,
            names=self.names,
            console_url=f"{CONSOLE}/",
            on_tool_call=self.events.append if audited else None,
        )

    def request(self, message: dict[str, object], principal: KnowledgeAgentPrincipal = PRINCIPAL) -> dict[str, object]:
        reply = self.server.handle(principal, {"jsonrpc": "2.0", **message})
        assert reply is not None
        assert reply["jsonrpc"] == "2.0"
        return reply

    def call(self, name: str, arguments: object, principal: KnowledgeAgentPrincipal = PRINCIPAL) -> ToolResult:
        reply = self.server.handle(
            principal,
            {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}},
        )
        assert reply is not None
        assert (reply["jsonrpc"], reply["id"]) == ("2.0", 1)
        return reply["result"]

    def read(self, name: str, arguments: dict[str, object]) -> dict[str, object]:
        """A successful call on the granted base: its structured content, which the text repeats."""
        result = self.call(name, {"knowledgeBaseId": KB, **arguments})
        assert "isError" not in result, result
        assert json.loads(result["content"][0]["text"]) == result["structuredContent"]
        assert self.events[-1]["ok"] is True
        assert self.events[-1]["error"] is None
        return result["structuredContent"]

    def refused(self, name: str, arguments: dict[str, object]) -> str:
        """A failed call on the granted base: the text the agent reads."""
        result = self.call(name, {"knowledgeBaseId": KB, **arguments})
        assert result["isError"] is True
        assert "structuredContent" not in result
        assert self.events[-1]["ok"] is False
        return result["content"][0]["text"]


@pytest.fixture
def harness() -> Harness:
    return Harness()


# -- Protocol ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("params", "negotiated"),
    [
        ({"protocolVersion": "2024-11-05"}, "2024-11-05"),
        ({"protocolVersion": "1999-01-01"}, mcp_types.SERVER_LATEST_PROTOCOL_VERSION),
        ({}, mcp_types.SERVER_LATEST_PROTOCOL_VERSION),
        (None, mcp_types.SERVER_LATEST_PROTOCOL_VERSION),
        (["2024-11-05"], mcp_types.SERVER_LATEST_PROTOCOL_VERSION),
    ],
)
def test_initialize_keeps_a_supported_version_and_otherwise_offers_the_latest(
    harness: Harness, params: object, negotiated: str
) -> None:
    reply = harness.request({"id": "init-1", "method": "initialize", "params": params})
    assert reply["id"] == "init-1"
    assert reply["result"] == {
        "protocolVersion": negotiated,
        "capabilities": {"tools": {"listChanged": False}},
        "serverInfo": {"name": "dify-knowledge", "title": "Dify Agent Knowledge Base", "version": "1.0.0"},
        "instructions": INSTRUCTIONS,
    }
    assert harness.events == []


def test_ping_answers_an_empty_result_and_unknown_methods_are_method_not_found(harness: Harness) -> None:
    assert harness.request({"id": 7, "method": "ping"}) == {"jsonrpc": "2.0", "id": 7, "result": {}}
    unknown = harness.request({"id": 8, "method": "resources/list"})
    assert unknown == {
        "jsonrpc": "2.0",
        "id": 8,
        "error": {"code": mcp_types.METHOD_NOT_FOUND, "message": "Method not found: resources/list"},
    }
    assert harness.facade.calls == []


@pytest.mark.parametrize("message", [{"id": 3}, {"id": 3, "method": 42}, {"id": 3, "method": None}, {"method": []}])
def test_a_message_without_a_method_name_is_an_invalid_request(harness: Harness, message: dict[str, object]) -> None:
    reply = harness.request(message)
    assert reply["error"] == {"code": mcp_types.INVALID_REQUEST, "message": "Invalid request"}
    assert reply["id"] == message.get("id")
    assert "result" not in reply


def test_notifications_are_not_answered_and_never_run_a_tool(harness: Harness) -> None:
    notifications: list[dict[str, object]] = [
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 1}},
        # No id, so nothing may be returned for it, and so nothing is run for it either.
        {"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "list_documents", "arguments": {}}},
        {"jsonrpc": "2.0", "method": "no/such/method"},
    ]
    for message in notifications:
        assert harness.server.handle(PRINCIPAL, message) is None
    assert harness.facade.calls == []
    assert harness.events == []


@pytest.mark.parametrize(
    ("params", "message"),
    [
        (None, "params.name is required"),
        ({}, "params.name is required"),
        (["list_documents"], "params.name is required"),
        ("list_documents", "params.name is required"),
        ({"name": 7}, "params.name is required"),
        ({"name": None, "arguments": {}}, "params.name is required"),
        ({"name": "delete_document", "arguments": {}}, "Unknown tool: delete_document"),
        ({"name": "_authorise", "arguments": {}}, "Unknown tool: _authorise"),
    ],
)
def test_a_tool_call_must_name_a_known_tool(harness: Harness, params: object, message: str) -> None:
    reply = harness.request({"id": 5, "method": "tools/call", "params": params})
    assert reply == {"jsonrpc": "2.0", "id": 5, "error": {"code": mcp_types.INVALID_PARAMS, "message": message}}
    assert harness.facade.calls == []
    assert harness.events == []


def test_tools_list_describes_every_tool_as_read_only(harness: Harness) -> None:
    reply = harness.server.handle(PRINCIPAL, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert reply is not None
    listed = json_rows(reply["result"]["tools"])
    assert [tool["name"] for tool in listed] == [tool.name for tool in TOOLS]
    for definition, tool in zip(listed, TOOLS, strict=True):
        assert set(definition) == {"name", "title", "description", "inputSchema", "annotations"}
        assert definition["title"] == tool.title
        assert definition["description"] == tool.description
        assert definition["inputSchema"] == input_schema_for(tool.args)
        assert definition["annotations"] == {
            "title": tool.title,
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        }


class _Window(BaseModel):
    start: int = Field(ge=0, description="First line.")
    end: int | None = Field(default=None, description="Last line.")


class _WindowArgs(_Args):
    window: _Window = Field(description="Lines to read.")
    windows: list[_Window] = Field(default_factory=list, description="More ranges.")
    target: int | str = Field(description="A line number or a heading.")
    tags: list[str] | None = Field(default=None, description="Only passages with these tags.")


def test_an_arguments_model_with_nested_models_and_unions_is_advertised_self_contained() -> None:
    """The schema generator inlines what pydantic references, so a client never has to resolve anything."""
    window = {
        "type": "object",
        "properties": {
            "start": {"type": "integer", "minimum": 0, "description": "First line."},
            "end": {"type": "integer", "description": "Last line."},
        },
        "required": ["start"],
    }
    assert input_schema_for(_WindowArgs) == {
        "type": "object",
        "properties": {
            "window": {**window, "description": "Lines to read."},
            "windows": {"type": "array", "items": window, "description": "More ranges."},
            # A real choice between types stays a choice; only `X | None` is flattened.
            "target": {
                "anyOf": [{"type": "integer"}, {"type": "string"}],
                "description": "A line number or a heading.",
            },
            "tags": {"type": "array", "items": {"type": "string"}, "description": "Only passages with these tags."},
        },
        "required": ["window", "target"],
        "additionalProperties": False,
    }
    # The pydantic schema it came from does use references and null variants.
    raw = json.dumps(_WindowArgs.model_json_schema(by_alias=True))
    assert "$ref" in raw
    assert '"null"' in raw


# -- list_knowledge_bases ----------------------------------------------------------------------------


def test_list_knowledge_bases_shapes_names_descriptions_and_links(harness: Harness) -> None:
    principal = _principal("kb-b", "kb-a", "kb-c")
    harness.names.rows = [
        _space("kb-a", "Handbook", "Policies"),
        _space("kb-b", "Finance", ""),
        _space("kb-c", None),
        # A row nobody asked for must never be listed, whatever the listing returns.
        _space("kb-stray", "Board", "Secret", stray=True),
    ]
    result = harness.call("list_knowledge_bases", {}, principal)
    assert result["structuredContent"] == {
        "knowledgeBases": [
            {
                "id": "kb-a",
                "name": "Handbook",
                "description": "Policies",
                "url": f"{CONSOLE}/datasets/new/kb-a/documents",
            },
            {"id": "kb-b", "name": "Finance", "url": f"{CONSOLE}/datasets/new/kb-b/documents"},
            {"id": "kb-c", "name": "", "url": f"{CONSOLE}/datasets/new/kb-c/documents"},
        ]
    }
    assert harness.names.lookups == [["kb-a", "kb-b", "kb-c"]]
    assert harness.events == [
        {
            "account_id": "acct",
            "tenant_id": "tenant",
            "grant_id": "grant",
            "client": "Claude Code",
            "tool": "list_knowledge_bases",
            "knowledge_base_id": None,
            "ok": True,
            "error": None,
            "duration_ms": harness.events[0]["duration_ms"],
        }
    ]
    assert isinstance(harness.events[0]["duration_ms"], int)


def _principal(*space_ids: str) -> KnowledgeAgentPrincipal:
    return KnowledgeAgentPrincipal(
        account_id="acct",
        tenant_id="tenant",
        grant_id="grant",
        token_id="token",
        kind="oauth",
        client_name="Claude Code",
        control_space_ids=space_ids,
    )


def test_list_knowledge_bases_asks_for_a_page_of_ids_at_a_time(harness: Harness) -> None:
    ids = [f"kb-{number:03d}" for number in range(130)]
    harness.names.rows = [_space(space_id, space_id.upper()) for space_id in ids]
    result = harness.call("list_knowledge_bases", {}, _principal(*reversed(ids)))["structuredContent"]
    assert harness.names.lookups == [ids[:100], ids[100:]]
    assert [base["id"] for base in json_rows(result["knowledgeBases"])] == ids
    assert "note" not in result


def test_a_connection_without_usable_bases_lists_none_and_says_how_many_are_gone(harness: Harness) -> None:
    harness.spaces.usable = False
    result = harness.call("list_knowledge_bases", {}, _principal("kb-1", "kb-2"))
    assert result["structuredContent"] == {
        "knowledgeBases": [],
        "note": "2 knowledge base(s) chosen for this connection are no longer available "
        "(deleted, unshared or blocked for agents).",
    }
    assert harness.names.lookups == []


def test_list_knowledge_bases_takes_no_arguments_and_reports_a_failed_listing(harness: Harness) -> None:
    extra = harness.call("list_knowledge_bases", {"knowledgeBaseId": KB})
    assert extra["isError"] is True
    assert extra["content"][0]["text"].startswith("Invalid arguments: knowledgeBaseId:")
    assert harness.events[-1]["error"] == "invalid_arguments"
    assert harness.names.lookups == []

    harness.names.failure = PermissionError("member removed")
    failed = harness.call("list_knowledge_bases", {})
    assert failed == {
        "content": [{"type": "text", "text": "Your account may not do this in that knowledge base."}],
        "isError": True,
    }
    assert harness.events[-1]["error"] == "PermissionError"
    assert harness.events[-1]["knowledge_base_id"] is None


# -- search ------------------------------------------------------------------------------------------


def _hit(node_id: str, text: str | None, **citation: object) -> dict[str, object]:
    return {
        "nodeId": node_id,
        "projectionIds": [],
        "score": 0.87654,
        "sources": ["dense"],
        "text": text,
        "citation": {
            "artifactHash": "hash",
            "documentAssetId": "asset-1",
            "documentTitle": "Refund policy",
            "documentVersion": 4,
            "logicalDocumentId": "doc-1",
            "logicalDocumentRevision": 2,
            "sectionPath": ["Refunds", "Deadlines"],
            "pageNumber": 3,
            **citation,
        },
    }


def _evidence(hits: list[dict[str, object]], mode: str = "fast") -> KnowledgeFSRetrievalTestResponse:
    return KnowledgeFSRetrievalTestResponse.model_validate(
        {"items": hits, "metrics": {"totalMs": 12.5}, "mode": mode, "traceId": "trace-1"}
    )


def test_search_sends_the_query_and_mode_and_cites_each_passage(harness: Harness) -> None:
    harness.facade.answers["retrieve_evidence"] = _evidence(
        [
            _hit("node-1", "Refunds within 14 days."),
            # Not tied to a document of the knowledge base: no id, no link, the asset's version, no page.
            _hit("node-2", None, logicalDocumentId=None, logicalDocumentRevision=None, pageNumber=None, sectionPath=[]),
        ],
        mode="deep",
    )
    result = harness.read("search", {"query": "  refund deadline ", "mode": "deep", "maxResults": 2})
    assert result == {
        "mode": "deep",
        "results": [
            {
                "nodeId": "node-1",
                "score": 0.877,
                "document": {
                    "id": "doc-1",
                    "url": f"{CONSOLE}/datasets/new/{KB}/documents/doc-1",
                    "title": "Refund policy",
                    "revision": 2,
                },
                "sectionPath": ["Refunds", "Deadlines"],
                "page": 3,
                "text": "Refunds within 14 days.",
            },
            {
                "nodeId": "node-2",
                "score": 0.877,
                "document": {"title": "Refund policy", "revision": 4},
                "sectionPath": [],
                "text": "",
            },
        ],
    }
    name, sent = harness.facade.calls[0]
    assert name == "retrieve_evidence"
    assert {key: sent[key] for key in SCOPE} == SCOPE
    assert sent["payload"] == KnowledgeFSRetrievalTestPayload(query="refund deadline", mode="deep", include_text=True)
    assert harness.events[-1]["knowledge_base_id"] == KB


def test_search_returns_ten_passages_by_default_and_says_when_more_matched(harness: Harness) -> None:
    harness.facade.answers["retrieve_evidence"] = _evidence([_hit(f"node-{number}", "short") for number in range(12)])
    result = harness.read("search", {"query": "refunds"})
    assert [hit["nodeId"] for hit in json_rows(result["results"])] == [f"node-{number}" for number in range(10)]
    assert result["truncated"] is True
    limited = harness.read("search", {"query": "refunds", "maxResults": 12})
    assert len(json_rows(limited["results"])) == 12
    assert "truncated" not in limited


def test_search_cuts_long_passages_and_stops_at_the_shared_text_budget(harness: Harness) -> None:
    long_text = "x" * (MAX_ITEM_TEXT + 500)
    harness.facade.answers["retrieve_evidence"] = _evidence([_hit(f"node-{number}", long_text) for number in range(10)])
    result = harness.read("search", {"query": "refunds"})
    texts = [hit["text"] for hit in json_rows(result["results"])]
    whole = MAX_RESULT_TEXT // MAX_ITEM_TEXT
    assert texts[:whole] == ["x" * MAX_ITEM_TEXT + "…"] * whole
    # The budget is spent: later passages are still cited, with their text left out.
    assert texts[whole:] == ["…"] * (10 - whole)
    assert sum(len(text.rstrip("…")) for text in texts) == MAX_RESULT_TEXT
    assert result["truncated"] is True


# -- grep --------------------------------------------------------------------------------------------


def _match(path: str, snippet: str, node_id: str | None = None) -> dict[str, object]:
    return {
        "endOffset": 9,
        "kind": "node",
        "metadata": {},
        "nodeId": node_id,
        "path": path,
        "snippet": snippet,
        "startOffset": 3,
    }


def _grep(matches: list[dict[str, object]], *, next_cursor: str | None = None, truncated: bool = False) -> object:
    return KnowledgeFSGrepResponse.model_validate(
        {"matches": matches, "nextCursor": next_cursor, "path": "/knowledge", "truncated": truncated}
    )


def test_grep_searches_the_documents_by_default_and_returns_openable_matches(harness: Harness) -> None:
    harness.facade.answers["grep_knowledge_fs"] = _grep(
        [_match("/knowledge/handbook.md", "error E-1001 means", "node-1"), _match("/knowledge/faq.md", "see E-1001")]
    )
    assert harness.read("grep", {"pattern": "E-1001"}) == {
        "matches": [
            {"nodeId": "node-1", "path": "/knowledge/handbook.md", "snippet": "error E-1001 means"},
            {"path": "/knowledge/faq.md", "snippet": "see E-1001"},
        ]
    }
    name, sent = harness.facade.calls[0]
    assert name == "grep_knowledge_fs"
    assert {key: sent[key] for key in SCOPE} == SCOPE
    assert sent["query"] == KnowledgeFSGrepQuery(path="/knowledge", limit=20, query="E-1001")


def test_grep_forwards_path_limit_and_cursor_and_reports_the_next_page(harness: Harness) -> None:
    harness.facade.answers["grep_knowledge_fs"] = _grep(
        [_match("/sources/crm/a", "E-1001")], next_cursor="page-3", truncated=True
    )
    result = harness.read("grep", {"pattern": "E-1001", "path": "/sources/crm", "limit": 5, "cursor": "page-2"})
    assert result["nextCursor"] == "page-3"
    assert result["truncated"] is True
    assert harness.facade.calls[0][1]["query"] == KnowledgeFSGrepQuery(
        path="/sources/crm", limit=5, cursor="page-2", query="E-1001"
    )


def test_grep_cuts_a_long_snippet_and_marks_the_result_truncated(harness: Harness) -> None:
    harness.facade.answers["grep_knowledge_fs"] = _grep([_match("/knowledge/log.txt", "E" * 1_200, "node-1")])
    result = harness.read("grep", {"pattern": "E"})
    assert json_rows(result["matches"])[0]["snippet"] == "E" * 1_000 + "…"
    assert result["truncated"] is True
    assert "nextCursor" not in result


# -- browse and read_path ----------------------------------------------------------------------------


def test_browse_lists_the_documents_folder_by_default(harness: Harness) -> None:
    harness.facade.answers["list_knowledge_fs"] = KnowledgeFSListResponse.model_validate(
        {
            "items": [
                {"kind": "directory", "metadata": {}, "name": "entities", "path": "/knowledge/entities"},
                {
                    "kind": "resource",
                    "metadata": {},
                    "name": "handbook.md",
                    "path": "/knowledge/handbook.md",
                    "resourceType": "document",
                },
            ],
            "path": "/knowledge",
            "truncated": False,
        }
    )
    assert harness.read("browse", {}) == {
        "path": "/knowledge",
        "entries": [
            {"kind": "directory", "name": "entities", "path": "/knowledge/entities"},
            {"kind": "resource", "name": "handbook.md", "path": "/knowledge/handbook.md", "resourceType": "document"},
        ],
    }
    name, sent = harness.facade.calls[0]
    assert name == "list_knowledge_fs"
    assert {key: sent[key] for key in SCOPE} == SCOPE
    assert sent["query"] == KnowledgeFSListQuery(path="/knowledge", limit=50)


def test_browse_pages_through_a_folder(harness: Harness) -> None:
    harness.facade.answers["list_knowledge_fs"] = KnowledgeFSListResponse.model_validate(
        {"items": [], "nextCursor": "page-2", "path": "/sources", "truncated": True}
    )
    assert harness.read("browse", {"path": "/sources", "limit": 100, "cursor": "page-1"}) == {
        "path": "/sources",
        "entries": [],
        "nextCursor": "page-2",
        "truncated": True,
    }
    assert harness.facade.calls[0][1]["query"] == KnowledgeFSListQuery(path="/sources", limit=100, cursor="page-1")
    over = harness.refused("browse", {"limit": 101})
    assert over.startswith("Invalid arguments: limit:")
    assert harness.facade.called() == ["list_knowledge_fs"]


def _file(text: str, *, next_cursor: str | None = None, truncated: bool = False) -> KnowledgeFSCatResponse:
    return KnowledgeFSCatResponse.model_validate(
        {
            "contentType": "text/markdown",
            "nextCursor": next_cursor,
            "path": "/knowledge/handbook.md",
            "text": text,
            "truncated": truncated,
        }
    )


def test_read_path_returns_the_file_text_with_its_type(harness: Harness) -> None:
    harness.facade.answers["cat_knowledge_fs"] = _file("# Handbook\nBe kind.")
    assert harness.read("read_path", {"path": "/knowledge/handbook.md"}) == {
        "path": "/knowledge/handbook.md",
        "contentType": "text/markdown",
        "text": "# Handbook\nBe kind.",
    }
    name, sent = harness.facade.calls[0]
    assert name == "cat_knowledge_fs"
    assert {key: sent[key] for key in SCOPE} == SCOPE
    assert sent["query"] == KnowledgeFSCatQuery(path="/knowledge/handbook.md")


@pytest.mark.parametrize(
    ("length", "upstream_truncated", "truncated"),
    [
        (MAX_READ_TEXT, False, False),
        (MAX_READ_TEXT + 1, False, True),
        (10, True, True),
    ],
)
def test_read_path_caps_the_text_and_passes_the_cursor_on(
    harness: Harness, length: int, upstream_truncated: bool, truncated: bool
) -> None:
    harness.facade.answers["cat_knowledge_fs"] = _file("a" * length, next_cursor="next", truncated=upstream_truncated)
    result = harness.read("read_path", {"path": "/knowledge/handbook.md", "cursor": "here"})
    assert result["text"] == "a" * min(length, MAX_READ_TEXT)
    assert result["nextCursor"] == "next"
    assert result.get("truncated", False) is truncated
    assert harness.facade.calls[0][1]["query"] == KnowledgeFSCatQuery(path="/knowledge/handbook.md", cursor="here")


# -- Documents ---------------------------------------------------------------------------------------


def _document(document_id: str = "doc-1", *, active: bool = True, **fields: object) -> dict[str, object]:
    revision = {
        "contentHash": "hash",
        "createdAt": "2026-11-01T08:00:00Z",
        "documentAssetId": "asset-7",
        "documentAssetVersion": 1,
        "documentId": document_id,
        "knowledgeSpaceId": "space-1",
        "mimeType": "application/pdf",
        "revision": 3,
        "sizeBytes": 2048,
        "state": "active",
    }
    return {
        "active": revision if active else None,
        "createdAt": "2026-10-01T08:00:00Z",
        "id": document_id,
        "knowledgeSpaceId": "space-1",
        "rowVersion": 1,
        "status": "ready" if active else "pending",
        "title": "Refund policy",
        "updatedAt": "2026-11-02T09:30:00Z",
        "userMetadata": {"team": "support"},
        **fields,
    }


def _logical(*, active: bool = True, **fields: object) -> KnowledgeFSLogicalDocumentResponse:
    return KnowledgeFSLogicalDocumentResponse.model_validate(_document("doc-1", active=active, **fields))


def test_list_documents_summarises_each_document_and_pages(harness: Harness) -> None:
    harness.facade.answers["list_logical_documents"] = KnowledgeFSLogicalDocumentListResponse.model_validate(
        {
            "data": [_document("doc-1"), _document("doc-2", active=False, enabled=False, title="Draft")],
            "nextCursor": "page-2",
        }
    )
    assert harness.read("list_documents", {"limit": 2, "cursor": "page-1"}) == {
        "documents": [
            {
                "id": "doc-1",
                "title": "Refund policy",
                "status": "ready",
                "enabled": True,
                "revision": 3,
                "mimeType": "application/pdf",
                "sizeBytes": 2048,
                "updatedAt": "2026-11-02 09:30:00+00:00",
                "url": f"{CONSOLE}/datasets/new/{KB}/documents/doc-1",
            },
            {
                "id": "doc-2",
                "title": "Draft",
                "status": "pending",
                "enabled": False,
                "updatedAt": "2026-11-02 09:30:00+00:00",
                "url": f"{CONSOLE}/datasets/new/{KB}/documents/doc-2",
            },
        ],
        "nextCursor": "page-2",
    }
    assert harness.facade.calls == [("list_logical_documents", {**SCOPE, "cursor": "page-1", "limit": 2})]


def test_get_document_adds_creation_time_and_user_metadata(harness: Harness) -> None:
    harness.facade.answers["get_logical_document"] = _logical()
    result = harness.read("get_document", {"documentId": "doc-1"})
    assert result["id"] == "doc-1"
    assert result["revision"] == 3
    assert result["createdAt"] == "2026-10-01 08:00:00+00:00"
    assert result["metadata"] == {"team": "support"}
    assert result["url"] == f"{CONSOLE}/datasets/new/{KB}/documents/doc-1"
    assert harness.facade.calls == [("get_logical_document", {**SCOPE, "document_id": "doc-1"})]

    harness.facade.answers["get_logical_document"] = _logical(userMetadata={})
    assert harness.read("get_document", {"documentId": "doc-1"})["metadata"] == {}


def _section(
    title: str, level: int = 1, children: list[dict[str, object]] | None = None, **fields: object
) -> dict[str, object]:
    return {
        "id": f"node-{title}",
        "level": level,
        "metadata": {},
        "title": title,
        "tocSource": "headings",
        "children": children or [],
        **fields,
    }


def _outline(nodes: list[dict[str, object]]) -> KnowledgeFSDocumentOutlineResponse:
    return KnowledgeFSDocumentOutlineResponse.model_validate(
        {
            "artifactHash": "hash",
            "createdAt": "2026-11-01T08:00:00Z",
            "documentAssetId": "asset-7",
            "id": "outline-1",
            "knowledgeSpaceId": "space-1",
            "metadata": {},
            "nodes": nodes,
            "outlineVersion": "v1",
            "parseArtifactId": "parse-1",
            "version": 1,
        }
    )


def test_the_outline_is_read_from_the_active_revision_and_flattened_in_reading_order(harness: Harness) -> None:
    harness.facade.answers["get_logical_document"] = _logical()
    harness.facade.answers["get_document_outline"] = _outline(
        [
            _section(
                "Refunds",
                startPage=1,
                endPage=4,
                summary="When money is returned.",
                children=[_section("Deadlines", 2, startPage=2), _section("Exceptions", 2, endPage=4)],
            ),
            _section("Contact"),
        ]
    )
    assert harness.read("get_document_outline", {"documentId": "doc-1"}) == {
        "documentId": "doc-1",
        "sections": [
            {"level": 1, "title": "Refunds", "startPage": 1, "endPage": 4, "summary": "When money is returned."},
            {"level": 2, "title": "Deadlines", "startPage": 2},
            {"level": 2, "title": "Exceptions", "endPage": 4},
            {"level": 1, "title": "Contact"},
        ],
    }
    # The outline belongs to the stored asset of the document's current revision, not to the document id.
    assert harness.facade.calls == [
        ("get_logical_document", {**SCOPE, "document_id": "doc-1"}),
        ("get_document_outline", {**SCOPE, "document_id": "asset-7"}),
    ]


def test_a_long_outline_stops_at_400_sections_and_long_summaries_are_cut(harness: Harness) -> None:
    harness.facade.answers["get_logical_document"] = _logical()
    harness.facade.answers["get_document_outline"] = _outline(
        [
            _section(f"Part {part}", children=[_section(f"{part}.{number}", 2) for number in range(49)])
            for part in range(9)
        ]
    )
    result = harness.read("get_document_outline", {"documentId": "doc-1"})
    sections = json_rows(result["sections"])
    assert len(sections) == 400
    assert sections[0]["title"] == "Part 0"
    assert sections[-1]["title"] == "7.48"
    assert result["truncated"] is True

    harness.facade.answers["get_document_outline"] = _outline([_section("Refunds", summary="s" * 700)])
    cut = harness.read("get_document_outline", {"documentId": "doc-1"})
    assert json_rows(cut["sections"])[0]["summary"] == "s" * 600 + "…"
    assert cut["truncated"] is True


@pytest.mark.parametrize("tool", ["get_document_outline", "read_document"])
def test_a_document_that_is_still_processing_has_nothing_to_read_yet(harness: Harness, tool: str) -> None:
    harness.facade.answers["get_logical_document"] = _logical(active=False)
    message = harness.refused(tool, {"documentId": "doc-1"})
    assert message == "This document has no readable revision yet (it may still be processing)."
    assert harness.facade.called() == ["get_logical_document"]
    assert harness.events[-1]["error"] == message
    assert harness.events[-1]["knowledge_base_id"] == KB


def _chunk(chunk_id: str, text: str, **fields: object) -> dict[str, object]:
    return {
        "createdAt": "2026-11-01T08:00:00Z",
        "documentId": "doc-1",
        "documentRevision": 3,
        "enabled": True,
        "id": chunk_id,
        "knowledgeSpaceId": "space-1",
        "ordinal": 0,
        "parseElementIds": [],
        "sectionPath": ["Refunds"],
        "text": text,
        "tokenCount": 5,
        "userMetadata": {},
        **fields,
    }


def _chunks(chunks: list[dict[str, object]], next_cursor: str | None = None) -> KnowledgeFSDocumentChunkListResponse:
    return KnowledgeFSDocumentChunkListResponse.model_validate({"data": chunks, "nextCursor": next_cursor})


def test_read_document_reads_the_current_revision_top_level_enabled_passages_only(harness: Harness) -> None:
    harness.facade.answers["get_logical_document"] = _logical()
    harness.facade.answers["list_document_chunks"] = _chunks(
        [
            _chunk("chunk-1", "Refunds within 14 days."),
            _chunk("chunk-1a", "within 14 days", parentChunkId="chunk-1"),
            _chunk("chunk-2", "Switched off by an editor.", enabled=False),
            _chunk("chunk-3", "Contact support.", sectionPath=[]),
        ],
        next_cursor="page-2",
    )
    assert harness.read("read_document", {"documentId": "doc-1"}) == {
        "documentId": "doc-1",
        "revision": 3,
        "passages": [
            {"nodeId": "chunk-1", "sectionPath": ["Refunds"], "text": "Refunds within 14 days."},
            {"nodeId": "chunk-3", "sectionPath": [], "text": "Contact support."},
        ],
        "url": f"{CONSOLE}/datasets/new/{KB}/documents/doc-1",
        "nextCursor": "page-2",
    }
    assert harness.facade.calls == [
        ("get_logical_document", {**SCOPE, "document_id": "doc-1"}),
        ("list_document_chunks", {**SCOPE, "document_id": "doc-1", "revision": 3, "cursor": None}),
    ]


def test_read_document_reads_a_named_revision_without_looking_the_document_up(harness: Harness) -> None:
    harness.facade.answers["list_document_chunks"] = _chunks(
        [_chunk("chunk-1", "p" * 7_000), _chunk("chunk-2", "q" * 30_000)]
    )
    result = harness.read("read_document", {"documentId": "doc-1", "revision": 2, "cursor": "page-2"})
    assert harness.facade.calls == [
        ("list_document_chunks", {**SCOPE, "document_id": "doc-1", "revision": 2, "cursor": "page-2"})
    ]
    assert result["revision"] == 2
    assert [passage["text"] for passage in json_rows(result["passages"])] == [
        "p" * 6_000 + "…",
        "q" * 6_000 + "…",
    ]
    assert result["truncated"] is True
    assert "nextCursor" not in result
    assert harness.refused("read_document", {"documentId": "doc-1", "revision": 0}).startswith(
        "Invalid arguments: revision:"
    )


# -- read_chunk --------------------------------------------------------------------------------------


def test_read_chunk_opens_a_passage_with_its_location(harness: Harness) -> None:
    harness.facade.answers["open_knowledge_fs_node"] = {
        "node": {"kind": "chunk", "text": "Refunds within 14 days."},
        "citation": {"sectionPath": ["Refunds"], "pageNumber": 0},
    }
    assert harness.read("read_chunk", {"nodeId": "node-1"}) == {
        "nodeId": "node-1",
        "kind": "chunk",
        "sectionPath": ["Refunds"],
        "page": 0,
        "text": "Refunds within 14 days.",
    }
    assert harness.facade.calls == [("open_knowledge_fs_node", {**SCOPE, "node_id": "node-1"})]


@pytest.mark.parametrize(
    ("answer", "kind"),
    [
        (None, None),
        (["node-1"], None),
        ({"node": "node-1", "citation": ["Refunds"]}, None),
        ({"node": {"kind": "table", "text": 12}, "citation": {"sectionPath": None, "pageNumber": None}}, "table"),
    ],
)
def test_read_chunk_answers_an_empty_passage_for_a_shape_it_does_not_know(
    harness: Harness, answer: object, kind: str | None
) -> None:
    harness.facade.answers["open_knowledge_fs_node"] = answer
    assert harness.read("read_chunk", {"nodeId": "node-1"}) == {
        "nodeId": "node-1",
        "kind": kind,
        "sectionPath": [],
        "text": "",
    }


def test_read_chunk_caps_a_long_passage(harness: Harness) -> None:
    harness.facade.answers["open_knowledge_fs_node"] = {"node": {"kind": "chunk", "text": "z" * (MAX_READ_TEXT + 1)}}
    result = harness.read("read_chunk", {"nodeId": "node-1"})
    assert result["text"] == "z" * MAX_READ_TEXT
    assert result["truncated"] is True
    harness.facade.answers["open_knowledge_fs_node"] = {"node": {"kind": "chunk", "text": "z" * MAX_READ_TEXT}}
    assert "truncated" not in harness.read("read_chunk", {"nodeId": "node-1"})


# -- list_tidy_findings ------------------------------------------------------------------------------


def _side(document_id: str, text: str) -> dict[str, object]:
    return {
        "documentId": document_id,
        "revision": 2,
        "title": f"Title of {document_id}",
        "chunkId": f"chunk-{document_id}",
        "start": 0,
        "end": len(text),
        "text": text,
    }


def _finding(
    finding_id: str, kind: str, similarity: float | None, left: str = "14 days", right: str = "30 days"
) -> dict[str, object]:
    return {
        "id": finding_id,
        "kind": kind,
        "left": _side("doc-1", left),
        "right": _side("doc-2", right),
        "reason": "The refund deadlines differ.",
        "similarity": similarity,
        "status": "open",
        "revision": 1,
        "actionId": None,
        "createdAt": "2026-11-01T08:00:00Z",
    }


def _tidy(harness: Harness, findings: list[dict[str, object]], next_cursor: str | None = None) -> None:
    harness.facade.answers["get_tidy_summary"] = KnowledgeFSTidySummaryResponse.model_validate(
        {
            "findings": [{"status": "open", "kind": "conflict", "count": 2}],
            "documents": {"pending": 0, "scanning": 1, "complete": 5, "failed": 0},
            "modelCalls": 9,
        }
    )
    harness.facade.answers["list_tidy_findings"] = KnowledgeFSTidyFindingListResponse.model_validate(
        {"items": findings, "nextCursor": next_cursor}
    )


def test_tidy_findings_quote_both_sides_and_link_to_the_review_page(harness: Harness) -> None:
    _tidy(harness, [_finding("f" * 64, "similar", 0.93456), _finding("e" * 64, "conflict", None)], next_cursor="c" * 64)
    assert harness.read("list_tidy_findings", {}) == {
        "counts": [{"status": "open", "kind": "conflict", "count": 2}],
        "findings": [
            {
                "id": "f" * 64,
                "kind": "similar",
                "status": "open",
                "reason": "The refund deadlines differ.",
                "similarity": 0.935,
                "left": {
                    "documentId": "doc-1",
                    "title": "Title of doc-1",
                    "revision": 2,
                    "text": "14 days",
                    "url": f"{CONSOLE}/datasets/new/{KB}/documents/doc-1",
                },
                "right": {
                    "documentId": "doc-2",
                    "title": "Title of doc-2",
                    "revision": 2,
                    "text": "30 days",
                    "url": f"{CONSOLE}/datasets/new/{KB}/documents/doc-2",
                },
            },
            {
                "id": "e" * 64,
                "kind": "conflict",
                "status": "open",
                "reason": "The refund deadlines differ.",
                "left": {
                    "documentId": "doc-1",
                    "title": "Title of doc-1",
                    "revision": 2,
                    "text": "14 days",
                    "url": f"{CONSOLE}/datasets/new/{KB}/documents/doc-1",
                },
                "right": {
                    "documentId": "doc-2",
                    "title": "Title of doc-2",
                    "revision": 2,
                    "text": "30 days",
                    "url": f"{CONSOLE}/datasets/new/{KB}/documents/doc-2",
                },
            },
        ],
        "reviewUrl": f"{CONSOLE}/datasets/new/{KB}/tidy",
        "nextCursor": "c" * 64,
    }
    assert harness.facade.calls == [
        ("get_tidy_summary", SCOPE),
        ("list_tidy_findings", {**SCOPE, "query": KnowledgeFSTidyFindingQuery(status="open")}),
    ]


def test_tidy_findings_filter_by_kind_and_status_and_cut_long_quotes(harness: Harness) -> None:
    _tidy(harness, [_finding("f" * 64, "duplicate", 1.0, left="l" * 2_000, right="short")])
    result = harness.read("list_tidy_findings", {"kind": "duplicate", "status": "dismissed", "cursor": "a" * 64})
    finding = json_rows(result["findings"])[0]
    assert finding["left"]["text"] == "l" * 1_500 + "…"
    assert finding["right"]["text"] == "short"
    assert result["truncated"] is True
    assert "nextCursor" not in result
    assert harness.facade.calls[1][1]["query"] == KnowledgeFSTidyFindingQuery(
        status="dismissed", kind="duplicate", cursor="a" * 64
    )


# -- Failures of the knowledge service ---------------------------------------------------------------

# Valid arguments of every tool that reads a knowledge base, and the first facade operation it reaches.
READS: dict[str, tuple[dict[str, object], str]] = {
    "search": ({"query": "refunds"}, "retrieve_evidence"),
    "grep": ({"pattern": "E-1001"}, "grep_knowledge_fs"),
    "browse": ({}, "list_knowledge_fs"),
    "read_path": ({"path": "/knowledge/handbook.md"}, "cat_knowledge_fs"),
    "list_documents": ({}, "list_logical_documents"),
    "get_document": ({"documentId": "doc-1"}, "get_logical_document"),
    "get_document_outline": ({"documentId": "doc-1"}, "get_logical_document"),
    "read_document": ({"documentId": "doc-1"}, "get_logical_document"),
    "read_chunk": ({"nodeId": "node-1"}, "open_knowledge_fs_node"),
    "list_tidy_findings": ({}, "get_tidy_summary"),
}
NOT_FOUND = "Not found."
FORBIDDEN = "Your account may not do this in that knowledge base."
REJECTED = "The request was rejected by the knowledge service."
UNAVAILABLE = "This knowledge base is not available right now."
RETRY = "The knowledge service is temporarily unavailable; retry shortly."
FAILURES: list[tuple[Exception, str, bool]] = [
    (KnowledgeFSProductNotFoundError("control space kb-1 of tenant-secret"), NOT_FOUND, False),
    (KnowledgeFSProductResourceNotFoundError("document doc-1 in bucket-secret"), NOT_FOUND, False),
    (PermissionError("role viewer lacks secret-permission"), FORBIDDEN, False),
    (KnowledgeFSProductRequestRejectedError(status_code=422), REJECTED, False),
    (KnowledgeFSOperationUnavailableError("capability secret-key missing"), UNAVAILABLE, False),
    (RuntimeError("connection to 10.0.0.5:secret refused"), RETRY, True),
]


def test_every_knowledge_base_tool_is_covered_by_the_failure_table() -> None:
    assert sorted(READS) == sorted(tool.name for tool in TOOLS if tool.name != "list_knowledge_bases")


@pytest.mark.parametrize("tool", sorted(READS))
@pytest.mark.parametrize(("failure", "message", "logged"), FAILURES, ids=lambda value: type(value).__name__)
def test_a_failing_knowledge_service_reads_as_a_tool_error_that_gives_nothing_away(
    harness: Harness, caplog: pytest.LogCaptureFixture, tool: str, failure: Exception, message: str, logged: bool
) -> None:
    arguments, operation = READS[tool]
    harness.facade.failures[operation] = failure
    with caplog.at_level(logging.WARNING):
        result = harness.call(tool, {"knowledgeBaseId": KB, **arguments})
    assert result == {"content": [{"type": "text", "text": message}], "isError": True}
    assert "secret" not in json.dumps(result)
    assert harness.facade.called() == [operation]
    event = harness.events[-1]
    assert (event["tool"], event["knowledge_base_id"], event["ok"]) == (tool, KB, False)
    assert event["error"] == type(failure).__name__
    # Only a failure nobody can explain is worth a warning, with its traceback for the operator.
    warnings = [record for record in caplog.records if record.levelno >= logging.WARNING]
    assert [record.getMessage() for record in warnings] == (["knowledge agent tool failed"] if logged else [])
    assert all(record.exc_info is not None for record in warnings)


@pytest.mark.parametrize(
    ("tool", "arguments", "prepared", "failing"),
    [
        ("get_document_outline", {"documentId": "doc-1"}, "get_logical_document", "get_document_outline"),
        ("read_document", {"documentId": "doc-1"}, "get_logical_document", "list_document_chunks"),
        ("list_tidy_findings", {}, "get_tidy_summary", "list_tidy_findings"),
    ],
)
def test_a_failure_in_a_tools_second_step_is_reported_the_same_way(
    harness: Harness, tool: str, arguments: dict[str, object], prepared: str, failing: str
) -> None:
    _tidy(harness, [])
    harness.facade.answers["get_logical_document"] = _logical()
    harness.facade.failures[failing] = KnowledgeFSProductResourceNotFoundError("revision 3 is gone")
    assert harness.refused(tool, arguments) == NOT_FOUND
    assert harness.facade.called() == [prepared, failing]
    assert harness.events[-1]["error"] == "KnowledgeFSProductResourceNotFoundError"


# -- Audit -------------------------------------------------------------------------------------------


def test_every_tool_call_is_written_to_the_audit_log_even_without_a_listener(caplog: pytest.LogCaptureFixture) -> None:
    harness = Harness(audited=False)
    harness.facade.answers["get_logical_document"] = _logical(title="Rückerstattung")
    with caplog.at_level(logging.INFO, logger="services.knowledge_agent.mcp_server"):
        result = harness.call("get_document", {"knowledgeBaseId": KB, "documentId": "doc-1"})
        refused = harness.call("get_document", {"knowledgeBaseId": "kb-other", "documentId": "doc-1"})
    # The text is JSON a person can read: non-ASCII titles are not escaped.
    assert '"title": "Rückerstattung"' in result["content"][0]["text"]
    assert refused["isError"] is True
    records = [record for record in caplog.records if record.__dict__.get("audit")]
    assert [record.getMessage() for record in records] == [
        f"audit: {AUDIT_TOOL_CALL} tool=get_document ok=True",
        f"audit: {AUDIT_TOOL_CALL} tool=get_document ok=False",
    ]
    ok, failed = (record.__dict__ for record in records)
    assert (ok["knowledge_base_id"], ok["grant_id"], ok["account_id"], ok["tenant_id"]) == (
        KB,
        "grant",
        "acct",
        "tenant",
    )
    assert ok["client"] == "Claude Code"
    assert ok["error"] is None
    assert failed["knowledge_base_id"] == "kb-other"
    assert "kb-other is not available to this connection" in failed["error"]
    assert harness.events == []


@pytest.mark.parametrize("claimed", [7, ["kb-1"], None])
def test_an_invalid_knowledge_base_argument_is_audited_without_a_made_up_id(harness: Harness, claimed: object) -> None:
    result = harness.call("list_documents", {"knowledgeBaseId": claimed})
    assert result["isError"] is True
    assert result["content"][0]["text"].startswith("Invalid arguments: knowledgeBaseId:")
    assert harness.events[-1]["error"] == "invalid_arguments"
    assert harness.events[-1]["knowledge_base_id"] is None
    assert harness.facade.calls == []
