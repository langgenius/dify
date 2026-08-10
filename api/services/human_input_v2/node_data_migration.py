"""Application orchestration for side-effect-free Human Input node migration."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Protocol

from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from core.workflow.nodes.human_input_v2.migration import (
    LegacyEmailRecipients,
    LegacyHumanInputNodeData,
    MigrationBlockerCode,
    NodeMigrationConversion,
    convert_legacy_human_input_node_data,
)


class WorkspaceMemberEmailLookup(Protocol):
    """Read the currently usable Account Emails for one workspace scope."""

    def find_member_emails(self, workspace_id: str, account_ids: Sequence[str]) -> Mapping[str, str]: ...


type NodeDataConverter = Callable[
    [LegacyHumanInputNodeData, Mapping[str, str]],
    NodeMigrationConversion,
]


@dataclass(frozen=True, slots=True)
class MigrationNode:
    node_id: str
    node_data: LegacyHumanInputNodeData


@dataclass(frozen=True, slots=True)
class MigratedNode:
    node_id: str
    node_data: HumanInputNodeData


@dataclass(frozen=True, slots=True)
class NodeDataMigrationBlocker:
    node_id: str
    node_title: str
    code: MigrationBlockerCode
    method_id: str | None = None
    value: str | None = None


@dataclass(frozen=True, slots=True)
class NodeDataMigrationSuccess:
    data: tuple[MigratedNode, ...]


@dataclass(frozen=True, slots=True)
class NodeDataMigrationFailure:
    blockers: tuple[NodeDataMigrationBlocker, ...]


type NodeDataMigrationOutcome = NodeDataMigrationSuccess | NodeDataMigrationFailure


class HumanInputNodeDataMigrationService:
    """Create one member snapshot and deterministically preflight a whole batch."""

    def __init__(
        self,
        *,
        member_email_lookup: WorkspaceMemberEmailLookup,
        converter: NodeDataConverter = convert_legacy_human_input_node_data,
    ) -> None:
        self._member_email_lookup = member_email_lookup
        self._converter = converter

    def migrate(self, *, workspace_id: str, nodes: Sequence[MigrationNode]) -> NodeDataMigrationOutcome:
        member_ids = self._collect_member_ids(nodes)
        loaded_member_emails = self._member_email_lookup.find_member_emails(workspace_id, member_ids)
        member_email_snapshot = MappingProxyType(dict(loaded_member_emails))

        migrated_nodes: list[MigratedNode] = []
        blockers: list[NodeDataMigrationBlocker] = []
        for node in nodes:
            conversion = self._converter(node.node_data, member_email_snapshot)
            blockers.extend(
                NodeDataMigrationBlocker(
                    node_id=node.node_id,
                    node_title=node.node_data.title,
                    code=blocker.code,
                    method_id=blocker.method_id,
                    value=blocker.value,
                )
                for blocker in conversion.blockers
            )
            if conversion.node_data is not None:
                migrated_nodes.append(MigratedNode(node.node_id, conversion.node_data))

        if blockers:
            return NodeDataMigrationFailure(tuple(blockers))
        return NodeDataMigrationSuccess(tuple(migrated_nodes))

    @staticmethod
    def _collect_member_ids(nodes: Sequence[MigrationNode]) -> tuple[str, ...]:
        member_ids: list[str] = []
        seen_member_ids: set[str] = set()
        for node in nodes:
            for method in node.node_data.delivery_methods:
                if not method.enabled or method.type != "email":
                    continue
                recipients = method.config.recipients
                if not isinstance(recipients, LegacyEmailRecipients):
                    continue
                for source in recipients.items:
                    member_id = source.reference_id
                    if source.type != "member" or not isinstance(member_id, str) or member_id in seen_member_ids:
                        continue
                    member_ids.append(member_id)
                    seen_member_ids.add(member_id)
        return tuple(member_ids)
