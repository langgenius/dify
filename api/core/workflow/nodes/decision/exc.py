"""Errors reported by the ``decision`` node."""

from graphon.entities.exc import BaseNodeError


class DecisionNodeError(BaseNodeError):
    """The node cannot run as configured; the message names the offending outcome."""
