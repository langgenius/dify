import json
import threading
import uuid
from collections.abc import Callable, Generator, Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TypedDict, Unpack
from unittest.mock import MagicMock, patch

import httpx
import pytest
from dify_vdb_tidb_on_qdrant.tidb_service import TidbService
from redis.exceptions import LockError
from sqlalchemy import select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from core.rag.embedding.embedding_base import Embeddings
from models.account import Tenant
from models.dataset import Dataset, TidbAuthBinding
from models.enums import TidbAuthBindingStatus
from services import tidb_binding_service as service
from tests.helpers.unit.knowledge_fs_core_fakes import RecordingCallable


@dataclass(frozen=True)
class _Db:
    engine: Engine


@dataclass(frozen=True)
class _Redis:
    lock: RecordingCallable


@dataclass(frozen=True)
class _Environment:
    engine: Engine
    tenants: list[Tenant]
    redis: _Redis
    create: MagicMock
    get: MagicMock
    find: MagicMock


class _CredentialFields(TypedDict, total=False):
    account: str
    password: str
    qdrant_endpoint: str | None


class _BindingFields(_CredentialFields, total=False):
    active: bool
    status: TidbAuthBindingStatus
    cluster_id: str
    creation_error_status: int | None


class _UnusedEmbeddings(Embeddings):
    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError

    def embed_multimodal_documents(self, multimodel_documents: list[dict[str, object]]) -> list[list[float]]:
        raise NotImplementedError

    def embed_query(self, text: str) -> list[float]:
        raise NotImplementedError

    def embed_multimodal_query(self, multimodel_document: dict[str, object]) -> list[float]:
        raise NotImplementedError


@pytest.fixture
def environment(
    sqlite_engine: Engine, monkeypatch: pytest.MonkeyPatch, config_overrides: Callable[..., None]
) -> Generator[_Environment]:
    monkeypatch.setattr(service, "db", _Db(engine=sqlite_engine))
    lock = threading.Lock()

    @contextmanager
    def acquire(*_args: object, **kwargs: object) -> Generator[None]:
        acquired = lock.acquire(blocking=kwargs.get("blocking_timeout") != 0)
        if not acquired:
            raise LockError("busy")
        try:
            yield
        finally:
            lock.release()

    redis = _Redis(lock=RecordingCallable(side_effect=acquire))
    monkeypatch.setattr(service, "redis_client", redis)
    config_overrides(
        TIDB_PROJECT_ID="project",
        TIDB_API_URL="https://tidb.test",
        TIDB_PUBLIC_KEY="public",
        TIDB_PRIVATE_KEY="private",
        TIDB_REGION="region",
        TIDB_SPEND_LIMIT=10,
        TIDB_ON_QDRANT_URL=None,
    )
    with Session(sqlite_engine, expire_on_commit=False) as session, session.begin():
        tenants = [Tenant(name="one"), Tenant(name="two")]
        session.add_all(tenants)
    with (
        patch.object(TidbService, "start_tidb_serverless_cluster", return_value="new-cluster") as create,
        patch.object(TidbService, "find_tidb_serverless_cluster", return_value=None) as find,
        patch.object(
            TidbService,
            "get_tidb_serverless_cluster",
            return_value={
                "state": "ACTIVE",
                "userPrefix": "tenant-prefix",
                "endpoints": {"public": {"host": "tenant.tidb.test"}},
            },
        ) as get,
    ):
        yield _Environment(engine=sqlite_engine, tenants=tenants, redis=redis, create=create, get=get, find=find)


def add_binding(env: _Environment, *, tenant: str | None = None, **changes: Unpack[_BindingFields]) -> TidbAuthBinding:
    with Session(env.engine, expire_on_commit=False) as session, session.begin():
        binding = TidbAuthBinding(
            tenant_id=tenant,
            cluster_id=changes.get("cluster_id", uuid.uuid4().hex),
            cluster_name="cluster",
            account=changes.get("account", "account"),
            password=changes.get("password", "password"),
            qdrant_endpoint=changes.get("qdrant_endpoint", "https://qdrant.tenant.test"),
            active=changes.get("active", False),
            status=changes.get("status", TidbAuthBindingStatus.ACTIVE),
        )
        if "creation_error_status" in changes:
            binding.creation_error_status = changes["creation_error_status"]
        session.add(binding)
    return binding


