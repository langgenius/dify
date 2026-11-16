"""Read contract for the trigger providers installed in a workspace."""

from typing import Protocol

from models.provider_ids import TriggerProviderID
from services.trigger.api_entities import TriggerProviderApiEntity


class TriggerProviderQuery(Protocol):
    def list(self, *, tenant_id: str) -> list[TriggerProviderApiEntity]: ...

    def get(self, *, tenant_id: str, provider_id: TriggerProviderID) -> TriggerProviderApiEntity: ...

    def get_icon(self, *, tenant_id: str, provider_id: TriggerProviderID) -> str:
        """Return the icon URL, not the icon bytes."""
        ...
