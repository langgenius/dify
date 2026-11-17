"""Deployment key lifecycle: remote I/O never holds a database transaction open."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Protocol

from sqlalchemy.orm import Session, sessionmaker

from libs.credential_cipher import BoundCredentialCipher, CredentialKeyUnavailableError
from repositories.deployment_credential_repository import DeploymentCredentialKey, DeploymentCredentialRepository


class DeploymentKeyBackend(Protocol):
    def provision(self, instance_id: str, reference: str | None) -> str: ...
    def bind(self, instance_id: str, reference: str) -> BoundCredentialCipher: ...


class DeploymentKeyLease(Protocol):
    def ensure_owned(self) -> None: ...


type DeploymentKeyLock = Callable[[str], AbstractContextManager[DeploymentKeyLease]]


class DeploymentCredentialService:
    def __init__(self, sessions: sessionmaker[Session], backend: DeploymentKeyBackend, lock: DeploymentKeyLock) -> None:
        self._sessions = sessions
        self._backend = backend
        self._lock = lock

    def provision(self) -> str:
        """Require stable setup; serialize, recover/create and persist the same key on retry.

        Failure leaves the identity and any externally created material available
        for explicit retry; no runtime operation calls this method.
        """
        identity = self._read()
        with self._lock(identity.instance_id) as lease:
            current = self._read()
            if current.instance_id != identity.instance_id:
                raise CredentialKeyUnavailableError("Deployment identity changed")
            lease.ensure_owned()
            reference = self._backend.provision(current.instance_id, current.reference)
            lease.ensure_owned()
            with self._sessions() as session, session.begin():
                DeploymentCredentialRepository(session).save_reference(current.instance_id, reference)
            return reference

    def build_cipher(self) -> BoundCredentialCipher:
        """Require existing key reference/material; return bound capability without writes or provisioning."""
        current = self._read()
        if current.reference is None:
            raise CredentialKeyUnavailableError("Deployment credential key is not initialized")
        return self._backend.bind(current.instance_id, current.reference)

    def _read(self) -> DeploymentCredentialKey:
        with self._sessions() as session:
            return DeploymentCredentialRepository(session).get()
