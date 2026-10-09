"""Dify presentation events emitted alongside graphon's pause control events."""

from pydantic import Field

from graphon.graph_events import GraphNodeEventBase

from .runtime import PreparedForm


class NodeRunHumanInputV2FormRequiredEvent(GraphNodeEventBase):
    """Carry the committed form snapshot to Dify without another database read.

    The initiator token is for the live response only. Pause persistence stores
    the form reference; reconnect resolves current persisted form state itself.
    """

    prepared_form: PreparedForm = Field(repr=False)
