"""Pure legacy Human Input node-data conversion.

This module owns only deterministic value conversion. Database access,
workspace scoping, Contact state, and transport response mapping belong to the
application and adapter layers.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass

from core.human_input_v2.entities import DebugChannel
from core.human_input_v2.shared.values import NormalizedEmail
from core.workflow.human_input_adapter import (
    DeliveryChannelConfig,
    EmailDeliveryConfig,
    EmailDeliveryMethod,
    ExternalRecipient,
    WebAppDeliveryMethod,
)
from core.workflow.nodes.human_input.entities import HumanInputNodeDataFull

from .entities import (
    HUMAN_INPUT_NODE_TYPE,
    AllWorkspaceContacts,
    DebugModeConfig,
    HumanInputNodeData,
    Initiator,
    MessageTemplateConfig,
    OnetimeEmail,
    RecipientConfig,
)


@dataclass(frozen=True, slots=True)
class ResolvedMemberEmail:
    member_id: str
    email: NormalizedEmail


@dataclass(frozen=True, slots=True)
class MemberEmailSnapshot:
    """Immutable request-local workspace member Email snapshot."""

    entries: tuple[ResolvedMemberEmail, ...] = ()

    def email_for(self, member_id: str) -> NormalizedEmail | None:
        for entry in self.entries:
            if entry.member_id == member_id:
                return entry.email
        return None


@dataclass(frozen=True, slots=True)
class NodeMigrationBlocker:
    code: MigrationBlockerCode
    method_id: str | None = None
    value: str | None = None
    method_index: int | None = None
    recipient_index: int | None = None


@dataclass(frozen=True, slots=True)
class NodeMigrationConversion:
    node_data: HumanInputNodeData | None
    blockers: tuple[NodeMigrationBlocker, ...]


class MigrationBlockerCode(enum.StrEnum):
    INVALID_DEFAULT_VALUE = "invalid-default-value"
    CONFIGURED_DISABLED_METHOD = "configured-disabled-method"
    UNSUPPORTED_DELIVERY_METHOD = "unsupported-delivery-method"
    INVALID_EMAIL_CONFIGURATION = "invalid-email-configuration"
    INVALID_EMAIL = "invalid-email"
    UNRESOLVED_MEMBER = "unresolved-member"
    CONFLICTING_EMAIL_TEMPLATES = "conflicting-email-templates"
    MISSING_RECIPIENTS = "missing-recipients"


@dataclass(frozen=True, slots=True)
class LegacyDeliveryParseIssue:
    """One transport/preflight issue that did not become canonical v1 data."""

    code: MigrationBlockerCode
    method_position: int | None = None
    method_id: str | None = None
    value: str | None = None
    recipient_position: int | None = None


@dataclass(frozen=True, slots=True)
class LegacyNodeDataPreflight:
    """Canonical v1 value plus typed issues from the transport boundary."""

    node_data: HumanInputNodeDataFull
    method_positions: tuple[int, ...]
    recipient_positions: tuple[tuple[int, ...], ...]
    issues: tuple[LegacyDeliveryParseIssue, ...]


def _disabled_method_has_material_configuration(method: DeliveryChannelConfig) -> bool:
    if isinstance(method, WebAppDeliveryMethod):
        return False
    if not isinstance(method, EmailDeliveryMethod):
        return True
    config = method.config
    return bool(
        config.recipients.items
        or config.recipients.include_bound_group
        or config.subject
        or config.body
        or config.debug_mode
    )


def _invalid_template_field(config: EmailDeliveryConfig) -> str | None:
    if not config.subject.strip():
        return "subject"
    if not config.body.strip():
        return "body"
    return None


def _validated_email_template(config: EmailDeliveryConfig) -> tuple[str, str] | None:
    if not config.subject.strip():
        return None
    if not config.body.strip():
        return None
    return config.subject, config.body


def convert_legacy_human_input_node_data(
    legacy_node_data: HumanInputNodeDataFull,
    member_emails: MemberEmailSnapshot,
) -> NodeMigrationConversion:
    """Convert one legacy node against a caller-owned immutable Email snapshot."""

    recipients: list[RecipientConfig] = []
    blockers: list[NodeMigrationBlocker] = []
    seen_emails: set[str] = set()
    has_initiator = False
    has_workspace_marker = False
    email_debug_enabled = False
    email_template: tuple[str, str] | None = None
    conflicting_template: tuple[str, int] | None = None
    for method_index, method in enumerate(legacy_node_data.delivery_methods):
        method_id = str(method.id)
        if not method.enabled:
            if _disabled_method_has_material_configuration(method):
                blockers.append(
                    NodeMigrationBlocker(
                        MigrationBlockerCode.CONFIGURED_DISABLED_METHOD,
                        method_id,
                        method.type.value,
                        method_index=method_index,
                    )
                )
            continue
        if isinstance(method, WebAppDeliveryMethod):
            if not has_initiator:
                recipients.append(Initiator())
                has_initiator = True
            continue
        if not isinstance(method, EmailDeliveryMethod):
            blockers.append(
                NodeMigrationBlocker(
                    MigrationBlockerCode.UNSUPPORTED_DELIVERY_METHOD,
                    method_id,
                    method.type.value,
                    method_index=method_index,
                )
            )
            continue
        current_template = _validated_email_template(method.config)
        if current_template is None:
            blockers.append(
                NodeMigrationBlocker(
                    MigrationBlockerCode.INVALID_EMAIL_CONFIGURATION,
                    method_id,
                    _invalid_template_field(method.config),
                    method_index=method_index,
                )
            )
        else:
            if email_template is None:
                email_template = current_template
            elif current_template != email_template and conflicting_template is None:
                conflicting_template = method_id, method_index
        email_debug_enabled = email_debug_enabled or method.config.debug_mode
        email_recipients = method.config.recipients
        for recipient_index, source in enumerate(email_recipients.items):
            if isinstance(source, ExternalRecipient):
                try:
                    normalized_email = str(NormalizedEmail(source.email))
                except ValueError:
                    blockers.append(
                        NodeMigrationBlocker(
                            MigrationBlockerCode.INVALID_EMAIL,
                            method_id,
                            source.email,
                            method_index=method_index,
                            recipient_index=recipient_index,
                        )
                    )
                    continue
            else:
                member_id = source.reference_id
                member_email = member_emails.email_for(member_id)
                if member_email is None:
                    blockers.append(
                        NodeMigrationBlocker(
                            MigrationBlockerCode.UNRESOLVED_MEMBER,
                            method_id,
                            member_id,
                            method_index=method_index,
                            recipient_index=recipient_index,
                        )
                    )
                    continue
                normalized_email = str(member_email)
            if normalized_email in seen_emails:
                continue
            recipients.append(OnetimeEmail(email=normalized_email))
            seen_emails.add(normalized_email)
        if email_recipients.include_bound_group and not has_workspace_marker:
            recipients.append(AllWorkspaceContacts())
            has_workspace_marker = True

    if conflicting_template is not None:
        conflicting_template_method_id, conflicting_template_method_index = conflicting_template
        blockers.append(
            NodeMigrationBlocker(
                MigrationBlockerCode.CONFLICTING_EMAIL_TEMPLATES,
                conflicting_template_method_id,
                method_index=conflicting_template_method_index,
            )
        )
    if not recipients:
        blockers.append(NodeMigrationBlocker(MigrationBlockerCode.MISSING_RECIPIENTS))
    if blockers:
        return NodeMigrationConversion(node_data=None, blockers=tuple(blockers))

    if email_template is None:
        # Runtime requires a Request URL even for initiator-only forms.
        subject = "Action required"
        body = (
            "A request is waiting for your review. Please review the details and submit your decision to continue. "
            "Review and respond: {{#url#}}"
        )
    else:
        subject, body = email_template

    node_data = HumanInputNodeData(
        type=HUMAN_INPUT_NODE_TYPE,
        title=legacy_node_data.title,
        desc=legacy_node_data.desc,
        error_strategy=legacy_node_data.error_strategy,
        default_value=legacy_node_data.default_value,
        retry_config=legacy_node_data.retry_config,
        recipients_spec=recipients,
        message_template=MessageTemplateConfig(subject=subject, body=body),
        debug_mode=DebugModeConfig(
            enabled=email_debug_enabled,
            channels=(DebugChannel.EMAIL,) if email_debug_enabled else (),
        ),
        form_content=legacy_node_data.form_content,
        inputs=legacy_node_data.inputs,
        user_actions=legacy_node_data.user_actions,
        timeout=legacy_node_data.timeout,
        timeout_unit=legacy_node_data.timeout_unit,
    )
    return NodeMigrationConversion(node_data=node_data, blockers=())
