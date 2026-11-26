"""The MCP tool contract: argument names, knowledge-base authorisation, and advertised schemas."""

from __future__ import annotations

import json
from collections.abc import Callable
from types import SimpleNamespace
from typing import TypedDict, cast, get_args

import pytest

from services.knowledge_agent.contracts import KnowledgeAgentPrincipal
from services.knowledge_agent.mcp_server import TOOLS, KnowledgeAgentMcpServer, _KnowledgeBaseArgs, _Tool
from services.knowledge_fs.data_facade import KnowledgeFSDataFacade
from services.knowledge_fs.tidy_dto import TidyFindingKind, TidyFindingStatus

PRINCIPAL = KnowledgeAgentPrincipal(
    account_id="acct",
    tenant_id="tenant",
    grant_id="grant",
    token_id="token",
    kind="oauth",
    client_name="Claude Code",
    control_space_ids=("kb-granted",),
)
# Valid arguments for every tool that reads a knowledge base, apart from the base itself.
OTHER_ARGUMENTS: dict[str, dict[str, object]] = {
    "search": {"query": "refunds"},
    "grep": {"pattern": "E-1001"},
    "browse": {},
    "read_path": {"path": "/knowledge/handbook.md"},
    "list_documents": {},
    "get_document": {"documentId": "doc-1"},
    "get_document_outline": {"documentId": "doc-1"},
    "read_document": {"documentId": "doc-1"},
    "read_chunk": {"nodeId": "node-1"},
    "list_tidy_findings": {},
}
BASE_TOOLS = [tool for tool in TOOLS if issubclass(tool.args, _KnowledgeBaseArgs)]


