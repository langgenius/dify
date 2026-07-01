"""Unit tests for slash-menu candidates assembly (ENG-615)."""

from __future__ import annotations

from types import SimpleNamespace

from fields.agent_fields import AgentComposerCandidatesResponse
from models.agent_config_entities import AgentSoulConfig, DeclaredOutputConfig, DeclaredOutputType
from services.agent.composer_candidates import (
    MAX_CANDIDATES_PER_LIST,
    previous_node_output_candidates,
    soul_candidates,
)

_GRAPH = {
    "nodes": [
        {
            "id": "start-1",
            "data": {
                "type": "start",
                "title": "START",
                "variables": [{"variable": "tenders", "type": "file-list"}],
            },
        },
        {"id": "llm-1", "data": {"type": "llm", "title": "LLM"}},
        {"id": "agent-up", "data": {"type": "agent", "version": "2", "title": "Upstream Agent"}},
        {"id": "agent-target", "data": {"type": "agent", "version": "2", "title": "Target Agent"}},
        {"id": "end", "data": {"type": "end", "title": "END"}},
    ],
    "edges": [
        {"source": "start-1", "target": "llm-1"},
        {"source": "llm-1", "target": "agent-up"},
        {"source": "agent-up", "target": "agent-target"},
        {"source": "agent-target", "target": "end"},
    ],
}


def _declared_loader(nid: str) -> list[DeclaredOutputConfig] | None:
    if nid == "agent-up":
        return [DeclaredOutputConfig(name="summary", type=DeclaredOutputType.STRING)]
    return None


def _draft_vars(nid: str) -> list[tuple[str, str | None]]:
    if nid == "llm-1":
        return [("text", "string")]
    return []


def _collect(node_id: str, *, system_vars=()):
    entries, truncated = previous_node_output_candidates(
        graph=_GRAPH,
        node_id=node_id,
        declared_outputs_loader=_declared_loader,
        draft_variables_loader=_draft_vars,
        system_variables_loader=lambda: list(system_vars),
    )
    return entries, truncated


def test_upstream_outputs_follow_inspector_semantics():
    entries, truncated = _collect("agent-target", system_vars=[("query", "string")])

    assert truncated is False
    by_node = {}
    for entry in entries:
        by_node.setdefault(entry["node_id"], []).append(entry)

    # sys vars ride as a pseudo node, run-derived
    assert by_node["sys"][0]["selector"] == ["sys", "query"]
    assert by_node["sys"][0]["inferred"] is True
    # start variables are static graph facts
    start = by_node["start-1"][0]
    assert start["selector"] == ["start-1", "tenders"]
    assert start["name"] == "START/tenders"
    assert start["inferred"] is False
    assert start["value_type"] == "file-list"
    # agent v2 upstream node uses its declared outputs
    agent = by_node["agent-up"][0]
    assert agent["output"] == "summary"
    assert agent["value_type"] == "string"
    assert agent["inferred"] is False
    # other kinds fall back to draft variables (inferred)
    llm = by_node["llm-1"][0]
    assert llm["output"] == "text"
    assert llm["inferred"] is True
    # the target node itself and downstream nodes never appear
    assert "agent-target" not in by_node
    assert "end" not in by_node


def test_results_differ_per_node_id():
    entries_target, _ = _collect("agent-target")
    entries_llm, _ = _collect("llm-1")

    assert {e["node_id"] for e in entries_target} == {"start-1", "llm-1", "agent-up"}
    assert {e["node_id"] for e in entries_llm} == {"start-1"}


def test_previous_outputs_capped_and_flagged():
    graph = {
        "nodes": [{"id": "start-1", "data": {"type": "start", "title": "S", "variables": []}}, {"id": "t"}],
        "edges": [{"source": "start-1", "target": "t"}],
    }
    many: list[tuple[str, str | None]] = [(f"v{i}", "string") for i in range(MAX_CANDIDATES_PER_LIST + 5)]
    entries, truncated = previous_node_output_candidates(
        graph=graph,
        node_id="t",
        declared_outputs_loader=lambda nid: None,
        draft_variables_loader=lambda nid: [],
        system_variables_loader=lambda: many,
    )
    assert len(entries) == MAX_CANDIDATES_PER_LIST
    assert truncated is True


def _soul() -> AgentSoulConfig:
    return AgentSoulConfig.model_validate(
        {
            "tools": {
                "cli_tools": [
                    {"id": "ct-1", "name": "ffmpeg"},
                    {"id": "ct-2", "name": "disabled-one", "enabled": False},
                ],
            },
            "knowledge": {
                "sets": [
                    {
                        "id": "kb-1",
                        "name": "产品知识",
                        "description": "knowledge set",
                        "datasets": [{"id": "ds-1", "name": "旧名"}, {"id": "ds-gone", "name": "已删"}],
                        "query": {"mode": "generated_query"},
                        "retrieval": {"mode": "multiple", "top_k": 4},
                    }
                ]
            },
            "human": {"contacts": [{"id": "c-1", "name": "David Hayes", "channel": "email"}]},
        }
    )


def test_soul_candidates_lists_configured_items_only():
    lists, truncated = soul_candidates(
        agent_soul=_soul(),
        dataset_lookup=lambda ids: {"ds-1": SimpleNamespace(name="产品手册", description="desc")},
        workspace_tools_loader=lambda: [
            {"id": "tavily/tavily_search", "name": "tavily_search", "provider": "tavily", "plugin_id": "lg/tavily"}
        ],
    )

    assert truncated is False
    assert [item["name"] for item in lists["cli_tools"]] == ["ffmpeg"]
    # the stable mention id flows through so the frontend can mint [§cli_tool:<id>§]
    assert [item["id"] for item in lists["cli_tools"]] == ["ct-1"]
    # Knowledge mentions point at set ids; nested datasets are hydrated for context.
    knowledge_set = lists["knowledge_sets"][0]
    assert knowledge_set["id"] == "kb-1"
    assert knowledge_set["name"] == "产品知识"
    assert knowledge_set["missing_dataset_ids"] == ["ds-gone"]
    datasets = {item["id"]: item for item in knowledge_set["datasets"]}
    assert datasets["ds-1"]["name"] == "产品手册"
    assert datasets["ds-1"]["missing"] is False
    assert datasets["ds-gone"]["missing"] is True
    assert datasets["ds-gone"]["name"] == "已删"
    assert lists["human_contacts"][0]["id"] == "c-1"
    assert lists["dify_tools"][0]["id"] == "tavily/tavily_search"


def test_candidates_response_omits_legacy_skill_file_candidates():
    response = AgentComposerCandidatesResponse.model_validate(
        {
            "variant": "agent_app",
            "allowed_node_job_candidates": {},
            "allowed_soul_candidates": {
                "cli_tools": [],
            },
            "capabilities": {"human_roster_available": False},
        }
    ).model_dump(mode="json")

    assert "skills_files" not in response["allowed_soul_candidates"]


def test_soul_candidates_empty_config_yields_empty_lists():
    lists, truncated = soul_candidates(
        agent_soul=None,
        dataset_lookup=lambda ids: {},
        workspace_tools_loader=lambda: [],
    )
    assert truncated is False
    assert all(value == [] for value in lists.values())


def test_soul_candidates_caps_lists():
    lists, truncated = soul_candidates(
        agent_soul=None,
        dataset_lookup=lambda ids: {},
        workspace_tools_loader=lambda: [{"id": str(i)} for i in range(MAX_CANDIDATES_PER_LIST + 1)],
    )
    assert len(lists["dify_tools"]) == MAX_CANDIDATES_PER_LIST
    assert truncated is True
