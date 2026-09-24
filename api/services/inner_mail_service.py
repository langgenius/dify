"""Application service for mail received through the inner API."""

from typing import Protocol

from services.entities.mail_entities import InnerMailMessage


class InnerMailDispatcher(Protocol):
    def __call__(self, message: InnerMailMessage) -> None: ...


class InnerMailService:
    def __init__(self, *, dispatch: InnerMailDispatcher) -> None:
        self._dispatch = dispatch

    def send(self, message: InnerMailMessage) -> None:
        self._dispatch(message)