def bindings(env: _Environment) -> Sequence[TidbAuthBinding]:
    with Session(env.engine) as session:
        return session.scalars(select(TidbAuthBinding)).all()


def test_existing_binding_routes_to_its_tenant_without_allocation(environment: _Environment) -> None:
    env = environment
    other = add_binding(env, tenant=env.tenants[1].id, active=True)
    own = add_binding(env, tenant=env.tenants[0].id, active=True)
    result = service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert result.id == own.id != other.id
    env.redis.lock.assert_not_called()
    env.create.assert_not_called()
    env.get.assert_not_called()


def test_read_without_binding_never_allocates(environment: _Environment) -> None:
    with pytest.raises(service.TidbBindingUnavailableError, match="no active"):
        service.resolve_tidb_auth_binding(environment.tenants[0].id, allow_create=False)
    environment.create.assert_not_called()
    environment.redis.lock.assert_not_called()
    assert bindings(environment) == []


def test_idle_claim_is_persisted_without_cloud_credentials(
    environment: _Environment, config_overrides: Callable[..., None]
) -> None:
    env = environment
    idle = add_binding(env)
    config_overrides(TIDB_PUBLIC_KEY=None, TIDB_PRIVATE_KEY=None)
    result = service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert result.id == idle.id
    assert result.active
    assert result.tenant_id == env.tenants[0].id
    assert bindings(env)[0].tenant_id == env.tenants[0].id
    env.create.assert_not_called()
    env.get.assert_not_called()


@pytest.mark.parametrize(
    "invalid",
    [
        {"active": True},
        {"status": TidbAuthBindingStatus.CREATING},
        {"qdrant_endpoint": None},
        {"qdrant_endpoint": ""},
        {"account": ""},
        {"password": ""},
    ],
)
def test_unusable_idle_cluster_is_not_claimed(environment: _Environment, invalid: _BindingFields) -> None:
    env = environment
    unusable = add_binding(env, **invalid)
    usable = add_binding(env)
    result = service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert result.id == usable.id != unusable.id
    env.create.assert_not_called()


def test_assigned_inactive_cluster_cannot_be_claimed_by_another_tenant(environment: _Environment) -> None:
    env = environment
    assigned = add_binding(env, tenant=env.tenants[1].id)
    idle = add_binding(env)
    assert service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True).id == idle.id
    assert next(item for item in bindings(env) if item.id == assigned.id).tenant_id == env.tenants[1].id


def test_legacy_global_endpoint_fallback_can_claim_idle_cluster(
    environment: _Environment, config_overrides: Callable[..., None]
) -> None:
    idle = add_binding(environment, qdrant_endpoint=None)
    config_overrides(TIDB_ON_QDRANT_URL="https://legacy.test")
    assert service.resolve_tidb_auth_binding(environment.tenants[0].id, allow_create=True).id == idle.id


def test_creation_reserves_before_cloud_call_and_resumes_same_cluster(environment: _Environment) -> None:
    env = environment
    tenant_id = env.tenants[0].id

    def create(**kwargs: object) -> str:
        stored = bindings(env)
        assert len(stored) == 1
        assert stored[0].tenant_id == tenant_id
        assert stored[0].cluster_id == ""
        assert stored[0].status == TidbAuthBindingStatus.CREATING
        assert kwargs["password"] == stored[0].password
        assert kwargs["display_name"] == stored[0].cluster_name
        return "created-id"

    env.create.side_effect = create
    with pytest.raises(service.TidbBindingPendingError):
        service.resolve_tidb_auth_binding(tenant_id, allow_create=True)
    assert bindings(env)[0].cluster_id == "created-id"
    env.get.return_value = {"state": "CREATING"}
    with pytest.raises(service.TidbBindingPendingError):
        service.resolve_tidb_auth_binding(tenant_id, allow_create=True)
    env.get.return_value = {"state": "ACTIVE", "userPrefix": "prefix", "endpoints": {"public": {"host": "host.test"}}}
    ready = service.resolve_tidb_auth_binding(tenant_id, allow_create=True)
    assert ready.account == "prefix.root"
    assert ready.qdrant_endpoint == "https://qdrant-host.test"
    assert ready.status == TidbAuthBindingStatus.ACTIVE
    assert len(bindings(env)) == 1
    env.create.assert_called_once()
    assert env.get.call_args.args[-1] == "created-id"


