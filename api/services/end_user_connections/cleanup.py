"""Remove deleted Apps' saved choices without changing personal credentials or consent."""

from typing import Protocol


class ConnectionCleanupStore(Protocol):
    def delete_app_selections_batch(self, *, tenant_id: str, app_id: str, batch_size: int) -> int:
        """Delete at most batch_size rows of each selection kind in one transaction.

        The caller supplies a committed-deleted App's trusted tenant and ID, and
        batch_size must be positive. Scope every read and write by both IDs.
        Lock selected rows in stable order until commit. Preserve credentials,
        consent, and other Apps' selections. Return the deleted row count;
        propagate failures after rolling back this batch so retries remain safe.
        """
        ...


class ConnectionCleanupService:
    def __init__(self, *, store: ConnectionCleanupStore) -> None:
        self._store = store

    def delete_app_connections(self, *, tenant_id: str, app_id: str) -> int:
        """Remove a committed-deleted App's choices in bounded, retryable batches.

        The caller provides trusted tenant/App IDs from App deletion. Return the
        total removed choices without deleting credentials or consent. Failures
        propagate; committed batches stay removed and redelivery is idempotent.
        """
        total_deleted = 0
        deleted = self._store.delete_app_selections_batch(tenant_id=tenant_id, app_id=app_id, batch_size=1000)
        while deleted:
            total_deleted += deleted
            deleted = self._store.delete_app_selections_batch(tenant_id=tenant_id, app_id=app_id, batch_size=1000)
        return total_deleted
