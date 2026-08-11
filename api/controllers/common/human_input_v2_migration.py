"""Transport compatibility and preflight parsing for HITL v1 node migration."""

from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError

from core.workflow.nodes.human_input_v2.migration import (
    LegacyDeliveryParseIssue,
    LegacyEmailDeliveryMethod,
    LegacyFormInput,
    LegacyHumanInputNodeData,
    LegacyNodeDataPreflight,
    LegacyTimeoutUnit,
    LegacyUserAction,
    LegacyWebAppDeliveryMethod,
    MigrationBlockerCode,
)
from graphon.entities.base_node_data import DefaultValue, RetryConfig
from graphon.enums import ErrorStrategy


class LegacyHITLv1NodeData(BaseModel):
    """HTTP compatibility DTO; raw delivery JSON stops at preflight."""

    model_config = ConfigDict(extra="ignore")

    title: str = ""
    desc: str | None = None
    version: Literal["1"] = "1"
    error_strategy: ErrorStrategy | None = None
    default_value: list[DefaultValue] | None = None
    retry_config: RetryConfig = Field(default_factory=RetryConfig)
    delivery_methods: list[JsonValue] = Field(default_factory=list)
    form_content: str = ""
    inputs: list[LegacyFormInput] = Field(default_factory=list)
    user_actions: list[LegacyUserAction] = Field(default_factory=list)
    timeout: int = 36
    timeout_unit: LegacyTimeoutUnit = LegacyTimeoutUnit.HOUR


class _TransportDeliveryMethod(BaseModel):
    """Permissive envelope used only to classify compatibility input."""

    model_config = ConfigDict(extra="allow")

    __pydantic_extra__: dict[str, JsonValue] = Field(init=False)  # pyrefly: ignore[bad-override-mutable-attribute]

    id: str | None = None
    type: str
    enabled: bool = True
    config: JsonValue = Field(default_factory=dict)


def _json_value_is_material(value: JsonValue) -> bool:
    if value is None or value is False or value == "":
        return False
    if isinstance(value, list | dict):
        return bool(value)
    return True


def _disabled_method_is_configured(method: _TransportDeliveryMethod) -> bool:
    return _json_value_is_material(method.config) or any(
        _json_value_is_material(value) for value in (method.__pydantic_extra__ or {}).values()
    )


def _normalize_email_compatibility_aliases(method: _TransportDeliveryMethod) -> dict[str, JsonValue]:
    method_value = method.model_dump(mode="python")
    config = method_value.get("config")
    if not isinstance(config, Mapping):
        return method_value

    normalized_config = dict(config)
    recipients = normalized_config.get("recipients")
    if not isinstance(recipients, Mapping):
        method_value["config"] = normalized_config
        return method_value

    normalized_recipients = dict(recipients)
    compatibility_whole_workspace = normalized_recipients.pop("include_bound_group", None)
    if "whole_workspace" not in normalized_recipients and compatibility_whole_workspace is not None:
        normalized_recipients["whole_workspace"] = compatibility_whole_workspace

    items = normalized_recipients.get("items")
    if isinstance(items, list):
        normalized_items: list[JsonValue] = []
        for recipient in items:
            if not isinstance(recipient, Mapping):
                normalized_items.append(recipient)
                continue
            normalized_recipient = dict(recipient)
            compatibility_member_id = normalized_recipient.pop("reference_id", None)
            if (
                normalized_recipient.get("type") == "member"
                and "user_id" not in normalized_recipient
                and compatibility_member_id is not None
            ):
                normalized_recipient["user_id"] = compatibility_member_id
            normalized_items.append(normalized_recipient)
        normalized_recipients["items"] = normalized_items

    normalized_config["recipients"] = normalized_recipients
    method_value["config"] = normalized_config
    return method_value


def _email_configuration_error_field(method: _TransportDeliveryMethod) -> str:
    config = method.config
    if not isinstance(config, Mapping) or not isinstance(config.get("recipients"), Mapping):
        return "recipients"
    if not isinstance(config.get("subject"), str):
        return "subject"
    if not isinstance(config.get("body"), str):
        return "body"
    return "recipients"


