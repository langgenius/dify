"""Tenant public-key reads for credential-encryption provider composition."""

from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Tenant


class TenantPublicKeyRepository:
    def __init__(self, *, create_session: Callable[[], Session], current_session: Callable[[], Session]) -> None:
        self._create_session = create_session
        self._current_session = current_session

    def read(self, tenant_id: str) -> str:
        """Reuse caller state, otherwise close a short read before encryption.

        The current request's active transaction may contain a newly provisioned
        tenant or an uncommitted public key. It remains owned by the caller.
        Without that state, retain only the public-key value from a fresh read.
        """
        scoped = self._current_session()
        if scoped.in_transaction():
            tenant = scoped.get(Tenant, tenant_id)
            found, public_key = tenant is not None, tenant.encrypt_public_key if tenant is not None else None
        else:
            with self._create_session() as session:
                row = session.execute(select(Tenant.encrypt_public_key).where(Tenant.id == tenant_id)).first()
            found, public_key = row is not None, row[0] if row is not None else None
        if not found:
            raise ValueError(f"Tenant with id {tenant_id} not found")
        if public_key is None:
            raise ValueError(f"Tenant with id {tenant_id} has no encrypt_public_key")
        return public_key
