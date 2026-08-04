"""Credential-free channel identity shared by control and data planes."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ChannelKind(StrEnum):
    EMAIL = "email"
    IM = "im"


class ChannelProvider(StrEnum):
    RESEND = "resend"
    FEISHU = "feishu"
    SLACK = "slack"
    DING_TALK = "ding_talk"


_EMAIL_PROVIDERS = frozenset((ChannelProvider.RESEND,))


@dataclass(frozen=True, slots=True)
class ChannelRef:
    kind: ChannelKind
    provider: ChannelProvider

    def __post_init__(self) -> None:
        if (self.provider in _EMAIL_PROVIDERS) != (self.kind is ChannelKind.EMAIL):
            raise ValueError("channel kind and provider do not match")


__all__ = ["ChannelKind", "ChannelProvider", "ChannelRef"]
