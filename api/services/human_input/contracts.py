"""Application-only contracts for testing Human Input delivery."""

from dataclasses import dataclass, field
from enum import StrEnum

from graphon.runtime import VariablePool


class DeliveryTestStatus(StrEnum):
    OK = "ok"
    FAILED = "failed"


@dataclass(frozen=True)
class DeliveryTestEmailRecipient:
    email: str
    form_token: str


@dataclass(frozen=True)
class DeliveryTestContext:
    tenant_id: str
    app_id: str
    node_id: str
    node_title: str | None
    rendered_content: str
    template_vars: dict[str, str] = field(default_factory=dict)
    recipients: list[DeliveryTestEmailRecipient] = field(default_factory=list)
    variable_pool: VariablePool | None = None


@dataclass(frozen=True)
class DeliveryTestResult:
    status: DeliveryTestStatus
    delivered_to: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class DeliveryTestError(Exception):
    pass


class DeliveryTestUnsupportedError(DeliveryTestError):
    pass
