"""Serializable, explicit history carried across execution boundaries."""

from pydantic import BaseModel, ConfigDict, Field


class MessageHistory(BaseModel):
    """Resolved oldest-first history; empty IDs deliberately select a new root.

    Construction checks shape only. The application resolves ownership from
    persisted records after queue boundaries. None at the consumer means legacy
    history and differs from an empty selection.
    """

    model_config = ConfigDict(frozen=True)

    app_id: str
    conversation_id: str
    message_ids: tuple[str, ...] = Field(max_length=500)
