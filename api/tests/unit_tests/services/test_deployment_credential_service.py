"""Provisioning preserves deployment identity and recovers from non-atomic storage/DB success."""

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import Event, Lock
from typing import override

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.opendal_storage import OpenDALStorage
from libs.credential_cipher import CredentialKeyUnavailableError
from libs.key_providers.deployment_local import LocalDeploymentKeyBackend
from models.model import DifySetup
from services.deployment_credential_service import DeploymentCredentialService, DeploymentKeyLease


class _Storage:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    def load_once(self, filename: str) -> bytes:
        if filename not in self.files:
            raise FileNotFoundError
        return self.files[filename]

    def save_if_absent(self, filename: str, data: bytes) -> bool:
        if filename in self.files:
            return False
        self.files[filename] = data
        return True


class _Lease:
    def ensure_owned(self) -> None:
        pass


@pytest.fixture
def credential_service(sqlite_session_factory: sessionmaker[Session]):
    storage = _Storage()
    mutex = Lock()

    @contextmanager
    def lock(_instance_id: str) -> Generator[DeploymentKeyLease]:
        with mutex:
            yield _Lease()

    service = DeploymentCredentialService(sqlite_session_factory, LocalDeploymentKeyBackend(storage), lock)
    with sqlite_session_factory.begin() as session:
        session.add(DifySetup(version="test", instance_id="00000000-0000-0000-0000-000000000001"))
    return service, storage


def test_runtime_before_initialization_does_not_create_material(credential_service) -> None:
    service, storage = credential_service
    with pytest.raises(CredentialKeyUnavailableError):
        service.build_cipher()
    assert storage.files == {}


def test_concurrent_provisioning_keeps_one_key(credential_service) -> None:
    service, storage = credential_service
    with ThreadPoolExecutor(max_workers=4) as executor:
        references = list(executor.map(lambda _: service.provision(), range(8)))
    assert len(set(references)) == 1
    assert len(storage.files) == 1
    cipher = service.build_cipher()
    assert service.build_cipher().decrypt(cipher.encrypt("test credential")) == "test credential"
    assert service.provision() == references[0]


def test_recovery_after_database_commit_failure(credential_service, sqlite_session_factory) -> None:
    service, storage = credential_service

    def fail_commit(_session: Session) -> None:
        raise ConnectionError("commit unavailable")

    event.listen(sqlite_session_factory, "before_commit", fail_commit)
    try:
        with pytest.raises(ConnectionError):
            service.provision()
    finally:
        event.remove(sqlite_session_factory, "before_commit", fail_commit)
    assert len(storage.files) == 1
    snapshot = dict(storage.files)
    with sqlite_session_factory() as session:
        assert session.scalar(select(DifySetup.credential_encryption_key_ref)) is None
    service.provision()
    assert storage.files == snapshot


def test_missing_identity_fails_without_key_write(credential_service, sqlite_session_factory) -> None:
    service, storage = credential_service
    with sqlite_session_factory.begin() as session:
        setup = session.scalar(select(DifySetup))
        assert setup is not None
        setup.instance_id = None
    with pytest.raises(CredentialKeyUnavailableError):
        service.provision()
    assert storage.files == {}


def test_expired_initializer_cannot_overwrite_the_successful_initializers_key(
    sqlite_session_factory: sessionmaker[Session],
    tmp_path: Path,
) -> None:
    """A suspended storage write must not destroy material committed by a later lease holder."""
    writing, resume, expired = Event(), Event(), Event()

    class SuspendedStorage(OpenDALStorage):
        def __init__(self) -> None:
            super().__init__("fs", root=str(tmp_path))
            self.suspend = True

        def wait_for_successor(self) -> None:
            if self.suspend:
                self.suspend = False
                writing.set()
                assert resume.wait(10)

        @override
        def save(self, filename: str, data: bytes) -> None:
            self.wait_for_successor()
            super().save(filename, data)

        @override
        def save_if_absent(self, filename: str, data: bytes) -> bool:
            self.wait_for_successor()
            return super().save_if_absent(filename, data)

    class ExpiringLease:
        def ensure_owned(self) -> None:
            if expired.is_set():
                raise CredentialKeyUnavailableError("Initialization lease expired")

    @contextmanager
    def stale_lock(_instance_id: str) -> Generator[DeploymentKeyLease]:
        yield ExpiringLease()

    @contextmanager
    def current_lock(_instance_id: str) -> Generator[DeploymentKeyLease]:
        yield _Lease()

    with sqlite_session_factory.begin() as session:
        session.add(DifySetup(version="test", instance_id="00000000-0000-0000-0000-000000000001"))
    backend = LocalDeploymentKeyBackend(SuspendedStorage())
    stale = DeploymentCredentialService(sqlite_session_factory, backend, stale_lock)
    current = DeploymentCredentialService(sqlite_session_factory, backend, current_lock)
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = executor.submit(stale.provision)
        try:
            assert writing.wait(10)
            expired.set()
            reference = current.provision()
            ciphertext = current.build_cipher().encrypt("persisted credential")
        finally:
            resume.set()
        with pytest.raises(CredentialKeyUnavailableError, match="lease expired"):
            pending.result(timeout=10)
    assert current.provision() == reference
    assert current.build_cipher().decrypt(ciphertext) == "persisted credential"