@pytest.mark.parametrize(
    "cluster", [None, [], {"state": "CREATING"}, {"state": "ACTIVE"}, {"state": "ACTIVE", "userPrefix": "p"}]
)
def test_pending_cluster_is_not_marked_ready_until_endpoint_and_account_exist(
    environment: _Environment, cluster: object
) -> None:
    env = environment
    add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.CREATING)
    env.get.return_value = cluster
    with pytest.raises(service.TidbBindingPendingError):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert bindings(env)[0].status == TidbAuthBindingStatus.CREATING
    env.create.assert_not_called()


def test_readiness_network_failure_keeps_cluster_for_retry(environment: _Environment) -> None:
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.CREATING)
    env.get.side_effect = RuntimeError("secret provider response")
    with pytest.raises(service.TidbBindingPendingError) as error:
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert "secret" not in str(error.value)
    assert bindings(env)[0].cluster_id == own.cluster_id
    env.create.assert_not_called()


def test_uncertain_create_is_not_reissued_on_retry(environment: _Environment) -> None:
    env = environment
    env.create.side_effect = TimeoutError("private cloud credentials")
    with pytest.raises(service.TidbBindingUnavailableError, match="reconciliation"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    with pytest.raises(service.TidbBindingUnavailableError, match="reconciliation"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert bindings(env)[0].status == TidbAuthBindingStatus.FAILED
    assert bindings(env)[0].tenant_id == env.tenants[0].id
    env.create.assert_called_once()
    env.find.assert_called_once()


@pytest.mark.parametrize("status", [TidbAuthBindingStatus.FAILED, TidbAuthBindingStatus.CREATING])
@pytest.mark.parametrize("allow_create", [True, False])
def test_missing_cluster_id_recovers_the_original_reservation(
    environment: _Environment, status: TidbAuthBindingStatus, allow_create: bool
) -> None:
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True, status=status, cluster_id="", account="")
    env.find.return_value = "recovered-id"

    ready = service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=allow_create)

    assert ready.id == own.id
    assert ready.cluster_id == "recovered-id"
    assert ready.status == TidbAuthBindingStatus.ACTIVE
    assert ready.password == own.password
    assert ready.account == "tenant-prefix.root"
    assert len(bindings(env)) == 1
    env.create.assert_not_called()
    assert env.find.call_args.kwargs["display_name"] == own.cluster_name


def test_failed_binding_with_cluster_id_checks_readiness_before_failing(environment: _Environment) -> None:
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.FAILED)
    ready = service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert ready.cluster_id == own.cluster_id
    assert ready.status == TidbAuthBindingStatus.ACTIVE
    env.find.assert_not_called()
    env.create.assert_not_called()


@pytest.mark.parametrize("status_code", [400, 401, 403, 429])
def test_explicitly_rejected_creation_can_retry_after_cloud_lookup(environment: _Environment, status_code: int) -> None:
    env = environment
    response = httpx.Response(status_code, request=httpx.Request("POST", "https://tidb.test/clusters"))
    env.create.side_effect = [
        httpx.HTTPStatusError("secret response", request=response.request, response=response),
        "retry-id",
    ]
    with pytest.raises(service.TidbBindingUnavailableError):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    reserved = bindings(env)[0]
    assert reserved.creation_error_status == status_code

    ready = service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)

    assert ready.id == reserved.id
    assert ready.cluster_id == "retry-id"
    assert ready.status == TidbAuthBindingStatus.ACTIVE
    assert ready.creation_error_status is None
    assert len(bindings(env)) == 1
    env.find.assert_called_once()
    assert env.create.call_args_list[0] == env.create.call_args_list[1]


