"""Pure legacy Human Input node-data conversion.

This module owns only deterministic value conversion. Database access,
workspace scoping, Contact state, and transport response mapping belong to the
application and adapter layers.
"""

from __future__ import annotations

import enum
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, JsonValue, field_validator

from core.human_input_v2.shared.values import NormalizedEmail
from core.workflow.nodes.human_input.entities import HumanInputNodeData as LegacySharedHumanInputNodeData

from .entities import (
    HUMAN_INPUT_NODE_TYPE,
    AllWorkspaceContacts,
    Channel,
    DebugModeConfig,
    HumanInputNodeData,
    Initiator,
    MessageTemplateConfig,
    OnetimeEmail,
    RecipientConfig,
)


class LegacyEmailRecipientSource(BaseModel):
    """One migration-visible legacy Email recipient source."""

    model_config = ConfigDict(extra="ignore")

    type: Literal["external", "member"]
    email: JsonValue | None = None
    reference_id: JsonValue | None = Field(
        default=None,
        validation_alias=AliasChoices("reference_id", "user_id"),
    )


class _LegacyJsonExtraModel(BaseModel):
    """Compatibility boundary that rejects non-JSON extension values."""

    model_config = ConfigDict(extra="allow")

    # Pydantic uses this override as its documented typed-extra validation hook.
    __pydantic_extra__: dict[str, JsonValue] = Field(  # pyrefly: ignore[bad-override-mutable-attribute]
        init=False
    )


class LegacyEmailRecipients(_LegacyJsonExtraModel):
    whole_workspace: bool = Field(
        default=False,
        validation_alias=AliasChoices("whole_workspace", "include_bound_group"),
    )
    items: list[LegacyEmailRecipientSource] = Field(default_factory=list)


class LegacyDeliveryConfig(_LegacyJsonExtraModel):
    recipients: LegacyEmailRecipients | JsonValue = Field(
        default_factory=LegacyEmailRecipients,
        union_mode="left_to_right",
    )
    subject: JsonValue | None = None
    body: JsonValue | None = None
    debug_mode: bool = False


class LegacyDeliveryMethod(_LegacyJsonExtraModel):
    id: str | None = None
    type: str
    enabled: bool = True
    config: LegacyDeliveryConfig = Field(default_factory=LegacyDeliveryConfig)


class LegacyHumanInputNodeData(LegacySharedHumanInputNodeData):
    """Typed legacy value accepted by the migration-only boundary."""

    model_config = ConfigDict(extra="ignore")

    version: str = "1"
    delivery_methods: list[LegacyDeliveryMethod] = Field(default_factory=list)

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: str) -> str:
        if value != "1":
            raise ValueError('version must be "1"')
        return value


@dataclass(frozen=True, slots=True)
class NodeMigrationBlocker:
    code: MigrationBlockerCode
    method_id: str | None = None
    value: str | None = None


@dataclass(frozen=True, slots=True)
class NodeMigrationConversion:
    node_data: HumanInputNodeData | None
    blockers: tuple[NodeMigrationBlocker, ...]


class MigrationBlockerCode(enum.StrEnum):
    CONFIGURED_DISABLED_METHOD = "configured-disabled-method"
    UNSUPPORTED_DELIVERY_METHOD = "unsupported-delivery-method"
    INVALID_EMAIL_CONFIGURATION = "invalid-email-configuration"
    INVALID_EMAIL = "invalid-email"
    UNRESOLVED_MEMBER = "unresolved-member"
    CONFLICTING_EMAIL_TEMPLATES = "conflicting-email-templates"
    MISSING_RECIPIENTS = "missing-recipients"


def _disabled_method_has_material_configuration(method: LegacyDeliveryMethod) -> bool:
    config = method.config
    return bool(
        _recipients_have_material_configuration(config.recipients)
        or config.subject not in (None, "")
        or config.body not in (None, "")
        or config.debug_mode
        or _extra_values_have_material_configuration(config.__pydantic_extra__)
        or _extra_values_have_material_configuration(method.__pydantic_extra__)
    )


def _json_value_is_material(value: JsonValue) -> bool:
    if value is None or value is False or value == "":
        return False
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def _extra_values_have_material_configuration(extra_values: dict[str, JsonValue] | None) -> bool:
    return extra_values is not None and any(_json_value_is_material(value) for value in extra_values.values())


def _recipients_have_material_configuration(recipients: LegacyEmailRecipients | JsonValue) -> bool:
    if isinstance(recipients, LegacyEmailRecipients):
        return bool(
            recipients.items
            or recipients.whole_workspace
            or _extra_values_have_material_configuration(recipients.__pydantic_extra__)
        )
    return _json_value_is_material(recipients)


