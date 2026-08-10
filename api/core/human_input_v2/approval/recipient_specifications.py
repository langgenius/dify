"""Immutable recipient specifications at the workflow-to-approval boundary.

Saved node configuration intentionally retains unvalidated Email text. Runtime
validation belongs to :class:`RecipientResolver`, which can retain a typed
rejection without making workflow configuration parsing fail early.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import assert_never

from core.workflow.nodes.human_input_v2.entities import (
    AllWorkspaceContacts as WorkflowAllWorkspaceContacts,
)
from core.workflow.nodes.human_input_v2.entities import (
    Contact as WorkflowContactRecipient,
)
from core.workflow.nodes.human_input_v2.entities import (
    DynamicEmail as WorkflowDynamicEmailRecipient,
)
from core.workflow.nodes.human_input_v2.entities import (
    HumanInputNodeData,
)
from core.workflow.nodes.human_input_v2.entities import (
    Initiator as WorkflowInitiatorRecipient,
)
from core.workflow.nodes.human_input_v2.entities import (
    OnetimeEmail as WorkflowOneTimeEmailRecipient,
)


class UnsupportedRecipientSpecificationError(ValueError):
    """A saved workflow recipient cannot enter runtime resolution yet."""

    def __init__(self, recipient_type: str) -> None:
        self.recipient_type = recipient_type
        super().__init__(f"{recipient_type} runtime expansion is not implemented")


class RecipientSpecificationKind(StrEnum):
    """Stable workflow recipient discriminator."""

    CONTACT = "contact"
    DYNAMIC_EMAIL = "dynamic_email"
    ONETIME_EMAIL = "onetime_email"
    INITIATOR = "initiator"


@dataclass(frozen=True, slots=True)
class ContactRecipientSpecification:
    """Saved reference to one Contact; current availability is resolved later."""

    contact_id: str

    def to_primitive(self) -> dict[str, object]:
        return {"type": RecipientSpecificationKind.CONTACT.value, "contact_id": self.contact_id}


@dataclass(frozen=True, slots=True)
class OneTimeEmailRecipientSpecification:
    """Saved one-time Email text whose validity is decided per resolution."""

    email: str

    def to_primitive(self) -> dict[str, object]:
        return {"type": RecipientSpecificationKind.ONETIME_EMAIL.value, "email": self.email}


@dataclass(frozen=True, slots=True)
class DynamicEmailRecipientSpecification:
    """Saved workflow selector whose current value is supplied separately."""

    selector: tuple[str, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.selector, tuple):
            raise TypeError("dynamic email selector must be an immutable tuple")

    def to_primitive(self) -> dict[str, object]:
        return {"type": RecipientSpecificationKind.DYNAMIC_EMAIL.value, "selector": list(self.selector)}


@dataclass(frozen=True, slots=True)
class CurrentInitiatorRecipientSpecification:
    """Request-scoped current initiator recipient marker."""

    def to_primitive(self) -> dict[str, object]:
        return {"type": RecipientSpecificationKind.INITIATOR.value}


type RecipientSpecification = (
    ContactRecipientSpecification
    | OneTimeEmailRecipientSpecification
    | DynamicEmailRecipientSpecification
    | CurrentInitiatorRecipientSpecification
)


@dataclass(frozen=True, slots=True)
class UnsupportedDynamicRecipientValue:
    """Safe snapshot of a non-string workflow value without retaining its graph."""

    value_type: str

    def __post_init__(self) -> None:
        if not self.value_type:
            raise ValueError("unsupported dynamic recipient value type must not be blank")


@dataclass(frozen=True, slots=True)
class DynamicRecipientValue:
    """One evaluated selector value captured for a single resolution request."""

    selector: tuple[str, ...]
    value: str | UnsupportedDynamicRecipientValue

    def __post_init__(self) -> None:
        if not isinstance(self.selector, tuple):
            raise TypeError("dynamic recipient value selector must be an immutable tuple")

    @classmethod
    def from_runtime(cls, selector: tuple[str, ...], value: object) -> DynamicRecipientValue:
        """Capture a runtime value without retaining mutable unsupported data."""

        captured_value: str | UnsupportedDynamicRecipientValue
        if isinstance(value, str):
            captured_value = value
        else:
            captured_value = UnsupportedDynamicRecipientValue(type(value).__name__)
        return cls(selector=selector, value=captured_value)


class WorkflowRecipientSpecificationAdapter:
    """Convert versioned workflow node values into approval-domain inputs."""

    @staticmethod
    def from_node_data(node_data: HumanInputNodeData) -> tuple[RecipientSpecification, ...]:
        """Copy ordered v2 node recipients into immutable domain values."""

        specifications: list[RecipientSpecification] = []
        for configured_recipient in node_data.recipients_spec:
            specification: RecipientSpecification
            if isinstance(configured_recipient, WorkflowContactRecipient):
                specification = ContactRecipientSpecification(contact_id=configured_recipient.contact_id)
            elif isinstance(configured_recipient, WorkflowOneTimeEmailRecipient):
                specification = OneTimeEmailRecipientSpecification(email=configured_recipient.email)
            elif isinstance(configured_recipient, WorkflowDynamicEmailRecipient):
                specification = DynamicEmailRecipientSpecification(selector=tuple(configured_recipient.selector))
            elif isinstance(configured_recipient, WorkflowInitiatorRecipient):
                specification = CurrentInitiatorRecipientSpecification()
            elif isinstance(configured_recipient, WorkflowAllWorkspaceContacts):
                raise UnsupportedRecipientSpecificationError(configured_recipient.type)
            else:
                assert_never(configured_recipient)
            specifications.append(specification)
        return tuple(specifications)
