"""Application orchestration for side-effect-free Human Input node migration."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from core.human_input_v2.shared import TenantId
from core.workflow.nodes.human_input_v2.entities import HumanInputNodeData
from core.workflow.nodes.human_input_v2.migration import (
    LegacyDeliveryParseIssue,
    LegacyEmailDeliveryMethod,
    LegacyHumanInputNodeData,
    LegacyMemberRecipient,
    LegacyNodeDataPreflight,
    MemberEmailSnapshot,
    MigrationBlockerCode,
    NodeMigrationConversion,
    convert_legacy_human_input_node_data,
)


class WorkspaceMemberEmailLookup(Protocol):
    """Read the currently usable Account Emails for one workspace scope."""

    def find_member_emails(self, tenant_id: TenantId, account_ids: Sequence[str]) -> MemberEmailSnapshot: ...


type NodeDataConverter = Callable[
    [LegacyHumanInputNodeData, MemberEmailSnapshot],
    NodeMigrationConversion,
]


@dataclass(frozen=True, slots=True)
class MigrationNode:
    node_id: str
    node_data: LegacyHumanInputNodeData
    method_positions: tuple[int, ...] = ()
    recipient_positions: tuple[tuple[int, ...], ...] = ()
    preflight_issues: tuple[LegacyDeliveryParseIssue, ...] = ()

    @classmethod
    def from_preflight(cls, node_id: str, preflight: LegacyNodeDataPreflight) -> MigrationNode:
        return cls(
            node_id=node_id,
            node_data=preflight.node_data,
            method_positions=preflight.method_positions,
            recipient_positions=preflight.recipient_positions,
            preflight_issues=preflight.issues,
        )


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


@dataclass(frozen=True, slots=True)
class _PositionedMigrationBlocker:
    blocker: NodeDataMigrationBlocker
    postflight: bool
    method_position: int
    recipient_position: int
    ordinal: int


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

    def migrate(self, *, tenant_id: TenantId, nodes: Sequence[MigrationNode]) -> NodeDataMigrationOutcome:
        member_ids = self._collect_member_ids(nodes)
        member_email_snapshot = self._member_email_lookup.find_member_emails(tenant_id, member_ids)

        migrated_nodes: list[MigratedNode] = []
        blockers: list[NodeDataMigrationBlocker] = []
        for node in nodes:
            conversion = self._converter(node.node_data, member_email_snapshot)
            blockers.extend(self._ordered_node_blockers(node, conversion))
            if conversion.node_data is not None:
                migrated_nodes.append(MigratedNode(node.node_id, conversion.node_data))

        if blockers:
            return NodeDataMigrationFailure(tuple(blockers))
        return NodeDataMigrationSuccess(tuple(migrated_nodes))

    @staticmethod
    def _ordered_node_blockers(
        node: MigrationNode,
        conversion: NodeMigrationConversion,
    ) -> tuple[NodeDataMigrationBlocker, ...]:
        method_positions = node.method_positions or tuple(range(len(node.node_data.delivery_methods)))
        recipient_positions = node.recipient_positions or tuple(
            tuple(range(len(method.config.recipients.items))) if isinstance(method, LegacyEmailDeliveryMethod) else ()
            for method in node.node_data.delivery_methods
        )
        positioned_blockers: list[_PositionedMigrationBlocker] = []
        ordinal = 0
        for issue in node.preflight_issues:
            positioned_blockers.append(
                _PositionedMigrationBlocker(
                    blocker=NodeDataMigrationBlocker(
                        node_id=node.node_id,
                        node_title=node.node_data.title,
                        code=issue.code,
                        method_id=issue.method_id,
                        value=issue.value,
                    ),
                    postflight=False,
                    method_position=issue.method_position if issue.method_position is not None else -1,
                    recipient_position=issue.recipient_position if issue.recipient_position is not None else -1,
                    ordinal=ordinal,
                )
            )
            ordinal += 1
        for blocker in conversion.blockers:
            postflight = blocker.code in {
                MigrationBlockerCode.CONFLICTING_EMAIL_TEMPLATES,
                MigrationBlockerCode.MISSING_RECIPIENTS,
            }
            method_position = len(method_positions)
            recipient_position = -1
            if blocker.method_index is not None:
                method_position = method_positions[blocker.method_index]
                if blocker.recipient_index is not None:
                    recipient_position = recipient_positions[blocker.method_index][blocker.recipient_index]
            positioned_blockers.append(
                _PositionedMigrationBlocker(
                    blocker=NodeDataMigrationBlocker(
                        node_id=node.node_id,
                        node_title=node.node_data.title,
                        code=blocker.code,
                        method_id=blocker.method_id,
                        value=blocker.value,
                    ),
                    postflight=postflight,
                    method_position=method_position,
                    recipient_position=recipient_position,
                    ordinal=ordinal,
                )
            )
            ordinal += 1
        positioned_blockers.sort(
            key=lambda positioned: (
                positioned.postflight,
                positioned.method_position,
                positioned.recipient_position,
                positioned.ordinal,
            )
        )
        return tuple(positioned.blocker for positioned in positioned_blockers)

    @staticmethod
    def _collect_member_ids(nodes: Sequence[MigrationNode]) -> tuple[str, ...]:
        member_ids: list[str] = []
        seen_member_ids: set[str] = set()
        for node in nodes:
            for method in node.node_data.delivery_methods:
                if not method.enabled or not isinstance(method, LegacyEmailDeliveryMethod):
                    continue
                for source in method.config.recipients.items:
                    if not isinstance(source, LegacyMemberRecipient) or source.user_id in seen_member_ids:
                        continue
                    member_ids.append(source.user_id)
                    seen_member_ids.add(source.user_id)
        return tuple(member_ids)
