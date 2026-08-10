"""Recipient specification and workflow configuration boundary tests."""

from dataclasses import FrozenInstanceError

import pytest

from core.human_input_v2.approval import (
    ContactRecipientSpecification,
    CurrentInitiatorRecipientSpecification,
    DynamicEmailRecipientSpecification,
    DynamicRecipientValue,
    OneTimeEmailRecipientSpecification,
    UnsupportedDynamicRecipientValue,
    UnsupportedRecipientSpecificationError,
    WorkflowRecipientSpecificationAdapter,
)
from core.workflow.nodes.human_input_v2.entities import (
    AllWorkspaceContacts,
    Contact,
    DebugModeConfig,
    DynamicEmail,
    HumanInputNodeData,
    Initiator,
    MessageTemplateConfig,
    OnetimeEmail,
)


def _node_data() -> HumanInputNodeData:
    return HumanInputNodeData(
        title="Approval",
        recipients_spec=[
            Contact(contact_id="contact-1"),
            OnetimeEmail(email=" INVALID "),
            DynamicEmail(selector=["node-1", "email"]),
            Initiator(),
        ],
        message_template=MessageTemplateConfig(subject="Approval requested", body="Review the request"),
        debug_mode=DebugModeConfig(channels=[]),
    )


def test_workflow_node_configuration_is_explicitly_adapted_to_immutable_specifications() -> None:
    node_data = _node_data()

    specifications = WorkflowRecipientSpecificationAdapter.from_node_data(node_data)

    assert specifications == (
        ContactRecipientSpecification(contact_id="contact-1"),
        OneTimeEmailRecipientSpecification(email=" INVALID "),
        DynamicEmailRecipientSpecification(selector=("node-1", "email")),
        CurrentInitiatorRecipientSpecification(),
    )
    node_data.recipients_spec.append(OnetimeEmail(email="later@example.com"))
    assert len(specifications) == 4


def test_workflow_adapter_explicitly_rejects_unresolved_all_workspace_contacts() -> None:
    node_data = _node_data().model_copy(update={"recipients_spec": [AllWorkspaceContacts()]})

    with pytest.raises(
        UnsupportedRecipientSpecificationError,
        match="all_workspace_contacts.*runtime expansion",
    ) as raised:
        WorkflowRecipientSpecificationAdapter.from_node_data(node_data)

    assert raised.value.recipient_type == "all_workspace_contacts"


def test_specification_values_are_frozen_and_serialize_only_at_the_boundary() -> None:
    specification = OneTimeEmailRecipientSpecification(email=" USER@example.com ")

    assert specification.to_primitive() == {"type": "onetime_email", "email": " USER@example.com "}
    with pytest.raises(FrozenInstanceError):
        specification.email = "other@example.com"


def test_dynamic_runtime_values_capture_supported_and_unsupported_types_immutably() -> None:
    supported = DynamicRecipientValue.from_runtime(("node-1", "email"), "user@example.com")
    unsupported = DynamicRecipientValue.from_runtime(("node-2", "emails"), ["user@example.com"])

    assert supported == DynamicRecipientValue(selector=("node-1", "email"), value="user@example.com")
    assert unsupported == DynamicRecipientValue(
        selector=("node-2", "emails"),
        value=UnsupportedDynamicRecipientValue(value_type="list"),
    )
    with pytest.raises(FrozenInstanceError):
        unsupported.selector = ("other",)


def test_specification_and_runtime_snapshots_reject_mutable_or_invalid_shapes() -> None:
    with pytest.raises(TypeError, match="immutable tuple"):
        DynamicEmailRecipientSpecification(["node-1", "email"])
    with pytest.raises(TypeError, match="immutable tuple"):
        DynamicRecipientValue(["node-1", "email"], "user@example.com")
    with pytest.raises(ValueError, match="must not be blank"):
        UnsupportedDynamicRecipientValue("")


@pytest.mark.parametrize(
    ("specification", "primitive"),
    [
        (ContactRecipientSpecification("contact-1"), {"type": "contact", "contact_id": "contact-1"}),
        (
            DynamicEmailRecipientSpecification(("node-1", "email")),
            {"type": "dynamic_email", "selector": ["node-1", "email"]},
        ),
        (CurrentInitiatorRecipientSpecification(), {"type": "initiator"}),
    ],
)
def test_every_specification_has_a_stable_primitive_shape(specification, primitive: dict[str, object]) -> None:
    assert specification.to_primitive() == primitive
