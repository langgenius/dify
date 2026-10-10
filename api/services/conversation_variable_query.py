"""Application query boundary for Console conversation variables."""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from graphon.variables import VariableBase
from machinery.context import RequestContext

# The Console endpoint exposes only the first page, including its legacy
# total/has_more fields. Changing pagination is a separate API change.
CONVERSATION_VARIABLE_LIMIT = 100


@dataclass(frozen=True, slots=True)
class ConversationVariableRecord:
    id: str
    variable: VariableBase
    created_at: datetime
    updated_at: datetime


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
