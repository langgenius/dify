"""Discriminated management commands routed by the common facade."""

from dataclasses import dataclass

from core.human_input_v2.email_channel import ResendCandidate

from .contracts import ChannelRef
from .im_candidates import IMCandidate


@dataclass(frozen=True, slots=True)
class GetChannelCommand:
    ref: ChannelRef


@dataclass(frozen=True, slots=True)
class SaveEmailChannelCommand:
    ref: ChannelRef
    candidate: ResendCandidate


@dataclass(frozen=True, slots=True)
class TestEmailChannelCommand:
    ref: ChannelRef
    candidate: ResendCandidate


@dataclass(frozen=True, slots=True)
class SaveIMChannelCommand:
    ref: ChannelRef
    candidate: IMCandidate
    expected_integration_id: str | None = None
    expected_config_version: int | None = None

    def __post_init__(self) -> None:
        if (self.expected_integration_id is None) != (self.expected_config_version is None):
            raise ValueError("complete IM revision token is required")


@dataclass(frozen=True, slots=True)
class TestIMChannelCommand:
    ref: ChannelRef
    candidate: IMCandidate


@dataclass(frozen=True, slots=True)
class DeleteChannelCommand:
    ref: ChannelRef
    expected_integration_id: str | None = None
    expected_config_version: int | None = None

    def __post_init__(self) -> None:
        if (self.expected_integration_id is None) != (self.expected_config_version is None):
            raise ValueError("complete IM revision token is required")


type SaveChannelCommand = SaveEmailChannelCommand | SaveIMChannelCommand
type TestChannelCommand = TestEmailChannelCommand | TestIMChannelCommand
