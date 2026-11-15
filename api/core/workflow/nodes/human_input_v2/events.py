"""Dify presentation events emitted alongside graphon's pause control events."""

from pydantic import Field

from graphon.engine_events import NodeEvent, NodeRunHumanInputFormFilledEvent, NodeRunHumanInputFormTimeoutEvent

from .runtime import PreparedForm


class NodeRunHumanInputV2FormRequiredEvent(NodeEvent):
    """Carry the committed form snapshot to Dify without another database read.

    The initiator token is for the live response only. Pause persistence stores
    the form reference; reconnect resolves current persisted form state itself.
    """

    prepared_form: PreparedForm = Field(repr=False)


class NodeRunHumanInputV2FormFilledEvent(NodeRunHumanInputFormFilledEvent):
    """Keep Dify's form identity distinct from the engine's execution identity."""

    form_id: str


class NodeRunHumanInputV2FormTimeoutEvent(NodeRunHumanInputFormTimeoutEvent):
    """Identify the persisted form whose timeout completed this execution."""

    form_id: str
