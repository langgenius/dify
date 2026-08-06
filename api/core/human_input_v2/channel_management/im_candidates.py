"""Typed provider-specific IM candidates accepted by channel management."""

from __future__ import annotations

from dataclasses import dataclass, field

from .contracts import ChannelProvider


@dataclass(frozen=True, slots=True)
class NewSecret:
    value: str = field(repr=False)

    def __post_init__(self) -> None:
        if not self.value.strip():
            raise ValueError("secret must not be blank")


@dataclass(frozen=True, slots=True)
class PreserveSlackSecret:
    """Explicit instruction to resolve one Slack secret from current state."""


def _require_non_blank(**values: str) -> None:
    for name, value in values.items():
        if not value.strip():
            raise ValueError(f"{name} must not be blank")


def _require_new_secret(**values: object) -> None:
    for name, value in values.items():
        if not isinstance(value, NewSecret):
            raise ValueError(f"{name} must be a new secret")


def _require_optional_new_secret(**values: object | None) -> None:
    for name, value in values.items():
        if value is not None and not isinstance(value, NewSecret):
            raise ValueError(f"{name} must be a new secret when provided")


def _require_slack_secret(**values: object) -> None:
    for name, value in values.items():
        if not isinstance(value, (NewSecret, PreserveSlackSecret)):
            raise ValueError(f"{name} must be a new or preserved Slack secret")


@dataclass(frozen=True, slots=True)
class FeishuIMCandidate:
    app_id: str
    app_secret: NewSecret = field(repr=False)
    verification_token: NewSecret | None = field(default=None, repr=False)
    encrypt_key: NewSecret | None = field(default=None, repr=False)
    provider: ChannelProvider = field(default=ChannelProvider.FEISHU, init=False)

    def __post_init__(self) -> None:
        _require_non_blank(app_id=self.app_id)
        _require_new_secret(app_secret=self.app_secret)
        _require_optional_new_secret(
            verification_token=self.verification_token,
            encrypt_key=self.encrypt_key,
        )


@dataclass(frozen=True, slots=True)
class SlackIMCandidate:
    client_id: str
    client_secret: NewSecret | PreserveSlackSecret = field(repr=False)
    signing_secret: NewSecret | PreserveSlackSecret = field(repr=False)
    bot_token: NewSecret | PreserveSlackSecret = field(repr=False)
    app_token: NewSecret | PreserveSlackSecret = field(repr=False)
    provider: ChannelProvider = field(default=ChannelProvider.SLACK, init=False)

    def __post_init__(self) -> None:
        _require_non_blank(client_id=self.client_id)
        _require_slack_secret(
            client_secret=self.client_secret,
            signing_secret=self.signing_secret,
            bot_token=self.bot_token,
            app_token=self.app_token,
        )


@dataclass(frozen=True, slots=True)
class DingTalkIMCandidate:
    client_id: str
    client_secret: NewSecret = field(repr=False)
    provider: ChannelProvider = field(default=ChannelProvider.DING_TALK, init=False)

    def __post_init__(self) -> None:
        _require_non_blank(client_id=self.client_id)
        _require_new_secret(client_secret=self.client_secret)


type IMCandidate = FeishuIMCandidate | SlackIMCandidate | DingTalkIMCandidate
