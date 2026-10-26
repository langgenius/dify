"""Caller identities shared by message operations, independent of invocation origin."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class MessageAccount:
    account_id: str


@dataclass(frozen=True, slots=True)
class MessageEndUser:
    end_user_id: str


type MessageActor = MessageAccount | MessageEndUser
