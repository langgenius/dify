"""Application query boundary for owned conversation variables."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from graphon.variables import VariableBase
from machinery.context import RequestContext
from services.entities.conversation_entities import EndUserConversationRef

# The Console endpoint exposes only the first page, including its legacy
# total/has_more fields. Changing pagination is a separate API change.
CONVERSATION_VARIABLE_LIMIT = 100


@dataclass(frozen=True, slots=True)
class ConversationVariableRecord:
    id: str
    variable: VariableBase
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ConversationVariablePage:
    limit: int
    has_more: bool
    data: tuple[ConversationVariableRecord, ...]


class ConversationVariableAppNotFoundError(Exception):
    """The app is unavailable to this workspace or has an unsupported mode."""


class ConversationVariableQuery(Protocol):
    def require_app(self, context: RequestContext, app_id: str) -> None:
        """Check app access before the controller validates query parameters."""
        ...

    def list_variables(
        self, context: RequestContext, app_id: str, conversation_id: str
    ) -> Sequence[ConversationVariableRecord]:
        """Read the bounded result under the same workspace and app scope."""
        ...

    def get_page(
        self,
        *,
        ref: EndUserConversationRef,
        last_id: str | None,
        limit: int,
        variable_name: str | None,
    ) -> ConversationVariablePage:
        """Read an end user's variables; None omits the cursor or name filter."""
        ...