def _parse_method(
    raw_method: JsonValue,
    method_position: int,
) -> tuple[
    LegacyEmailDeliveryMethod | LegacyWebAppDeliveryMethod | None,
    tuple[LegacyDeliveryParseIssue, ...],
]:
    try:
        transport_method = _TransportDeliveryMethod.model_validate(raw_method)
    except ValidationError:
        return (
            None,
            (
                LegacyDeliveryParseIssue(
                    code=MigrationBlockerCode.UNSUPPORTED_DELIVERY_METHOD,
                    method_position=method_position,
                ),
            ),
        )

    if not transport_method.enabled and _disabled_method_is_configured(transport_method):
        return (
            None,
            (
                LegacyDeliveryParseIssue(
                    code=MigrationBlockerCode.CONFIGURED_DISABLED_METHOD,
                    method_position=method_position,
                    method_id=transport_method.id,
                    value=transport_method.type,
                ),
            ),
        )
    if transport_method.type not in {"email", "webapp"}:
        if not transport_method.enabled:
            return None, ()
        return (
            None,
            (
                LegacyDeliveryParseIssue(
                    code=MigrationBlockerCode.UNSUPPORTED_DELIVERY_METHOD,
                    method_position=method_position,
                    method_id=transport_method.id,
                    value=transport_method.type,
                ),
            ),
        )

    if transport_method.type == "webapp":
        try:
            return LegacyWebAppDeliveryMethod.model_validate(transport_method.model_dump(mode="python")), ()
        except ValidationError:
            return (
                None,
                (
                    LegacyDeliveryParseIssue(
                        code=MigrationBlockerCode.UNSUPPORTED_DELIVERY_METHOD,
                        method_position=method_position,
                        method_id=transport_method.id,
                        value=transport_method.type,
                    ),
                ),
            )

    method_value = _normalize_email_compatibility_aliases(transport_method)
    config = method_value.get("config")
    if not isinstance(config, Mapping):
        return (
            None,
            (
                LegacyDeliveryParseIssue(
                    code=MigrationBlockerCode.INVALID_EMAIL_CONFIGURATION,
                    method_position=method_position,
                    method_id=transport_method.id,
                    value="recipients",
                ),
            ),
        )
    recipients = config.get("recipients")
    if not isinstance(recipients, Mapping):
        return (
            None,
            (
                LegacyDeliveryParseIssue(
                    code=MigrationBlockerCode.INVALID_EMAIL_CONFIGURATION,
                    method_position=method_position,
                    method_id=transport_method.id,
                    value="recipients",
                ),
            ),
        )
    raw_items = recipients.get("items", [])
    if not isinstance(raw_items, list):
        return (
            None,
            (
                LegacyDeliveryParseIssue(
                    code=MigrationBlockerCode.INVALID_EMAIL_CONFIGURATION,
                    method_position=method_position,
                    method_id=transport_method.id,
                    value="recipients",
                ),
            ),
        )

    valid_items: list[JsonValue] = []
    issues: list[LegacyDeliveryParseIssue] = []
    for raw_recipient in raw_items:
        if not isinstance(raw_recipient, Mapping):
            issues.append(
                LegacyDeliveryParseIssue(
                    code=MigrationBlockerCode.INVALID_EMAIL_CONFIGURATION,
                    method_position=method_position,
                    method_id=transport_method.id,
                    value="recipients",
                )
            )
            continue
        recipient_type = raw_recipient.get("type")
        if recipient_type == "external":
            if not isinstance(raw_recipient.get("email"), str):
                issues.append(
                    LegacyDeliveryParseIssue(
                        code=MigrationBlockerCode.INVALID_EMAIL,
                        method_position=method_position,
                        method_id=transport_method.id,
                    )
                )
                continue
        elif recipient_type == "member":
            if not isinstance(raw_recipient.get("user_id"), str):
                issues.append(
                    LegacyDeliveryParseIssue(
                        code=MigrationBlockerCode.UNRESOLVED_MEMBER,
                        method_position=method_position,
                        method_id=transport_method.id,
                    )
                )
                continue
        else:
            issues.append(
                LegacyDeliveryParseIssue(
                    code=MigrationBlockerCode.INVALID_EMAIL_CONFIGURATION,
                    method_position=method_position,
                    method_id=transport_method.id,
                    value="recipients",
                )
            )
            continue
        valid_items.append(dict(raw_recipient))

    normalized_method_value = {
        **method_value,
        "config": {
            **config,
            "recipients": {
                **recipients,
                "items": valid_items,
            },
        },
    }
    try:
        return LegacyEmailDeliveryMethod.model_validate(normalized_method_value), tuple(issues)
    except ValidationError:
        issues.append(
            LegacyDeliveryParseIssue(
                code=MigrationBlockerCode.INVALID_EMAIL_CONFIGURATION,
                method_position=method_position,
                method_id=transport_method.id,
                value=_email_configuration_error_field(transport_method),
            )
        )
        return None, tuple(issues)


def preflight_legacy_human_input_node_data(
    transport_node_data: LegacyHITLv1NodeData,
) -> LegacyNodeDataPreflight:
    """Normalize transport aliases and classify non-canonical delivery input."""

    delivery_methods: list[LegacyEmailDeliveryMethod | LegacyWebAppDeliveryMethod] = []
    method_positions: list[int] = []
    issues: list[LegacyDeliveryParseIssue] = []
    for method_position, raw_method in enumerate(transport_node_data.delivery_methods):
        method, method_issues = _parse_method(raw_method, method_position)
        if method is not None:
            delivery_methods.append(method)
            method_positions.append(method_position)
        issues.extend(method_issues)

    canonical_node_data = LegacyHumanInputNodeData(
        title=transport_node_data.title,
        desc=transport_node_data.desc,
        version=transport_node_data.version,
        error_strategy=transport_node_data.error_strategy,
        default_value=transport_node_data.default_value,
        retry_config=transport_node_data.retry_config,
        delivery_methods=delivery_methods,
        form_content=transport_node_data.form_content,
        inputs=transport_node_data.inputs,
        user_actions=transport_node_data.user_actions,
        timeout=transport_node_data.timeout,
        timeout_unit=transport_node_data.timeout_unit,
    )
    return LegacyNodeDataPreflight(
        node_data=canonical_node_data,
        method_positions=tuple(method_positions),
        issues=tuple(issues),
    )