@pytest.mark.parametrize("creation_error_status", [None, 500, 502, 504, 409])
def test_unknown_or_ambiguous_creation_is_reconciled_without_duplicate_creation(
    environment: _Environment, creation_error_status: int | None
) -> None:
    env = environment
    add_binding(
        env,
        tenant=env.tenants[0].id,
        active=True,
        status=TidbAuthBindingStatus.FAILED,
        cluster_id="",
        creation_error_status=creation_error_status,
    )
    with pytest.raises(service.TidbBindingUnavailableError, match="reconciliation"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    env.find.assert_called_once()
    env.create.assert_not_called()
    assert bindings(env)[0].cluster_id == ""


def test_read_only_recovery_never_reissues_creation(environment: _Environment) -> None:
    env = environment
    add_binding(
        env,
        tenant=env.tenants[0].id,
        active=True,
        status=TidbAuthBindingStatus.FAILED,
        cluster_id="",
        creation_error_status=401,
    )
    with pytest.raises(service.TidbBindingUnavailableError):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=False)
    env.find.assert_called_once()
    env.create.assert_not_called()


def test_lookup_failure_is_retryable_without_leaking_or_recreating(environment: _Environment) -> None:
    env = environment
    add_binding(
        env,
        tenant=env.tenants[0].id,
        active=True,
        status=TidbAuthBindingStatus.FAILED,
        cluster_id="",
        creation_error_status=401,
    )
    env.find.side_effect = RuntimeError("private provider response")
    with pytest.raises(service.TidbBindingPendingError) as error:
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert "private" not in str(error.value)
    env.create.assert_not_called()
    assert bindings(env)[0].status == TidbAuthBindingStatus.FAILED


