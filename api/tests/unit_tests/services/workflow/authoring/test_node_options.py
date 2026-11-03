import copy
from collections.abc import Sequence

import pytest

from core.tools.entities.api_entities import ToolProviderApiEntity
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_entities import ToolProviderType
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from graphon.graph.validation import _RootNodeValidator
from graphon.nodes.tool.entities import ToolNodeData
from models import AppMode
from services.tools.tool_sources import ToolSource, resolve_tool
from services.workflow.authoring import FillContext
from services.workflow.authoring.node_options import (
    AgentInviteOptions,
    NodeOption,
    NodeOptionKind,
    list_node_options,
)
from services.workflow.authoring.plugins import fill_plugin_values

CTX = FillContext(tenant_id="tenant-1", account_id="account-1")
AGENTS: list[dict[str, str | None]] = [
    {"id": "agent-2", "name": "Writer", "description": "Writes the draft"},
    {"id": "agent-1", "name": "Time Keeper", "description": None},
]


class _Roster:
    """Serves invite options one agent per page, whatever limit it is asked for."""

    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def list_invite_options(
        self,
        *,
        tenant_id: str,
        page: int = 1,
        limit: int = 20,
        keyword: str | None = None,
        accessible_agent_ids: Sequence[str] | None = None,
    ) -> dict[str, object]:
        self.calls.append(
            {"tenant_id": tenant_id, "page": page, "keyword": keyword, "accessible_agent_ids": accessible_agent_ids}
        )
        visible = [a for a in AGENTS if accessible_agent_ids is None or a["id"] in accessible_agent_ids]
        return {
            "data": visible[page - 1 : page],
            "page": page,
            "limit": limit,
            "total": len(visible),
            "has_more": page < len(visible),
        }


class _EndlessEmptyRoster:
    """Claims more agents on every page but never serves one."""

    def __init__(self) -> None:
        self.pages: list[int] = []

    def list_invite_options(self, *, page: int, **_kwargs: object) -> dict[str, object]:
        self.pages.append(page)
        return {"data": [], "page": page, "limit": 100, "total": 1, "has_more": True}


class _NoRoster:
    def list_invite_options(self, **_kwargs: object) -> dict[str, object]:
        raise AssertionError("the roster is not read for this kind")


def _time_provider() -> ToolProviderApiEntity:
    tool = resolve_tool(tenant_id=CTX.tenant_id, provider_type="builtin", provider_id="time", tool_name="current_time")
    assert tool is not None
    return ToolProviderApiEntity(
        id="time",
        author="langgenius",
        name="time",
        description=I18nObject(en_US="time"),
        icon="",
        label=I18nObject(en_US="CurrentTime"),
        type=ToolProviderType.BUILT_IN,
        tools=[tool],
    )


@pytest.fixture
def tools(monkeypatch: pytest.MonkeyPatch) -> list[ToolSource]:
    listed: list[ToolSource] = []
    provider = _time_provider()

    def list_providers(self: ToolSource, *, tenant_id: str, user_id: str) -> list[ToolProviderApiEntity]:
        assert (tenant_id, user_id) == (CTX.tenant_id, CTX.account_id)
        listed.append(self)
        return [provider] if self is ToolSource.BUILTIN else []

    monkeypatch.setattr(ToolSource, "list_providers", list_providers)
    return listed


def _options(
    mode: AppMode = AppMode.WORKFLOW,
    *,
    kind: NodeOptionKind | None = None,
    keyword: str | None = None,
    accessible_agent_ids: Sequence[str] | None = None,
    roster: AgentInviteOptions | None = None,
    language: str | None = None,
) -> list[NodeOption]:
    return list_node_options(
        ctx=CTX,
        mode=mode,
        kind=kind,
        keyword=keyword,
        accessible_agent_ids=lambda: accessible_agent_ids,
        roster=roster if roster is not None else _Roster(),
        language=language,
    )


def _block_types(mode: AppMode) -> set[str]:
    return {o.type for o in _options(mode, kind=NodeOptionKind.BLOCK, roster=_NoRoster())}


def test_container_entry_types_are_the_iteration_and_loop_starts() -> None:
    assert _RootNodeValidator().container_entry_types == ("iteration-start", "loop-start")


def test_workflow_blocks_include_the_plain_and_trigger_blocks() -> None:
    assert {"start", "llm", "end", "code", "trigger-schedule", "trigger-webhook"} <= _block_types(AppMode.WORKFLOW)


def test_workflow_blocks_leave_out_refused_container_entry_and_plugin_backed_types() -> None:
    blocks = _block_types(AppMode.WORKFLOW)

    assert not {"answer", "iteration-start", "loop-start", "tool", "trigger-plugin", "datasource"} & blocks
    assert not {"agent", "knowledge-index"} & blocks


def test_advanced_chat_blocks_have_answer_and_no_end_or_triggers() -> None:
    blocks = _block_types(AppMode.ADVANCED_CHAT)

    assert "answer" in blocks
    assert not {"end", "trigger-schedule", "trigger-webhook", "trigger-plugin"} & blocks


def test_a_block_offers_its_latest_version_with_a_minimal_seed() -> None:
    by_type = {o.type: o for o in _options(kind=NodeOptionKind.BLOCK, roster=_NoRoster())}

    llm = by_type["llm"]
    assert (llm.kind, llm.version, llm.label, llm.description) == (NodeOptionKind.BLOCK, "1", "llm", None)
    assert llm.seed == {"type": "llm", "version": "1", "title": "llm"}
    assert by_type["human-input"].version == "2"


