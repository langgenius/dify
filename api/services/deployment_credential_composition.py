"""Configure deployment key backends and renewable initialization serialization."""

import logging
from collections.abc import Generator
from contextlib import contextmanager
from threading import Event, Thread

from azure.identity import DefaultAzureCredential
from azure.keyvault.keys import KeyClient
from redis.exceptions import LockError, RedisError
from redis.lock import Lock
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from extensions.ext_storage import storage
from libs.credential_cipher import BoundCredentialCipher, CredentialKeyUnavailableError
from libs.key_providers.deployment_azure import AzureDeploymentKeyBackend
from libs.key_providers.deployment_local import LocalDeploymentKeyBackend
from services.deployment_credential_service import DeploymentCredentialService, DeploymentKeyBackend, DeploymentKeyLease

logger = logging.getLogger(__name__)
_LEASE_SECONDS = 120
_RENEW_SECONDS = 30


class _Lease:
    def __init__(self, lock: Lock, lost: Event) -> None:
        self._lock = lock
        self._lost = lost

    def ensure_owned(self) -> None:
        if self._lost.is_set():
            raise CredentialKeyUnavailableError("Deployment credential initialization lease was lost")
        try:
            self._lock.reacquire()
        except (LockError, RedisError):
            self._lost.set()
            raise CredentialKeyUnavailableError("Deployment credential initialization lease was lost") from None


@contextmanager
def _initialization_lock(instance_id: str) -> Generator[DeploymentKeyLease]:
    lock = redis_client.lock(
        f"deployment-credentials:initialize:{instance_id}",
        timeout=_LEASE_SECONDS,
        blocking_timeout=_LEASE_SECONDS,
        thread_local=False,
    )
    try:
        acquired = lock.acquire()
    except RedisError:
        raise CredentialKeyUnavailableError("Deployment credential initialization is unavailable") from None
    if not acquired:
        raise CredentialKeyUnavailableError("Deployment credential initialization is busy")
    stopped, lost = Event(), Event()
    lease = _Lease(lock, lost)

    def renew() -> None:
        while not stopped.wait(_RENEW_SECONDS):
            try:
                lease.ensure_owned()
            except CredentialKeyUnavailableError:
                logger.warning("Lost deployment credential lease, instance_id=%s", instance_id)
                return

    heartbeat = Thread(target=renew, daemon=True, name="DeploymentCredentialLease")
    heartbeat.start()
    try:
        yield lease
    finally:
        stopped.set()
        heartbeat.join(timeout=2)
        try:
            lock.release()
        except (LockError, RedisError):
            logger.warning("Could not release deployment credential lease, instance_id=%s", instance_id)


def build_deployment_credential_service(
    *,
    session_maker: sessionmaker[Session] | None = None,
) -> DeploymentCredentialService:
    """Construct edition-neutral lifecycle service; construction itself performs no key I/O."""
    backend: DeploymentKeyBackend
    if dify_config.KEY_PROVIDER_TYPE == "local":
        backend = LocalDeploymentKeyBackend(storage)
    elif dify_config.KEY_PROVIDER_TYPE == "azure-keyvault" and dify_config.AZURE_KEYVAULT_VAULT_URL:
        backend = AzureDeploymentKeyBackend(
            KeyClient(vault_url=dify_config.AZURE_KEYVAULT_VAULT_URL, credential=DefaultAzureCredential()),
            key_size=dify_config.AZURE_KEYVAULT_KEY_SIZE,
            rotation_days=dify_config.AZURE_KEYVAULT_ROTATION_INTERVAL_DAYS,
        )
    else:
        raise CredentialKeyUnavailableError("Deployment credential backend is unavailable")
    return DeploymentCredentialService(
        session_maker or sessionmaker(bind=db.engine, expire_on_commit=False), backend, _initialization_lock
    )


def build_deployment_credential_cipher(
    *,
    session_maker: sessionmaker[Session] | None = None,
) -> BoundCredentialCipher:
    """Require provisioned setup; build a read-only bound cipher for this process's operation."""
    return build_deployment_credential_service(session_maker=session_maker).build_cipher()