@pytest.mark.parametrize("change", ["revoke", "reassign", "password", "name"])
def test_reservation_changed_during_reconciliation_cannot_be_bound(environment: _Environment, change: str) -> None:
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.FAILED, cluster_id="")

    def find(**_kwargs: object) -> str:
        with Session(env.engine) as session, session.begin():
            row = session.get(TidbAuthBinding, own.id)
            assert row is not None
            if change == "revoke":
                row.active = False
            elif change == "reassign":
                row.tenant_id = env.tenants[1].id
            elif change == "password":
                row.password = "changed"
            else:
                row.cluster_name = "changed"
        return "recovered-id"

    env.find.side_effect = find
    with pytest.raises(service.TidbBindingUnavailableError, match="changed"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert bindings(env)[0].cluster_id == ""
    env.create.assert_not_called()


def test_inactive_binding_never_attempts_recovery(environment: _Environment) -> None:
    env = environment
    add_binding(env, tenant=env.tenants[0].id, status=TidbAuthBindingStatus.FAILED, cluster_id="")
    with pytest.raises(service.TidbBindingUnavailableError, match="inactive"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    env.find.assert_not_called()
    env.create.assert_not_called()


def test_recovery_cannot_reuse_a_cluster_already_bound_to_another_workspace(environment: _Environment) -> None:
    env = environment
    other = add_binding(env, tenant=env.tenants[1].id, active=True)
    own = add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.FAILED, cluster_id="")
    env.find.return_value = other.cluster_id
    with pytest.raises(service.TidbBindingUnavailableError, match="already bound"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert next(row for row in bindings(env) if row.id == own.id).cluster_id == ""
    env.create.assert_not_called()


@pytest.mark.parametrize("change", ["completed", "revoked", "reassigned"])
def test_recovery_rechecks_the_reservation_after_acquiring_the_lock(environment: _Environment, change: str) -> None:
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.FAILED, cluster_id="")
    original_load = service._load_binding
    loads = 0

    def load(tenant_id: str) -> TidbAuthBinding | None:
        nonlocal loads
        loads += 1
        if loads == 2:
            with Session(env.engine) as session, session.begin():
                row = session.get(TidbAuthBinding, own.id)
                assert row is not None
                if change == "completed":
                    row.cluster_id = "already-recovered"
                    row.status = TidbAuthBindingStatus.CREATING
                elif change == "revoked":
                    row.active = False
                else:
                    row.tenant_id = env.tenants[1].id
        return original_load(tenant_id)

    with patch.object(service, "_load_binding", side_effect=load):
        if change == "completed":
            ready = service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
            assert ready.cluster_id == "already-recovered"
            assert ready.status == TidbAuthBindingStatus.ACTIVE
        else:
            with pytest.raises(service.TidbBindingUnavailableError, match="changed"):
                service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    env.find.assert_not_called()
    env.create.assert_not_called()


def test_concurrent_recovery_does_not_create_twice(environment: _Environment) -> None:
    env = environment
    add_binding(
        env,
        tenant=env.tenants[0].id,
        active=True,
        status=TidbAuthBindingStatus.FAILED,
        cluster_id="",
        creation_error_status=401,
    )
    started, finish = threading.Event(), threading.Event()

    def create(**_kwargs: object) -> str:
        reserved = bindings(env)[0]
        assert reserved.creation_error_status is None
        assert reserved.status == TidbAuthBindingStatus.CREATING
        started.set()
        assert finish.wait(5)
        return "retry-id"

    env.create.side_effect = create
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(service.resolve_tidb_auth_binding, env.tenants[0].id, allow_create=True)
        try:
            assert started.wait(5)
            with pytest.raises(service.TidbBindingPendingError):
                service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
        finally:
            finish.set()
        assert first.result(timeout=5).cluster_id == "retry-id"
    env.create.assert_called_once()
    assert len(bindings(env)) == 1


def test_missing_config_does_not_reserve_or_call_cloud(
    environment: _Environment, config_overrides: Callable[..., None]
) -> None:
    config_overrides(TIDB_PRIVATE_KEY=None)
    with pytest.raises(service.TidbBindingUnavailableError, match="not configured"):
        service.resolve_tidb_auth_binding(environment.tenants[0].id, allow_create=True)
    assert bindings(environment) == []
    environment.create.assert_not_called()


def test_unknown_tenant_cannot_allocate_cluster(environment: _Environment) -> None:
    with pytest.raises(service.TidbBindingUnavailableError, match="does not exist"):
        service.resolve_tidb_auth_binding(str(uuid.uuid4()), allow_create=True)
    assert bindings(environment) == []
    environment.create.assert_not_called()


def test_lock_contention_is_retryable_and_never_creates_without_lock(environment: _Environment) -> None:
    environment.redis.lock.side_effect = LockError("busy")
    with pytest.raises(service.TidbBindingPendingError):
        service.resolve_tidb_auth_binding(environment.tenants[0].id, allow_create=True)
    assert bindings(environment) == []
    environment.create.assert_not_called()


def test_binding_created_by_another_request_is_rechecked_under_lock(environment: _Environment) -> None:
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True)
    with patch.object(service, "_load_binding", return_value=None):
        assert service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True).id == own.id
    env.create.assert_not_called()


def test_concurrent_first_writes_create_once(environment: _Environment) -> None:
    env = environment
    started, finish = threading.Event(), threading.Event()

    def create(**_kwargs: object) -> str:
        started.set()
        assert finish.wait(5)
        return "one-cluster"

    def resolve() -> None:
        with pytest.raises(service.TidbBindingPendingError):
            service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)

    env.create.side_effect = create
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(resolve)
        try:
            assert started.wait(5)
            executor.submit(resolve).result(timeout=5)
            env.create.assert_called_once()
        finally:
            finish.set()
        first.result(timeout=5)
    assert len(bindings(env)) == 1
    assert bindings(env)[0].cluster_id == "one-cluster"


