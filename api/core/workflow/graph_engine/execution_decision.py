from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import TypeAlias

from core.workflow.nodes.base import BaseNode


class ExecutionDecision(StrEnum):
    SUSPEND = "suspend"
    STOP = "stop"
    CONTINUE = "continue"


@dataclass(frozen=True)
class DecisionParams:
    # `next_node_instance` is the instance of the next node to run.
    next_node_instance: BaseNode


# `ExecutionDecisionHook` is a callable that takes a single argument of type `DecisionParams` and
# returns an `ExecutionDecision` indicating whether the graph engine should suspend, continue, or stop.
#
# It must not modify the data inside `DecisionParams`, including any attributes within its fields.
ExecutionDecisionHook: TypeAlias = Callable[[DecisionParams], ExecutionDecision]
