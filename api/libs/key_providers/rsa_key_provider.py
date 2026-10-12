from typing import override

from Crypto.PublicKey import RSA

from libs import rsa
from libs.key_providers.base import BaseKeyProvider


class RSAKeyProvider(BaseKeyProvider):
    """
    Default key provider: per-tenant RSA key pair.

    The private key is kept in the configured STORAGE_TYPE backend (see libs/rsa.py).
    This provider only composes the existing libs.rsa implementation; the underlying
    crypto logic is intentionally left untouched.
    """

    @override
    def generate_key_pair(self, tenant_id: str) -> str:
        return rsa.generate_key_pair(tenant_id)

    @override
    def encrypt(self, tenant_id: str, text: str) -> bytes:
        return rsa.encrypt(text, self._public_key(tenant_id))

    @staticmethod
    def _public_key(tenant_id: str) -> str:
        """The tenant's public key, read without leaving a SQL transaction open.

        A caller whose request-scoped session already holds state (an open
        transaction, e.g. a tenant it created and has not committed) is read
        through that session, which stays exactly as the caller left it.
        Otherwise the key is read and detached in the provider's own short
        session, closed before encryption, so the scoped session is never
        left open across the caller's later external work.
        """
        from sqlalchemy import select
        from sqlalchemy.orm import scoped_session

        from core.db.session_factory import session_factory
        from models.account import Tenant
        from models.engine import db

        # The current request-scoped Session (a registry lookup, never a new transaction).
        scoped = db.session() if isinstance(db.session, scoped_session) else db.session
        if scoped.in_transaction():
            tenant = scoped.get(Tenant, tenant_id)
            found, public_key = tenant is not None, tenant.encrypt_public_key if tenant is not None else None
        else:
            with session_factory.create_session() as session:
                row = session.execute(select(Tenant.encrypt_public_key).where(Tenant.id == tenant_id)).first()
            found, public_key = row is not None, row[0] if row is not None else None
        if not found:
            raise ValueError(f"Tenant with id {tenant_id} not found")
        if public_key is None:
            raise ValueError(f"Tenant with id {tenant_id} has no encrypt_public_key")
        return public_key

    @override
    def get_decrypt_decoding(self, tenant_id: str) -> tuple[RSA.RsaKey, object]:
        return rsa.get_decrypt_decoding(tenant_id)

    @override
    def decrypt_with_decoding(self, encrypted_text: bytes, decoding: tuple[RSA.RsaKey, object]) -> str:
        rsa_key, cipher_rsa = decoding
        return rsa.decrypt_token_with_decoding(encrypted_text, rsa_key, cipher_rsa)

    @override
    def decrypt(self, tenant_id: str, encrypted_text: bytes) -> str:
        # Overrides BaseKeyProvider's generic get_decrypt_decoding()+decrypt_with_decoding()
        # composition to call libs.rsa.decrypt() directly (a single-shot equivalent), matching
        # this provider's one supported decrypt path in libs/rsa.py.
        return rsa.decrypt(encrypted_text, tenant_id)
