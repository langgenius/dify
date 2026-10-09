"""Human Input delivery configuration and rendering rules."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Annotated, ClassVar, Literal, override

import bleach
import markdown
from markdown.extensions.tables import TableExtension
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from enums.human_input import DeliveryMethodType, EmailRecipientType
from graphon.nodes.base.variable_template_parser import VariableTemplateParser
from graphon.runtime import VariablePool
from graphon.variables.consts import SELECTORS_LENGTH
from graphon.variables.template_resolution import convert_template


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
        return convert_template(variable_pool, templated_body).text

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

    @override
    def extract_variable_selectors(self) -> Sequence[Sequence[str]]:
        variable_template_parser = VariableTemplateParser(template=self.config.body)
        selectors: list[Sequence[str]] = []
        for variable_selector in variable_template_parser.extract_variable_selectors():
            value_selector = list(variable_selector.value_selector)
            if len(value_selector) < SELECTORS_LENGTH:
                continue
            selectors.append(value_selector[:SELECTORS_LENGTH])
        return selectors


DeliveryChannelConfig = Annotated[InteractiveSurfaceDeliveryMethod | EmailDeliveryMethod, Field(discriminator="type")]
