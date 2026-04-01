"""Workflow-layer adapters for legacy human-input payload keys.

Stored workflow graphs and editor payloads may still use Dify-specific human
input recipient keys. Normalize them here before handing configs to
`graphon` so graph-owned models only see graph-neutral field names.
"""

from __future__ import annotations

import enum
import uuid
from collections.abc import Mapping, Sequence
from typing import Annotated, Any, ClassVar, Literal

import bleach
import markdown
from graphon.enums import BuiltinNodeTypes
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from graphon.runtime import VariablePool
from graphon.variables.consts import SELECTORS_LENGTH
from markdown.extensions.tables import TableExtension
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, TypeAdapter


class DeliveryMethodType(enum.StrEnum):
    WEBAPP = enum.auto()
    EMAIL = enum.auto()


class EmailRecipientType(enum.StrEnum):
    BOUND = "member"
    MEMBER = BOUND
    EXTERNAL = "external"


class _InteractiveSurfaceDeliveryConfig(BaseModel):
    pass


class BoundRecipient(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal[EmailRecipientType.BOUND] = EmailRecipientType.BOUND
    reference_id: str


class ExternalRecipient(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal[EmailRecipientType.EXTERNAL] = EmailRecipientType.EXTERNAL
    email: str


MemberRecipient = BoundRecipient
EmailRecipient = Annotated[BoundRecipient | ExternalRecipient, Field(discriminator="type")]


class EmailRecipients(BaseModel):
    model_config = ConfigDict(extra="forbid")

    include_bound_group: bool = Field(
        default=False,
        validation_alias=AliasChoices("include_bound_group", "whole_workspace"),
    )
    items: list[EmailRecipient] = Field(default_factory=list)


class EmailDeliveryConfig(BaseModel):
    URL_PLACEHOLDER: ClassVar[str] = "{{#url#}}"
    _ALLOWED_HTML_TAGS: ClassVar[list[str]] = [
        "a",
        "br",
        "code",
        "em",
        "li",
        "ol",
        "p",
        "pre",
        "strong",
        "table",
        "tbody",
        "td",
        "th",
        "thead",
        "tr",
        "ul",
    ]
    _ALLOWED_HTML_ATTRIBUTES: ClassVar[dict[str, list[str]]] = {
        "a": ["href", "title"],
        "td": ["align"],
        "th": ["align"],
    }
    _ALLOWED_PROTOCOLS: ClassVar[set[str]] = set(bleach.sanitizer.ALLOWED_PROTOCOLS) | {"mailto"}

    recipients: EmailRecipients
    subject: str
    body: str
    debug_mode: bool = False

    def with_recipients(self, recipients: EmailRecipients) -> EmailDeliveryConfig:
        return self.model_copy(update={"recipients": recipients})

    @classmethod
    def replace_url_placeholder(cls, body: str, url: str | None) -> str:
        return body.replace(cls.URL_PLACEHOLDER, url or "")

    @classmethod
    def render_body_template(
        cls,
        *,
        body: str,
        url: str | None,
        variable_pool: VariablePool | None = None,
    ) -> str:
        templated_body = cls.replace_url_placeholder(body, url)
        if variable_pool is None:
            return templated_body
        return variable_pool.convert_template(templated_body).text

    @classmethod
    def render_markdown_body(cls, body: str) -> str:
        stripped_body = bleach.clean(body, tags=[], attributes={}, strip=True)
        rendered = markdown.markdown(
            stripped_body,
            extensions=[TableExtension(use_align_attribute=True)],
            output_format="html",
        )
        return bleach.clean(
            rendered,
            tags=cls._ALLOWED_HTML_TAGS,
            attributes=cls._ALLOWED_HTML_ATTRIBUTES,
            protocols=cls._ALLOWED_PROTOCOLS,
            strip=True,
        )

    @staticmethod
    def sanitize_subject(subject: str) -> str:
        sanitized = subject.replace("\r", " ").replace("\n", " ")
        sanitized = bleach.clean(sanitized, tags=[], strip=True)
        return " ".join(sanitized.split())


class _DeliveryMethodBase(BaseModel):
    enabled: bool = True
    id: uuid.UUID = Field(default_factory=uuid.uuid4)

    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        return ()


class InteractiveSurfaceDeliveryMethod(_DeliveryMethodBase):
    type: Literal[DeliveryMethodType.WEBAPP] = DeliveryMethodType.WEBAPP
    config: _InteractiveSurfaceDeliveryConfig = Field(default_factory=_InteractiveSurfaceDeliveryConfig)


class EmailDeliveryMethod(_DeliveryMethodBase):
    type: Literal[DeliveryMethodType.EMAIL] = DeliveryMethodType.EMAIL
    config: EmailDeliveryConfig

    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        variable_template_parser = VariableTemplateParser(template=self.config.body)
        selectors: list[Sequence[str]] = []
        for variable_selector in variable_template_parser.extract_variable_selectors():
            value_selector = list(variable_selector.value_selector)
            if len(value_selector) < SELECTORS_LENGTH:
                continue
            selectors.append(value_selector[:SELECTORS_LENGTH])
        return selectors


WebAppDeliveryMethod = InteractiveSurfaceDeliveryMethod
_WebAppDeliveryConfig = _InteractiveSurfaceDeliveryConfig

DeliveryChannelConfig = Annotated[InteractiveSurfaceDeliveryMethod | EmailDeliveryMethod, Field(discriminator="type")]

_DELIVERY_METHODS_ADAPTER = TypeAdapter(list[DeliveryChannelConfig])


def _copy_mapping(value: object) -> dict[str, Any] | None:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="python")
    if isinstance(value, Mapping):
        return dict(value)
    return None


def normalize_human_input_node_data_for_graph(node_data: Mapping[str, Any] | BaseModel) -> dict[str, Any]:
    normalized = _copy_mapping(node_data)
    if normalized is None:
        raise TypeError(f"human-input node data must be a mapping, got {type(node_data).__name__}")

    delivery_methods = normalized.get("delivery_methods")
    if not isinstance(delivery_methods, list):
        return normalized

    normalized_methods: list[Any] = []
    for method in delivery_methods:
        method_mapping = _copy_mapping(method)
        if method_mapping is None:
            normalized_methods.append(method)
            continue

        config_mapping = _copy_mapping(method_mapping.get("config"))
        if config_mapping is not None:
            recipients_mapping = _copy_mapping(config_mapping.get("recipients"))
            if recipients_mapping is not None:
                config_mapping["recipients"] = _normalize_email_recipients(recipients_mapping)
            method_mapping["config"] = config_mapping

        normalized_methods.append(method_mapping)

    normalized["delivery_methods"] = normalized_methods
    return normalized


def parse_human_input_delivery_methods(node_data: Mapping[str, Any] | BaseModel) -> list[DeliveryChannelConfig]:
    normalized = normalize_human_input_node_data_for_graph(node_data)
    raw_delivery_methods = normalized.get("delivery_methods")
    if not isinstance(raw_delivery_methods, list):
        return []
    return list(_DELIVERY_METHODS_ADAPTER.validate_python(raw_delivery_methods))


def is_human_input_webapp_enabled(node_data: Mapping[str, Any] | BaseModel) -> bool:
    for method in parse_human_input_delivery_methods(node_data):
        if method.enabled and method.type == DeliveryMethodType.WEBAPP:
            return True
    return False


def normalize_node_data_for_graph(node_data: Mapping[str, Any] | BaseModel) -> dict[str, Any]:
    normalized = _copy_mapping(node_data)
    if normalized is None:
        raise TypeError(f"node data must be a mapping, got {type(node_data).__name__}")

    if normalized.get("type") != BuiltinNodeTypes.HUMAN_INPUT:
        return normalized
    return normalize_human_input_node_data_for_graph(normalized)


def normalize_node_config_for_graph(node_config: Mapping[str, Any] | BaseModel) -> dict[str, Any]:
    normalized = _copy_mapping(node_config)
    if normalized is None:
        raise TypeError(f"node config must be a mapping, got {type(node_config).__name__}")

    data_mapping = _copy_mapping(normalized.get("data"))
    if data_mapping is None:
        return normalized

    normalized["data"] = normalize_node_data_for_graph(data_mapping)
    return normalized


def _normalize_email_recipients(recipients: Mapping[str, Any]) -> dict[str, Any]:
    normalized = dict(recipients)

    legacy_include_bound_group = normalized.pop("whole_workspace", None)
    if "include_bound_group" not in normalized and legacy_include_bound_group is not None:
        normalized["include_bound_group"] = legacy_include_bound_group

    items = normalized.get("items")
    if not isinstance(items, list):
        return normalized

    normalized_items: list[Any] = []
    for item in items:
        item_mapping = _copy_mapping(item)
        if item_mapping is None:
            normalized_items.append(item)
            continue

        legacy_reference_id = item_mapping.pop("user_id", None)
        if "reference_id" not in item_mapping and legacy_reference_id is not None:
            item_mapping["reference_id"] = legacy_reference_id
        normalized_items.append(item_mapping)

    normalized["items"] = normalized_items
    return normalized


__all__ = [
    "BoundRecipient",
    "DeliveryChannelConfig",
    "DeliveryMethodType",
    "EmailDeliveryConfig",
    "EmailDeliveryMethod",
    "EmailRecipientType",
    "EmailRecipients",
    "ExternalRecipient",
    "MemberRecipient",
    "WebAppDeliveryMethod",
    "_WebAppDeliveryConfig",
    "is_human_input_webapp_enabled",
    "normalize_human_input_node_data_for_graph",
    "normalize_node_config_for_graph",
    "normalize_node_data_for_graph",
    "parse_human_input_delivery_methods",
]