def _invalid_template_field(config: LegacyDeliveryConfig) -> str | None:
    if not isinstance(config.recipients, LegacyEmailRecipients):
        return "recipients"
    if not isinstance(config.subject, str) or not config.subject.strip():
        return "subject"
    if not isinstance(config.body, str) or not config.body.strip():
        return "body"
    return None


def _validated_email_template(config: LegacyDeliveryConfig) -> tuple[str, str] | None:
    if not isinstance(config.recipients, LegacyEmailRecipients):
        return None
    if not isinstance(config.subject, str) or not config.subject.strip():
        return None
    if not isinstance(config.body, str) or not config.body.strip():
        return None
    return config.subject, config.body


def convert_legacy_human_input_node_data(
    legacy_node_data: LegacyHumanInputNodeData,
    member_emails: Mapping[str, str],
) -> NodeMigrationConversion:
    """Convert one legacy node against a caller-owned immutable Email snapshot."""

    recipients: list[RecipientConfig] = []
    blockers: list[NodeMigrationBlocker] = []
    seen_emails: set[str] = set()
    has_initiator = False
    has_workspace_marker = False
    email_debug_enabled = False
    email_template: tuple[str, str] | None = None
    conflicting_template_method_id: str | None = None
    subject = ""
    body = ""
    for method in legacy_node_data.delivery_methods:
        if not method.enabled:
            if _disabled_method_has_material_configuration(method):
                blockers.append(
                    NodeMigrationBlocker(
                        MigrationBlockerCode.CONFIGURED_DISABLED_METHOD,
                        method.id,
                        method.type,
                    )
                )
            continue
        if method.type == "webapp":
            if not has_initiator:
                recipients.append(Initiator())
                has_initiator = True
            continue
        if method.type != "email":
            blockers.append(
                NodeMigrationBlocker(
                    MigrationBlockerCode.UNSUPPORTED_DELIVERY_METHOD,
                    method.id,
                    method.type,
                )
            )
            continue
        current_template = _validated_email_template(method.config)
        if current_template is None:
            blockers.append(
                NodeMigrationBlocker(
                    MigrationBlockerCode.INVALID_EMAIL_CONFIGURATION,
                    method.id,
                    _invalid_template_field(method.config),
                )
            )
        else:
            if email_template is None:
                subject, body = current_template
                email_template = current_template
            elif current_template != email_template and conflicting_template_method_id is None:
                conflicting_template_method_id = method.id
        email_debug_enabled = email_debug_enabled or method.config.debug_mode
        email_recipients = method.config.recipients
        if not isinstance(email_recipients, LegacyEmailRecipients):
            continue
        for source in email_recipients.items:
            if source.type == "external":
                if not isinstance(source.email, str):
                    blockers.append(NodeMigrationBlocker(MigrationBlockerCode.INVALID_EMAIL, method.id))
                    continue
                try:
                    normalized_email = str(NormalizedEmail(source.email))
                except ValueError:
                    blockers.append(NodeMigrationBlocker(MigrationBlockerCode.INVALID_EMAIL, method.id, source.email))
                    continue
            else:
                member_id = source.reference_id if isinstance(source.reference_id, str) else None
                member_email = member_emails.get(member_id) if member_id is not None else None
                try:
                    normalized_email = str(NormalizedEmail(member_email)) if member_email is not None else None
                except ValueError:
                    normalized_email = None
                if normalized_email is None:
                    blockers.append(NodeMigrationBlocker(MigrationBlockerCode.UNRESOLVED_MEMBER, method.id, member_id))
                    continue
            if normalized_email is None:
                continue
            if normalized_email in seen_emails:
                continue
            recipients.append(OnetimeEmail(email=normalized_email))
            seen_emails.add(normalized_email)
        if email_recipients.whole_workspace and not has_workspace_marker:
            recipients.append(AllWorkspaceContacts())
            has_workspace_marker = True

    if conflicting_template_method_id is not None:
        blockers.append(
            NodeMigrationBlocker(
                MigrationBlockerCode.CONFLICTING_EMAIL_TEMPLATES,
                conflicting_template_method_id,
            )
        )
    if not recipients:
        blockers.append(NodeMigrationBlocker(MigrationBlockerCode.MISSING_RECIPIENTS))
    if blockers:
        return NodeMigrationConversion(node_data=None, blockers=tuple(blockers))

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
            channels=(Channel.EMAIL,) if email_debug_enabled else (),
        ),
        form_content=legacy_node_data.form_content,
        inputs=legacy_node_data.inputs,
        user_actions=legacy_node_data.user_actions,
        timeout=legacy_node_data.timeout,
        timeout_unit=legacy_node_data.timeout_unit,
    )
    return NodeMigrationConversion(node_data=node_data, blockers=())