def test_tool_rows_include_builtin_current_time(tools: list[ToolSource]) -> None:
    rows = _options(kind=NodeOptionKind.TOOL, roster=_NoRoster())

    assert tools == list(ToolSource)
    [row] = rows
    assert (row.kind, row.type, row.version, row.label) == (NodeOptionKind.TOOL, "tool", "1", "Current Time")
    assert row.description
    assert row.seed == {
        "type": "tool",
        "title": "Current Time",
        "provider_type": "builtin",
        "provider_id": "time",
        "provider_name": "time",
        "tool_name": "current_time",
        "tool_label": "Current Time",
        "tool_node_version": "2",
    }


@pytest.mark.usefixtures("tools")
def test_tool_rows_read_labels_in_the_given_language() -> None:
    [row] = _options(kind=NodeOptionKind.TOOL, roster=_NoRoster(), language="zh-Hans")

    assert (row.label, row.seed["tool_label"], row.description) == (
        "获取当前时间",
        "获取当前时间",
        "一个用于获取当前时间的工具。",
    )


@pytest.mark.usefixtures("tools")
def test_keyword_matches_the_label_in_the_given_language() -> None:
    rows = _options(kind=NodeOptionKind.TOOL, keyword="当前", roster=_NoRoster(), language="zh-Hans")

    assert [r.label for r in rows] == ["获取当前时间"]


@pytest.mark.usefixtures("tools")
def test_a_tool_seed_is_completed_by_fill() -> None:
    [row] = _options(kind=NodeOptionKind.TOOL, roster=_NoRoster())
    raw = copy.deepcopy(dict(row.seed))

    fill_plugin_values(raw, CTX)

    assert raw["tool_configurations"]["timezone"] == {"type": "constant", "value": "UTC"}
    assert {key: raw[key] for key in row.seed} == row.seed


def test_agent_rows_come_from_the_roster_in_the_web_seed_shape() -> None:
    roster = _Roster()

    rows = _options(kind=NodeOptionKind.AGENT, roster=roster)

    assert [r.label for r in rows] == ["Time Keeper", "Writer"]
    keeper, writer = rows
    assert (keeper.kind, keeper.type, keeper.version, keeper.description) == (NodeOptionKind.AGENT, "agent", "2", None)
    assert writer.description == "Writes the draft"
    assert keeper.seed == {
        "type": "agent",
        "version": "2",
        "agent_node_kind": "dify_agent",
        "title": "Time Keeper",
        "agent_binding": {"binding_type": "roster_agent", "agent_id": "agent-1"},
    }
    DifyAgentNodeData.model_validate(keeper.seed)


def test_agents_are_read_page_by_page_until_none_are_left() -> None:
    roster = _Roster()

    _options(kind=NodeOptionKind.AGENT, roster=roster)

    assert [c["page"] for c in roster.calls] == [1, 2]
    assert {c["tenant_id"] for c in roster.calls} == {CTX.tenant_id}


def test_agents_stop_at_an_empty_page_even_when_more_are_claimed() -> None:
    roster = _EndlessEmptyRoster()

    rows = _options(kind=NodeOptionKind.AGENT, roster=roster)

    assert (rows, roster.pages) == ([], [1])


def test_agents_are_limited_to_the_accessible_ones() -> None:
    roster = _Roster()

    rows = _options(kind=NodeOptionKind.AGENT, accessible_agent_ids=["agent-2"], roster=roster)

    assert [r.label for r in rows] == ["Writer"]
    assert roster.calls[0]["accessible_agent_ids"] == ["agent-2"]


@pytest.mark.usefixtures("tools")
def test_all_kinds_are_listed_sorted_by_kind_then_label() -> None:
    rows = _options()

    assert {r.kind for r in rows} == set(NodeOptionKind)
    assert rows == sorted(rows, key=lambda r: (r.kind, r.label))


@pytest.mark.usefixtures("tools")
def test_keyword_filters_labels_case_insensitively() -> None:
    roster = _Roster()

    rows = _options(keyword="TIME", roster=roster)

    assert [(r.kind, r.label) for r in rows] == [
        (NodeOptionKind.AGENT, "Time Keeper"),
        (NodeOptionKind.TOOL, "Current Time"),
    ]
    assert roster.calls[0]["keyword"] == "TIME"


def test_blocks_never_offer_a_type_another_kind_seeds() -> None:
    blocks = {o.type for o in _options(kind=NodeOptionKind.BLOCK, roster=_NoRoster())}

    for kind in NodeOptionKind:
        if kind.seeded_model is not None:
            assert kind.seeded_model.model_fields["type"].default not in blocks


def test_only_kinds_seeding_a_registered_node_declare_a_seeded_model() -> None:
    assert NodeOptionKind.BLOCK.seeded_model is None
    assert NodeOptionKind.NOTE.seeded_model is None
    assert NodeOptionKind.TOOL.seeded_model is ToolNodeData
    assert NodeOptionKind.AGENT.seeded_model is DifyAgentNodeData


@pytest.mark.parametrize("mode", [AppMode.WORKFLOW, AppMode.ADVANCED_CHAT])
def test_a_note_row_is_offered_in_both_graph_modes(mode: AppMode) -> None:
    [row] = _options(mode, kind=NodeOptionKind.NOTE, roster=_NoRoster())

    assert (row.kind, row.type, row.version, row.label) == (NodeOptionKind.NOTE, "custom-note", "", "custom-note")
    assert row.seed == {
        "type": "custom-note",
        "data": {"type": "", "text": "", "showAuthor": True, "covers": []},
    }


def test_the_note_row_names_every_theme_and_fabricates_no_theme_or_author() -> None:
    [row] = _options(kind=NodeOptionKind.NOTE, roster=_NoRoster())

    assert row.description is not None
    assert all(theme in row.description for theme in ("blue", "cyan", "green", "yellow", "pink", "violet"))
    assert {"theme", "author"}.isdisjoint(row.seed["data"])