class RecordingFacade:
    """Any facade operation is recorded; none of these tests should reach one."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def __getattr__(self, name: str) -> Callable[..., None]:
        def operation(**kwargs: object) -> None:
            self.calls.append((name, kwargs))
            raise AssertionError(f"facade.{name} must not be reached")

        return operation


class GrantedSpaces:
    def knowledge_bases_for(self, principal: KnowledgeAgentPrincipal) -> set[str]:
        return set(principal.control_space_ids)


class NoNames:
    def list_spaces(self, **_kwargs: object) -> SimpleNamespace:
        raise AssertionError("not listed in these tests")


class ToolResult(TypedDict, total=False):
    content: list[dict[str, str]]
    structuredContent: dict[str, object]
    isError: bool


class InputSchema(TypedDict):
    type: str
    properties: dict[str, dict[str, object]]
    required: list[str]
    additionalProperties: bool


def _server() -> tuple[KnowledgeAgentMcpServer, RecordingFacade, list[dict[str, object]]]:
    facade = RecordingFacade()
    events: list[dict[str, object]] = []
    server = KnowledgeAgentMcpServer(
        facade=cast(KnowledgeFSDataFacade, facade),
        spaces=GrantedSpaces(),
        names=NoNames(),
        console_url="https://cloud.dify.test",
        on_tool_call=events.append,
    )
    return server, facade, events


def _call(server: KnowledgeAgentMcpServer, name: str, arguments: object) -> ToolResult:
    reply = server.handle(
        PRINCIPAL, {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}}
    )
    assert reply is not None
    return reply["result"]


def test_every_tool_but_the_listing_takes_its_knowledge_base_through_the_authorised_model() -> None:
    assert sorted(tool.name for tool in BASE_TOOLS) == sorted(OTHER_ARGUMENTS)
    assert [tool.name for tool in TOOLS if tool not in BASE_TOOLS] == ["list_knowledge_bases"]
    for tool in TOOLS:
        names = {field.alias or name for name, field in tool.args.model_fields.items()} | set(tool.args.model_fields)
        if names & {"knowledgeBaseId", "knowledge_base_id"}:
            assert issubclass(tool.args, _KnowledgeBaseArgs), tool.name


@pytest.mark.parametrize("tool", BASE_TOOLS, ids=lambda tool: tool.name)
def test_a_base_outside_the_grant_is_refused_before_the_tool_runs(tool: _Tool) -> None:
    server, facade, events = _server()
    result = _call(server, tool.name, {**OTHER_ARGUMENTS[tool.name], "knowledgeBaseId": "kb-other"})
    assert result["isError"] is True
    assert "kb-other is not available to this connection" in result["content"][0]["text"]
    assert facade.calls == []
    assert events[-1]["ok"] is False
    assert events[-1]["knowledge_base_id"] == "kb-other"
    assert events[-1]["tool"] == tool.name


@pytest.mark.parametrize("tool", BASE_TOOLS, ids=lambda tool: tool.name)
@pytest.mark.parametrize("base", ["kb-other", "kb-granted"])
def test_the_snake_case_argument_name_is_rejected_as_invalid_arguments(tool: _Tool, base: str) -> None:
    """Regression: `knowledge_base_id` used to validate and skip the grant check entirely."""
    server, facade, events = _server()
    result = _call(server, tool.name, {**OTHER_ARGUMENTS[tool.name], "knowledge_base_id": base})
    assert result["isError"] is True
    text = result["content"][0]["text"]
    assert text.startswith("Invalid arguments:")
    assert "knowledge_base_id" in text
    assert "knowledgeBaseId" in text
    assert facade.calls == []
    assert events[-1]["error"] == "invalid_arguments"


def test_other_snake_case_names_and_both_spellings_together_are_rejected_too() -> None:
    server, facade, _ = _server()
    for arguments in (
        {"knowledgeBaseId": "kb-granted", "document_id": "doc-1"},
        {"knowledgeBaseId": "kb-granted", "node_id": "node-1"},
        {"knowledgeBaseId": "kb-granted", "knowledge_base_id": "kb-other", "documentId": "doc-1"},
    ):
        tool = "read_chunk" if "node_id" in arguments else "get_document"
        result = _call(server, tool, arguments)
        assert result["isError"] is True
        assert result["content"][0]["text"].startswith("Invalid arguments:")
    assert _call(server, "search", ["kb-other"])["content"][0]["text"].startswith("Invalid arguments:")
    assert facade.calls == []


def test_audit_records_carry_the_knowledge_base_on_every_outcome() -> None:
    server, facade, events = _server()
    # Granted: the tool runs (and here its upstream fails), audited with the base it ran against.
    _call(server, "list_documents", {"knowledgeBaseId": "kb-granted"})
    assert [name for name, _ in facade.calls] == ["list_logical_documents"]
    assert facade.calls[0][1]["control_space_id"] == "kb-granted"
    assert events[-1]["knowledge_base_id"] == "kb-granted"
    assert events[-1]["error"] == "AssertionError"
    # Invalid arguments under the documented name still say which base was asked for.
    _call(server, "search", {"knowledgeBaseId": "kb-other"})
    assert events[-1]["knowledge_base_id"] == "kb-other"
    assert events[-1]["error"] == "invalid_arguments"
    for event in events:
        assert event["grant_id"] == "grant"
        assert event["account_id"] == "acct"


def _advertised() -> dict[str, InputSchema]:
    server, _, _ = _server()
    reply = server.handle(PRINCIPAL, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert reply is not None
    return {tool["name"]: tool["inputSchema"] for tool in reply["result"]["tools"]}


def _expected_property(raw: dict[str, object]) -> dict[str, object]:
    """Pydantic's schema of one field, as a client should see it: the value's schema, no null, no title."""
    union = cast(list[dict[str, object]], raw.get("anyOf", []))
    variants = [variant for variant in union if variant != {"type": "null"}]
    assert len(variants) <= 1, raw
    merged = {**(variants[0] if variants else {}), **{key: value for key, value in raw.items() if key != "anyOf"}}
    merged.pop("title", None)
    if merged.get("default", "") is None:
        del merged["default"]
    return merged


@pytest.mark.parametrize("tool", TOOLS, ids=lambda tool: tool.name)
def test_the_advertised_schema_is_the_one_derived_from_the_arguments_model(tool: _Tool) -> None:
    advertised = _advertised()[tool.name]
    derived = tool.args.model_json_schema(by_alias=True)
    fields = tool.args.model_fields
    assert advertised["type"] == "object"
    assert advertised["additionalProperties"] is False
    assert set(advertised) == {"type", "properties", "required", "additionalProperties"}
    assert set(advertised["properties"]) == {field.alias or name for name, field in fields.items()}
    assert sorted(advertised["required"]) == sorted(
        field.alias or name for name, field in fields.items() if field.is_required()
    )
    for name, raw in derived.get("properties", {}).items():
        assert advertised["properties"][name] == _expected_property(raw), name
        assert advertised["properties"][name]["description"], f"{tool.name}.{name} needs a description"
    # Plain for MCP clients: self-contained, no nullable unions, no pydantic titles.
    serialised = json.dumps(advertised)
    for marker in ("$ref", "$defs", "anyOf", '"title"', '"null"'):
        assert marker not in serialised


def test_advertised_schemas_and_validation_agree_on_names_and_literals() -> None:
    advertised = _advertised()
    assert advertised["list_knowledge_bases"] == {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": False,
    }
    search = advertised["search"]
    assert search["required"] == ["knowledgeBaseId", "query"]
    assert search["properties"]["maxResults"] == {
        "type": "integer",
        "minimum": 1,
        "maximum": 50,
        "description": "Default 10.",
    }
    assert sorted(cast(list[str], search["properties"]["mode"]["enum"])) == ["deep", "fast", "research"]
    tidy = advertised["list_tidy_findings"]["properties"]
    # The Tidy literals come from the Tidy DTOs, not from a second list here.
    assert sorted(cast(list[str], tidy["kind"]["enum"])) == sorted(get_args(TidyFindingKind))
    assert sorted(cast(list[str], tidy["status"]["enum"])) == sorted(get_args(TidyFindingStatus))
    # Every advertised name is accepted by validation, and nothing else is.
    for tool in TOOLS:
        for name in advertised[tool.name]["properties"]:
            assert any((field.alias or key) == name for key, field in tool.args.model_fields.items())
