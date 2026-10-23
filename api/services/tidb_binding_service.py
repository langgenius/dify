"""Resolve tenant-owned TiDB clusters for both datasets and KnowledgeFS.

Claim an existing idle cluster before provisioning. Persist a reservation before
the cloud request, so retries and concurrent requests cannot create a second
cluster. SQL transactions never span a cloud request. An ambiguous create result
keeps its reservation for reconciliation instead of issuing another paid create.
"""

import uuid

from redis.exceptions import LockError
from sqlalchemy import literal, or_, select
from sqlalchemy.orm import Session

from configs import dify_config
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Tenant
from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus


class TidbBindingUnavailableError(Exception):
    """Safe error message; never include cloud responses or credentials."""


class TidbBindingPendingError(TidbBindingUnavailableError):
    """The same cluster is being initialized; retry without provisioning again."""


def _load_binding(tenant_id: str) -> TidbAuthBinding | None:
    with Session(db.engine) as session:
        return session.scalars(select(TidbAuthBinding).where(TidbAuthBinding.tenant_id == tenant_id)).one_or_none()


def _require_cloud_config() -> None:
    if (
        not all(
            (
                dify_config.TIDB_PROJECT_ID,
                dify_config.TIDB_API_URL,
                dify_config.TIDB_PUBLIC_KEY,
                dify_config.TIDB_PRIVATE_KEY,
                dify_config.TIDB_REGION,
            )
        )
        or dify_config.TIDB_SPEND_LIMIT is None
        or dify_config.TIDB_SPEND_LIMIT < 0
    ):
        raise TidbBindingUnavailableError("TiDB cluster provisioning is not configured")


