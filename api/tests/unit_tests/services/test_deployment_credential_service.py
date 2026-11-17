"""Provisioning preserves deployment identity and recovers from non-atomic storage/DB success."""

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Lock

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

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

    def save(self, filename: str, data: bytes) -> None:
        assert filename not in self.files
        self.files[filename] = data


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
