"""Read contract for the trigger providers installed in a workspace."""

from typing import Protocol

from core.trigger.entities.api_entities import TriggerProviderApiEntity
from models.provider_ids import TriggerProviderID


class TriggerProviderQuery(Protocol):
    def list(self, *, tenant_id: str) -> list[TriggerProviderApiEntity]: ...

    def get(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerProviderApiEntity: ...

    def get_icon(self, *, tenant_id: str, provider_id: TriggerProviderID) -> str:
        """Return the icon URL, not the icon bytes."""
        ...
