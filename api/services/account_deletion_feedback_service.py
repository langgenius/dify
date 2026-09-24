"""Application service for submitting account deletion feedback."""

from typing import Protocol


class AccountDeletionFeedbackGateway(Protocol):
    def submit(self, *, email: str, feedback: str) -> None: ...


class AccountDeletionFeedbackService:
    def __init__(self, *, feedback: AccountDeletionFeedbackGateway) -> None:
        self._feedback = feedback

    def submit(self, *, email: str, feedback: str) -> None:
        self._feedback.submit(email=email, feedback=feedback)