def _claim_or_reserve(tenant_id: str) -> tuple[TidbAuthBinding, bool]:
    with Session(db.engine, expire_on_commit=False) as session, session.begin():
        # Recheck after acquiring the same lock used by both vector entry points.
        binding = session.scalars(select(TidbAuthBinding).where(TidbAuthBinding.tenant_id == tenant_id)).one_or_none()
        if binding is not None:
            return binding, False
        if session.get(Tenant, tenant_id) is None:
            raise TidbBindingUnavailableError("Dify workspace does not exist")
        endpoint_available = or_(
            TidbAuthBinding.qdrant_endpoint.is_not(None) & (TidbAuthBinding.qdrant_endpoint != ""),
            literal(bool(dify_config.TIDB_ON_QDRANT_URL)),
        )
        binding = session.scalar(
            select(TidbAuthBinding)
            .where(
                TidbAuthBinding.tenant_id.is_(None),
                TidbAuthBinding.active.is_(False),
                TidbAuthBinding.status == TidbAuthBindingStatus.ACTIVE,
                TidbAuthBinding.account != "",
                TidbAuthBinding.password != "",
                endpoint_available,
            )
            .order_by(TidbAuthBinding.created_at, TidbAuthBinding.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if binding is not None:
            binding.tenant_id = tenant_id
            binding.active = True
            return binding, False
        _require_cloud_config()
        binding = TidbAuthBinding(
            tenant_id=tenant_id,
            cluster_id="",
            cluster_name=uuid.uuid4().hex[:16],
            account="",
            password=uuid.uuid4().hex[:16],
            active=True,
            status=TidbAuthBindingStatus.CREATING,
        )
        session.add(binding)
        return binding, True


def _start_cluster(binding: TidbAuthBinding) -> None:
    from dify_vdb_tidb_on_qdrant.tidb_service import TidbService

    try:
        cluster_id = TidbService.start_tidb_serverless_cluster(
            project_id=dify_config.TIDB_PROJECT_ID or "",
            api_url=dify_config.TIDB_API_URL or "",
            public_key=dify_config.TIDB_PUBLIC_KEY or "",
            private_key=dify_config.TIDB_PRIVATE_KEY or "",
            region=dify_config.TIDB_REGION or "",
            display_name=binding.cluster_name,
            password=binding.password,
        )
        with Session(db.engine) as session, session.begin():
            saved = session.scalar(
                select(TidbAuthBinding)
                .where(TidbAuthBinding.id == binding.id, TidbAuthBinding.tenant_id == binding.tenant_id)
                .with_for_update()
            )
            if saved is None or not saved.active or saved.cluster_id:
                raise TidbBindingUnavailableError("TiDB cluster reservation changed during provisioning")
            saved.cluster_id = cluster_id
        binding.cluster_id = cluster_id
    except Exception:
        # Keep the tenant and generated name/password even if the cloud response
        # or SQL acknowledgement was lost. Never reissue this create on retry.
        with Session(db.engine) as session, session.begin():
            saved = session.scalar(
                select(TidbAuthBinding)
                .where(TidbAuthBinding.id == binding.id, TidbAuthBinding.tenant_id == binding.tenant_id)
                .with_for_update()
            )
            if saved is not None and not saved.cluster_id:
                saved.status = TidbAuthBindingStatus.FAILED
        raise TidbBindingUnavailableError("TiDB cluster creation needs administrator reconciliation") from None


def _ready_or_refresh(binding: TidbAuthBinding) -> TidbAuthBinding:
    if not binding.active:
        raise TidbBindingUnavailableError("Dify workspace vector backend binding is inactive")
    if binding.status == TidbAuthBindingStatus.FAILED:
        raise TidbBindingUnavailableError("TiDB cluster creation needs administrator reconciliation")
    if binding.status == TidbAuthBindingStatus.ACTIVE:
        if (
            not (binding.qdrant_endpoint or dify_config.TIDB_ON_QDRANT_URL)
            or not binding.account
            or not binding.password
        ):
            raise TidbBindingUnavailableError("Dify workspace vector backend binding is incomplete")
        return binding
    if not binding.cluster_id:
        raise TidbBindingPendingError("Dify workspace vector backend is being provisioned")
    _require_cloud_config()
    from dify_vdb_tidb_on_qdrant.tidb_service import TidbService

    try:
        cluster = TidbService.get_tidb_serverless_cluster(
            dify_config.TIDB_API_URL or "",
            dify_config.TIDB_PUBLIC_KEY or "",
            dify_config.TIDB_PRIVATE_KEY or "",
            binding.cluster_id,
        )
    except Exception:
        raise TidbBindingPendingError("TiDB cluster readiness could not yet be confirmed") from None
    if not isinstance(cluster, dict):
        raise TidbBindingPendingError("TiDB cluster readiness response is incomplete")
    endpoint = TidbService.extract_qdrant_endpoint(cluster)
    prefix = cluster.get("userPrefix")
    if cluster.get("state") != "ACTIVE" or not isinstance(prefix, str) or not prefix or not endpoint:
        raise TidbBindingPendingError("Dify workspace vector backend is being provisioned")
    with Session(db.engine, expire_on_commit=False) as session, session.begin():
        saved = session.scalar(
            select(TidbAuthBinding)
            .where(
                TidbAuthBinding.id == binding.id,
                TidbAuthBinding.tenant_id == binding.tenant_id,
                TidbAuthBinding.cluster_id == binding.cluster_id,
            )
            .with_for_update()
        )
        if saved is None or not saved.active:
            raise TidbBindingUnavailableError("TiDB cluster binding changed during provisioning")
        saved.account = f"{prefix}.root"
        saved.qdrant_endpoint = endpoint
        saved.status = TidbAuthBindingStatus.ACTIVE
        return saved


def resolve_tidb_auth_binding(tenant_id: str, *, allow_create: bool) -> TidbAuthBinding:
    """Read a binding; allocation requires the caller's explicit allow_create."""
    binding = _load_binding(tenant_id)
    if binding is not None:
        return _ready_or_refresh(binding)
    if not allow_create:
        raise TidbBindingUnavailableError("Dify workspace has no active vector backend binding")
    try:
        # Cloud create is one bounded request; readiness polling happens outside
        # this lock. Durable reservations outlive the lease or caller disconnect.
        with redis_client.lock("create_tidb_serverless_cluster_lock", timeout=90, blocking_timeout=5):
            binding, created = _claim_or_reserve(tenant_id)
            if created:
                _start_cluster(binding)
    except LockError:
        raise TidbBindingPendingError("Dify workspace vector backend allocation is in progress") from None
    if created:
        raise TidbBindingPendingError("Dify workspace vector backend is being provisioned")
    return _ready_or_refresh(binding)
