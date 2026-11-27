"""The MCP tool contract: argument names, knowledge-base authorisation, and advertised schemas."""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable
from typing import TypedDict

import pytest

from services.knowledge_agent.contracts import KnowledgeAgentPrincipal
from services.knowledge_agent.mcp_server import (
    TOOLS,
    KnowledgeAgentMcpServer,
    KnowledgeAgentToolError,
    _downstream,
    _KnowledgeBaseArgs,
    _Tool,
)
from services.knowledge_fs.product_dto import KnowledgeFSCatQuery, KnowledgeFSListQuery
from services.knowledge_fs.tidy_dto import KnowledgeFSTidyFindingQuery, TidyFindingKind, TidyFindingStatus
from tests.helpers.unit.knowledge_agent import FakeKnowledgeFacade, SpaceListing, json_rows

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


class GrantedSpaces:
    def knowledge_bases_for(
        self, principal: KnowledgeAgentPrincipal, *, among: Iterable[str] | None = None
    ) -> set[str]:
        granted = set(principal.control_space_ids)
        return granted if among is None else granted & set(among)


class NoNames:
    def list_spaces(self, **_kwargs: object) -> SpaceListing:
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


def _server() -> tuple[KnowledgeAgentMcpServer, FakeKnowledgeFacade, list[dict[str, object]]]:
    """A server whose facade has no prepared answers: none of these tests should get one."""
    facade = FakeKnowledgeFacade()
    events: list[dict[str, object]] = []
    server = KnowledgeAgentMcpServer(
        facade=facade,
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


def _expected_property(raw: dict[str, object], defs: dict[str, dict[str, object]]) -> dict[str, object]:
    """Pydantic's schema of one field, as a client should see it: the value's schema, no null, no title.

    An enum is a named definition in pydantic's schema; a client sees its values in place.
    """
    variants = [variant for variant in json_rows(raw.get("anyOf", [])) if variant != {"type": "null"}]
    assert len(variants) <= 1, raw
    merged = {**(variants[0] if variants else {}), **{key: value for key, value in raw.items() if key != "anyOf"}}
    reference = merged.pop("$ref", None)
    if isinstance(reference, str):
        merged = {**defs[reference.removeprefix("#/$defs/")], **merged}
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
        assert advertised["properties"][name] == _expected_property(raw, derived.get("$defs", {})), name
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
    assert search["properties"]["mode"]["enum"] == ["fast", "deep", "research"]
    tidy = advertised["list_tidy_findings"]["properties"]
    # The Tidy values come from the Tidy DTOs, not from a second list here, and are plain strings.
    assert tidy["kind"]["enum"] == [kind.value for kind in TidyFindingKind] == ["duplicate", "similar", "conflict"]
    assert tidy["status"]["enum"] == [status.value for status in TidyFindingStatus]
    assert tidy["status"]["enum"] == ["open", "dismissed", "reviewed", "disabled", "outdated"]
    # Plain JSON strings, not enum members: the schema is serialised as it is.
    assert '"enum": ["duplicate", "similar", "conflict"]' in json.dumps(tidy["kind"])
    # Every advertised name is accepted by validation, and nothing else is.
    for tool in TOOLS:
        for name in advertised[tool.name]["properties"]:
            assert any((field.alias or key) == name for key, field in tool.args.model_fields.items())


# What each tool refuses up front because the KnowledgeFS query it builds would refuse it.
REFUSED_UPSTREAM: list[tuple[str, dict[str, object], str]] = [
    ("list_tidy_findings", {"cursor": "not-a-finding-cursor"}, "cursor"),
    ("list_tidy_findings", {"cursor": "E" * 64}, "cursor"),
    ("search", {"query": "   "}, "query"),
    ("grep", {"pattern": " \t "}, "pattern"),
    ("grep", {"pattern": "E-1001", "path": "/knowledge//handbook"}, "path"),
    ("browse", {"path": "/knowledge/"}, "path"),
    ("browse", {"path": "/knowledge/" + "a" * 4096}, "path"),
    ("read_path", {"path": "/knowledge/a b"}, "path"),
    ("read_path", {"path": "/knowledge/handbook/"}, "path"),
]


@pytest.mark.parametrize(("tool", "arguments", "field"), REFUSED_UPSTREAM)
def test_arguments_the_knowledge_service_would_refuse_are_invalid_arguments_not_an_outage(
    tool: str, arguments: dict[str, object], field: str, caplog: pytest.LogCaptureFixture
) -> None:
    """Regression: these passed the tool's model, failed the query's, and read as "temporarily unavailable"."""
    server, facade, events = _server()
    with caplog.at_level(logging.WARNING):
        result = _call(server, tool, {**OTHER_ARGUMENTS[tool], **arguments, "knowledgeBaseId": "kb-granted"})
    assert result["isError"] is True
    text = result["content"][0]["text"]
    assert text.startswith("Invalid arguments:")
    assert field in text
    assert "unavailable" not in text
    assert facade.calls == []
    assert events[-1]["error"] == "invalid_arguments"
    # A caller's mistake is not logged as a failure, with or without a traceback.
    assert caplog.records == []


def test_the_advertised_schema_carries_the_constraints_of_the_queries_the_tools_build() -> None:
    advertised = _advertised()
    cursor = advertised["list_tidy_findings"]["properties"]["cursor"]
    assert (
        cursor["pattern"]
        == KnowledgeFSTidyFindingQuery.model_json_schema()["properties"]["cursor"]["anyOf"][0]["pattern"]
    )
    # Every path a tool accepts is one the KnowledgeFS queries accept.
    for tool, query in (
        ("browse", KnowledgeFSListQuery),
        ("grep", KnowledgeFSListQuery),
        ("read_path", KnowledgeFSCatQuery),
    ):
        path = advertised[tool]["properties"]["path"]
        assert path["maxLength"] == query.model_json_schema()["properties"]["path"]["maxLength"]
        for accepted in ("/knowledge/handbook.md", "/sources/a/b", "/evidence/x"):
            query.model_validate({"path": accepted})
            assert _call_arguments_valid(tool, {"path": accepted})
    assert advertised["search"]["properties"]["query"]["pattern"] == r"\S"
    assert advertised["grep"]["properties"]["pattern"]["pattern"] == r"\S"


def _call_arguments_valid(tool: str, arguments: dict[str, object]) -> bool:
    model = next(candidate.args for candidate in TOOLS if candidate.name == tool)
    model.model_validate({**OTHER_ARGUMENTS[tool], **arguments, "knowledgeBaseId": "kb-granted"})
    return True


def test_a_query_refused_after_the_tool_model_accepted_it_is_still_a_readable_argument_error() -> None:
    """The safety net behind the argument models: a refused query never becomes a generic failure."""
    with pytest.raises(KnowledgeAgentToolError, match=r"^Invalid arguments: cursor: "):
        _downstream(KnowledgeFSTidyFindingQuery, {"status": "open", "cursor": "abc"})
    assert _downstream(KnowledgeFSTidyFindingQuery, {"status": "open", "cursor": "a" * 64}).cursor == "a" * 64


def test_every_advertised_tool_has_a_handler_and_no_handler_is_unadvertised() -> None:
    server, _, _ = _server()
    assert set(server._handlers()) == {tool.name for tool in TOOLS}