def test_concurrent_tenants_claim_different_idle_clusters(environment: _Environment) -> None:
    env = environment
    idle = {add_binding(env).id, add_binding(env).id}
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(service.resolve_tidb_auth_binding, tenant.id, allow_create=True) for tenant in env.tenants
        ]
        results = [future.result(timeout=5) for future in futures]
    assert {result.id for result in results} == idle
    assert {result.tenant_id for result in results} == {tenant.id for tenant in env.tenants}
    env.create.assert_not_called()


def test_binding_revoked_during_readiness_is_not_reactivated(environment: _Environment) -> None:
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.CREATING)
    ready = env.get.return_value

    def revoke(*_args: object) -> object:
        with Session(env.engine) as session, session.begin():
            row = session.get(TidbAuthBinding, own.id)
            assert row is not None
            row.active = False
        return ready

    env.get.side_effect = revoke
    with pytest.raises(service.TidbBindingUnavailableError, match="changed"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert not bindings(env)[0].active


@pytest.mark.parametrize("missing", [{"account": ""}, {"password": ""}, {"qdrant_endpoint": None}])
def test_incomplete_active_binding_is_not_silently_replaced(
    environment: _Environment, missing: _CredentialFields
) -> None:
    env = environment
    add_binding(env, tenant=env.tenants[0].id, active=True, **missing)
    with pytest.raises(service.TidbBindingUnavailableError, match="incomplete"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    env.create.assert_not_called()


def test_cloud_create_reuses_configured_budget_and_has_bounded_timeout(config_overrides: Callable[..., None]) -> None:
    config_overrides(TIDB_SPEND_LIMIT=12)
    response = httpx.Response(200, json={"clusterId": "created"}, request=httpx.Request("POST", "https://cloud.test"))
    with patch("dify_vdb_tidb_on_qdrant.tidb_service._tidb_http_client") as http:
        http.post.return_value = response
        assert (
            TidbService.start_tidb_serverless_cluster(
                "project",
                "https://cloud.test",
                "pub",
                "priv",
                "region",
                display_name="saved-name",
                password="saved-password",
            )
            == "created"
        )
    assert http.post.call_args.kwargs["json"] == {
        "displayName": "saved-name",
        "region": {"name": "region"},
        "labels": {"tidb.cloud/project": "project"},
        "spendingLimit": {"monthly": 12},
        "rootPassword": "saved-password",
    }
    assert http.post.call_args.kwargs["timeout"].read == 30


@pytest.mark.parametrize("found", [True, False])
def test_cloud_lookup_is_bounded_and_checks_the_exact_reservation(found: bool) -> None:
    name = 'saved-"name'
    clusters: list[dict[str, object]] = (
        [
            {
                "clusterId": "found-id",
                "displayName": name,
                "labels": {"tidb.cloud/project": "project"},
                "region": {"name": "region"},
            }
        ]
        if found
        else []
    )
    response = httpx.Response(
        200,
        json={"clusters": clusters, "totalSize": len(clusters), "nextPageToken": ""},
        request=httpx.Request("GET", "https://tidb.test/clusters"),
    )
    with patch("dify_vdb_tidb_on_qdrant.tidb_service._tidb_http_client") as http:
        http.get.return_value = response
        result = TidbService.find_tidb_serverless_cluster(
            "project", "https://tidb.test", "pub", "priv", "region", display_name=name
        )
    assert result == ("found-id" if found else None)
    assert http.get.call_count == 1
    assert http.get.call_args.kwargs["params"] == {"pageSize": 2, "filter": f"displayName={json.dumps(name)}"}
    assert http.get.call_args.kwargs["timeout"].read == 10
    http.post.assert_not_called()


@pytest.mark.parametrize(
    "invalid",
    [
        "duplicate",
        "pagination",
        "truncated",
        "project",
        "region",
        "name",
        "id",
        "malformed",
        "missing",
        "total",
    ],
)
def test_cloud_lookup_rejects_ambiguous_foreign_or_incomplete_results(invalid: str) -> None:
    cluster: dict[str, object] = {
        "clusterId": "id",
        "displayName": "saved-name",
        "labels": {"tidb.cloud/project": "project"},
        "region": {"name": "region"},
    }
    payload: dict[str, object] = {"clusters": [cluster], "totalSize": 1}
    if invalid == "duplicate":
        payload.update(clusters=[cluster, cluster], totalSize=2)
    elif invalid == "pagination":
        payload["nextPageToken"] = "next"
    elif invalid == "truncated":
        payload["totalSize"] = 2
    elif invalid == "project":
        cluster["labels"] = {"tidb.cloud/project": "other"}
    elif invalid == "region":
        cluster["region"] = {"name": "other"}
    elif invalid == "name":
        cluster["displayName"] = "other"
    elif invalid == "id":
        cluster["clusterId"] = ""
    elif invalid == "malformed":
        payload["clusters"] = [None]
    elif invalid == "missing":
        payload = {}
    else:
        payload["totalSize"] = True
    response = httpx.Response(200, json=payload, request=httpx.Request("GET", "https://tidb.test/clusters"))
    with patch("dify_vdb_tidb_on_qdrant.tidb_service._tidb_http_client") as http:
        http.get.return_value = response
        with pytest.raises(ValueError, match="TiDB cluster"):
            TidbService.find_tidb_serverless_cluster(
                "project", "https://tidb.test", "pub", "priv", "region", display_name="saved-name"
            )


@pytest.mark.parametrize(
    "response", [httpx.Response(500), httpx.Response(200, json={}), httpx.Response(200, json={"clusterId": 1})]
)
def test_invalid_create_response_never_becomes_a_cluster_binding(response: httpx.Response) -> None:
    response.request = httpx.Request("POST", "https://cloud.test")
    with patch("dify_vdb_tidb_on_qdrant.tidb_service._tidb_http_client") as http:
        http.post.return_value = response
        with pytest.raises((httpx.HTTPStatusError, ValueError)):
            TidbService.start_tidb_serverless_cluster(
                "project", "https://cloud.test", "pub", "priv", "region", display_name="name", password="password"
            )


def test_legacy_dataset_factory_uses_shared_binding_and_resumes_pending(environment: _Environment) -> None:
    from dify_vdb_tidb_on_qdrant import tidb_on_qdrant_vector as legacy

    binding = add_binding(environment, tenant=environment.tenants[0].id, active=True)
    dataset = Dataset(id=str(uuid.uuid4()), tenant_id=environment.tenants[0].id, index_struct=None)
    with (
        patch.object(
            legacy, "resolve_tidb_auth_binding", side_effect=[service.TidbBindingPendingError(), binding]
        ) as resolve,
        patch.object(legacy.time, "sleep") as sleep,
        patch.object(legacy, "TidbOnQdrantVector") as vector,
    ):
        legacy.TidbOnQdrantVectorFactory().init_vector(dataset, [], _UnusedEmbeddings(), session=None)
    assert resolve.call_count == 2
    resolve.assert_called_with(binding.tenant_id, allow_create=True)
    sleep.assert_called_once_with(5)
    assert vector.call_args.kwargs["config"].endpoint == binding.qdrant_endpoint
    assert vector.call_args.kwargs["config"].api_key == "account:password"


def test_legacy_dataset_factory_bounds_readiness_wait(environment: _Environment) -> None:
    from dify_vdb_tidb_on_qdrant import tidb_on_qdrant_vector as legacy

    dataset = Dataset(id=str(uuid.uuid4()), tenant_id=environment.tenants[0].id)
    with (
        patch.object(legacy, "resolve_tidb_auth_binding", side_effect=service.TidbBindingPendingError()),
        patch.object(legacy.time, "monotonic", side_effect=[0, 901]),
        patch.object(legacy.time, "sleep") as sleep,
    ):
        with pytest.raises(service.TidbBindingPendingError):
            legacy.TidbOnQdrantVectorFactory().init_vector(dataset, [], _UnusedEmbeddings(), session=None)
    sleep.assert_not_called()
