"""Errors reported by the ``decision`` node."""

from graphon.entities.exc import BaseNodeError


class DecisionNodeError(BaseNodeError):
    """The node cannot run as configured; the message names the offending outcome."""


class DecisionNodeDisabledError(ValueError):
    """The deployment switch ``ENABLE_DECISION_NODE`` is off, so no decision node may be built.

    A ``ValueError`` because the node factory reports every unbuildable node
    configuration that way.
    """

    def __init__(self) -> None:
        super().__init__(
            "The Decision node is not enabled on this server. Set ENABLE_DECISION_NODE=true to run workflows "
            "that contain it."
        )
