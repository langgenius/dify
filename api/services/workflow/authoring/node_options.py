"""What an app of one mode can add to its graph, as the canvas "add node" menu offers it, each with a seed to copy."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import TYPE_CHECKING, Any, Final, Protocol, Self, get_args

from pydantic import BaseModel

from core.workflow.node_factory import LATEST_VERSION, get_node_type_classes_mapping, node_data_model
from core.workflow.nodes.agent_v2.entities import DifyAgentNodeData
from graphon.graph.validation import _RootNodeValidator
from graphon.nodes.base.node import Node
from graphon.nodes.tool.entities import ToolNodeData
from libs.i18n_text import localized
from models import AppMode
from models.agent import WorkflowAgentBindingType
from services.tools.tool_sources import TOOL_NODE_VERSION, ToolNodeIdentity, ToolSource
from services.workflow.authoring.plugins import references_for
from services.workflow.graph_check import refused_node_types

if TYPE_CHECKING:
    from services.workflow.authoring import FillContext

_ROSTER_PAGE_SIZE: Final = 100
# No account language reaches here; plugin text is read in its fallback language.
_LANGUAGE: Final = None


class AgentInviteOptions(Protocol):
    def list_invite_options(
        self,
        *,
        tenant_id: str,
        page: int,
        limit: int,
        keyword: str | None,
        accessible_agent_ids: Sequence[str] | None,
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class NodeOption:
    kind: NodeOptionKind
    type: str
    version: str
    label: str
    description: str | None
    seed: Mapping[str, Any]


@dataclass(frozen=True)
class _Request:
    ctx: FillContext
    keyword: str | None
    accessible_agent_ids: Sequence[str] | None
    roster: AgentInviteOptions


def _latest_nodes() -> Iterator[tuple[str, type[Node]]]:
    for node_type, versions in get_node_type_classes_mapping().items():
        yield node_type, versions[LATEST_VERSION]


def _is_block(node_type: str, model: type[BaseModel]) -> bool:
    if node_type in _RootNodeValidator().container_entry_types:
        return False
    if references_for(model) is not None:
        return False
    return model not in {kind.seeded_model for kind in NodeOptionKind}


def _block(node_type: str, node_class: type[Node]) -> NodeOption:
    version = node_class.version()
    return NodeOption(
        kind=NodeOptionKind.BLOCK,
        type=node_type,
        version=version,
        label=node_type,
        description=None,
        seed={"type": node_type, "version": version, "title": node_type},
    )


def _blocks(request: _Request) -> Iterable[NodeOption]:
    return [_block(node_type, cls) for node_type, cls in _latest_nodes() if _is_block(node_type, node_data_model(cls))]


def _tools(request: _Request) -> Iterable[NodeOption]:
    node_type, version = NodeOptionKind.TOOL.seeded_node
    for source in ToolSource:
        for provider in source.list_providers(tenant_id=request.ctx.tenant_id, user_id=request.ctx.account_id):
            for tool in provider.tools:
                identity = ToolNodeIdentity.of(provider, tool, _LANGUAGE)
                names = {key: value for key, value in asdict(identity).items() if value is not None}
                yield NodeOption(
                    kind=NodeOptionKind.TOOL,
                    type=node_type,
                    version=version,
                    label=identity.tool_label,
                    description=localized(tool.description, _LANGUAGE),
                    seed={"type": node_type, **names, "tool_node_version": TOOL_NODE_VERSION},
                )


def _roster_agents(request: _Request) -> Iterator[Mapping[str, Any]]:
    """Every invite option the roster serves, read page by page until it reports no more."""
    page = 1
    has_more = True
    while has_more:
        result = request.roster.list_invite_options(
            tenant_id=request.ctx.tenant_id,
            page=page,
            limit=_ROSTER_PAGE_SIZE,
            keyword=request.keyword,
            accessible_agent_ids=request.accessible_agent_ids,
        )
        yield from result["data"]
        has_more = bool(result["has_more"])
        page += 1


def _agents(request: _Request) -> Iterable[NodeOption]:
    node_type, version = NodeOptionKind.AGENT.seeded_node
    [agent_node_kind] = get_args(DifyAgentNodeData.model_fields["agent_node_kind"].annotation)
    for agent in _roster_agents(request):
        yield NodeOption(
            kind=NodeOptionKind.AGENT,
            type=node_type,
            version=version,
            label=agent["name"],
            description=agent["description"] or None,
            seed={
                "type": node_type,
                "version": version,
                "agent_node_kind": agent_node_kind,
                "title": agent["name"],
                "agent_binding": {"binding_type": WorkflowAgentBindingType.ROSTER_AGENT.value, "agent_id": agent["id"]},
            },
        )


class NodeOptionKind(StrEnum):
    """Where a node option comes from; a kind other than block seeds the nodes whose data is its `seeded_model`."""

    seeded_model: type[BaseModel] | None
    lister: Callable[[_Request], Iterable[NodeOption]]

    def __new__(
        cls, value: str, seeded_model: type[BaseModel] | None, lister: Callable[[_Request], Iterable[NodeOption]]
    ) -> Self:
        member = str.__new__(cls, value)
        member._value_ = value
        member.seeded_model = seeded_model
        member.lister = lister
        return member

    BLOCK = ("block", None, _blocks)
    TOOL = ("tool", ToolNodeData, _tools)
    AGENT = ("agent", DifyAgentNodeData, _agents)

    @property
    def seeded_node(self) -> tuple[str, str]:
        """The type and version of the latest registered node whose data is this kind's seeded model."""
        for node_type, node_class in _latest_nodes():
            if node_data_model(node_class) is self.seeded_model:
                return node_type, node_class.version()
        raise LookupError(f"no registered node runs the data {self} seeds")


def _matches(option: NodeOption, keyword: str | None) -> bool:
    if keyword is None:
        return True
    return keyword.casefold() in option.label.casefold()


def list_node_options(
    *,
    ctx: FillContext,
    mode: AppMode,
    kind: NodeOptionKind | None,
    keyword: str | None,
    accessible_agent_ids: Sequence[str] | None,
    roster: AgentInviteOptions,
) -> list[NodeOption]:
    """Every option an app of `mode` can add, of `kind` or of every kind when None, sorted by kind then label.

    `keyword` keeps the options whose label contains it, ignoring case. Types `mode` refuses are never offered.
    Agents are read from `roster` page by page until none are left, limited to `accessible_agent_ids` when given.
    Reads only; a failing tool source or roster raises its own error.
    """
    request = _Request(ctx=ctx, keyword=keyword, accessible_agent_ids=accessible_agent_ids, roster=roster)
    refused = refused_node_types(mode)
    kinds = [kind] if kind is not None else list(NodeOptionKind)
    options = [
        option
        for listed in kinds
        for option in listed.lister(request)
        if option.type not in refused
        if _matches(option, keyword)
    ]
    return sorted(options, key=lambda option: (option.kind, option.label))
