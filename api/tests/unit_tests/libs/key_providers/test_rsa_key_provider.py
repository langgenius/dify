"""SQL lifetime of the default RSA key provider's tenant public-key read, on real SQLite rows.

``models.engine.db.session`` is replaced by a real ``scoped_session`` over the unit SQLite engine
(the unit app does not initialize Flask-SQLAlchemy), and the global session factory already points
at that engine. Encryption is real RSA/AES; the matching private key decrypts the result. An engine
event witness counts connection-level transactions, so a read the provider leaves open is visible.
"""

from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from Crypto.PublicKey import RSA
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, scoped_session, sessionmaker

import models.engine
from libs import gmpy2_pkcs10aep_cipher
from libs.key_providers.rsa_key_provider import RSAKeyProvider
from models.account import Tenant

_PRIVATE_KEY = RSA.generate(2048)
_PUBLIC_PEM = _PRIVATE_KEY.publickey().export_key().decode()


class TxWitness:
    """Connection-level transactions currently open on the engine."""

    def __init__(self, engine: Engine) -> None:
        self.open = 0
        self._engine = engine
        event.listen(engine, "begin", self._begin)
        event.listen(engine, "commit", self._end)
        event.listen(engine, "rollback", self._end)

    def _begin(self, _conn: object) -> None:
        self.open += 1

    def _end(self, _conn: object) -> None:
        self.open = max(0, self.open - 1)

    def close(self) -> None:
        event.remove(self._engine, "begin", self._begin)
        event.remove(self._engine, "commit", self._end)
        event.remove(self._engine, "rollback", self._end)


@pytest.fixture
def scoped(
    sqlite_engine: Engine, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[scoped_session[Session]]:
    """The request-scoped session the provider sees as ``db.session``."""
    registry = scoped_session(sqlite_session_factory)
    monkeypatch.setattr(models.engine, "db", SimpleNamespace(session=registry, engine=sqlite_engine))
    try:
        yield registry
    finally:
        registry.remove()


@pytest.fixture
def witness(sqlite_engine: Engine) -> Iterator[TxWitness]:
    observed = TxWitness(sqlite_engine)
    try:
        yield observed
    finally:
        observed.close()


def _tenant(sqlite_session_factory: sessionmaker[Session], public_key: str | None = _PUBLIC_PEM) -> str:
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Key tenant", encrypt_public_key=public_key)
        session.add(tenant)
        session.flush()
        return tenant.id


def _decrypt(ciphertext: bytes) -> str:
    return RSAKeyProvider().decrypt_with_decoding(ciphertext, (_PRIVATE_KEY, gmpy2_pkcs10aep_cipher.new(_PRIVATE_KEY)))


def test_encrypt_reads_the_public_key_without_leaving_sql_open(
    scoped: scoped_session[Session], witness: TxWitness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    tenant_id = _tenant(sqlite_session_factory)
    assert not scoped().in_transaction()
    assert witness.open == 0

    ciphertext = RSAKeyProvider().encrypt(tenant_id, "refreshed-secret")

    # No scoped or connection transaction survives into the caller's later external work.
    assert not scoped().in_transaction()
    assert witness.open == 0
    assert _decrypt(ciphertext) == "refreshed-secret"


def test_encrypt_inside_a_caller_transaction_uses_and_keeps_it(
    scoped: scoped_session[Session], witness: TxWitness
) -> None:
    # A caller that created the tenant and has not committed yet (as tenant setup does).
    tenant = Tenant(name="Uncommitted tenant", encrypt_public_key=_PUBLIC_PEM)
    scoped.add(tenant)
    scoped.flush()
    assert scoped().in_transaction()

    ciphertext = RSAKeyProvider().encrypt(tenant.id, "value")

    assert _decrypt(ciphertext) == "value"
    # The caller's own transaction is neither committed, rolled back nor closed by the provider.
    assert scoped().in_transaction()
    assert witness.open == 1
    scoped.rollback()
    assert witness.open == 0


def test_encrypt_sees_a_pending_unflushed_tenant_of_the_caller(scoped: scoped_session[Session]) -> None:
    tenant = Tenant(name="Pending tenant", encrypt_public_key=_PUBLIC_PEM)
    # ``add`` begins the caller's session transaction; nothing is flushed yet.
    scoped.add(tenant)

    assert _decrypt(RSAKeyProvider().encrypt(tenant.id, "pending")) == "pending"
    scoped.rollback()


def test_missing_tenant_or_key_refuses_without_leaving_sql_open(
    scoped: scoped_session[Session], witness: TxWitness, sqlite_session_factory: sessionmaker[Session]
) -> None:
    keyless = _tenant(sqlite_session_factory, public_key=None)
    with pytest.raises(ValueError, match="has no encrypt_public_key"):
        RSAKeyProvider().encrypt(keyless, "value")
    with pytest.raises(ValueError, match="not found"):
        RSAKeyProvider().encrypt("00000000-0000-0000-0000-000000000000", "value")
    assert not scoped().in_transaction()
    assert witness.open == 0
