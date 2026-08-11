"""Explicit aggregate-load snapshot spanning IM persistence records."""

from dataclasses import dataclass

from .integration import IMIntegration
from .records import IMBinding, IMIdentity
from .sync_records import IMSyncRun, SyncResultFact


@dataclass(frozen=True, slots=True)
class IMIntegrationState:
    """Eagerly loaded Integration with mapped current and historical children."""

    integration: IMIntegration
    identities: tuple[IMIdentity, ...]
    bindings: tuple[IMBinding, ...]
    sync_runs: tuple[IMSyncRun, ...]
    sync_results: tuple[SyncResultFact, ...]
