"""Immutable original actor for Chatbot operations that may outlive a migration."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class WebChatActor:
    """Carry admitted Web identity without consulting a mutable conversation owner."""

    tenant_id: str
    app_id: str
    end_user_id: str
