"""Thin graphon DTO adapter for Dify-owned Human Input callbacks."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from graphon.nodes.human_input.entities import Completed, Expired, PauseRequested
from graphon.variables.segments import Segment


@dataclass(frozen=True, slots=True)
class PauseRequestedDecision:
    session_id: str


@dataclass(frozen=True, slots=True)
class CompletedDecision:
    selected_handle: str
    inputs: Mapping[str, Segment]
    outputs: Mapping[str, Segment]


@dataclass(frozen=True, slots=True)
class ExpiredDecision:
    selected_handle: str
    outputs: Mapping[str, Segment]


type HumanInputDecision = PauseRequestedDecision | CompletedDecision | ExpiredDecision


def to_graphon_hitl_decision(decision: HumanInputDecision) -> PauseRequested | Completed | Expired:
    if isinstance(decision, PauseRequestedDecision):
        return PauseRequested(session_id=decision.session_id)
    if isinstance(decision, CompletedDecision):
        return Completed(
            selected_handle=decision.selected_handle,
            inputs=decision.inputs,
            outputs=decision.outputs,
        )
    return Expired(
        selected_handle=decision.selected_handle,
        outputs=decision.outputs,
    )
