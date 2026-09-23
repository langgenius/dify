import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx
import pytest
from dify_vdb_tidb_on_qdrant.tidb_service import TidbService
from redis.exceptions import LockError
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.account import Tenant
from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus
from services import tidb_binding_service as service


@pytest.fixture
def environment(sqlite_engine, monkeypatch, config_overrides):
    monkeypatch.setattr(service, "db", SimpleNamespace(engine=sqlite_engine))
    lock = threading.Lock()

    @contextmanager
    def acquire(*_args, **_kwargs):
        with lock:
            yield

    redis = SimpleNamespace(lock=MagicMock(side_effect=acquire))
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
        yield SimpleNamespace(engine=sqlite_engine, tenants=tenants, redis=redis, create=create, get=get)


def add_binding(env, *, tenant=None, active=False, status=TidbAuthBindingStatus.ACTIVE, **changes):
    fields = {
        "tenant_id": tenant,
        "cluster_id": uuid.uuid4().hex,
        "cluster_name": "cluster",
        "account": "account",
        "password": "password",
        "qdrant_endpoint": "https://qdrant.tenant.test",
        "active": active,
        "status": status,
    }
    fields.update(changes)
    with Session(env.engine, expire_on_commit=False) as session, session.begin():
        binding = TidbAuthBinding(**fields)
        session.add(binding)
    return binding


def bindings(env):
    with Session(env.engine) as session:
        return session.scalars(select(TidbAuthBinding)).all()


def test_existing_binding_routes_to_its_tenant_without_allocation(environment):
    env = environment
    other = add_binding(env, tenant=env.tenants[1].id, active=True)
    own = add_binding(env, tenant=env.tenants[0].id, active=True)
    result = service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert result.id == own.id != other.id
    env.redis.lock.assert_not_called()
    env.create.assert_not_called()
    env.get.assert_not_called()


def test_read_without_binding_never_allocates(environment):
    with pytest.raises(service.TidbBindingUnavailableError, match="no active"):
        service.resolve_tidb_auth_binding(environment.tenants[0].id, allow_create=False)
    environment.create.assert_not_called()
    environment.redis.lock.assert_not_called()
    assert bindings(environment) == []


def test_idle_claim_is_persisted_without_cloud_credentials(environment, config_overrides):
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
def test_unusable_idle_cluster_is_not_claimed(environment, invalid):
    env = environment
    unusable = add_binding(env, **invalid)
    usable = add_binding(env)
    result = service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert result.id == usable.id != unusable.id
    env.create.assert_not_called()


def test_assigned_inactive_cluster_cannot_be_claimed_by_another_tenant(environment):
    env = environment
    assigned = add_binding(env, tenant=env.tenants[1].id)
    idle = add_binding(env)
    assert service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True).id == idle.id
    assert next(item for item in bindings(env) if item.id == assigned.id).tenant_id == env.tenants[1].id


def test_legacy_global_endpoint_fallback_can_claim_idle_cluster(environment, config_overrides):
    idle = add_binding(environment, qdrant_endpoint=None)
    config_overrides(TIDB_ON_QDRANT_URL="https://legacy.test")
    assert service.resolve_tidb_auth_binding(environment.tenants[0].id, allow_create=True).id == idle.id


def test_creation_reserves_before_cloud_call_and_resumes_same_cluster(environment):
    env = environment
    tenant_id = env.tenants[0].id

    def create(**kwargs):
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
def test_pending_cluster_is_not_marked_ready_until_endpoint_and_account_exist(environment, cluster):
    env = environment
    add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.CREATING)
    env.get.return_value = cluster
    with pytest.raises(service.TidbBindingPendingError):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert bindings(env)[0].status == TidbAuthBindingStatus.CREATING
    env.create.assert_not_called()


def test_readiness_network_failure_keeps_cluster_for_retry(environment):
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.CREATING)
    env.get.side_effect = RuntimeError("secret provider response")
    with pytest.raises(service.TidbBindingPendingError) as error:
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert "secret" not in str(error.value)
    assert bindings(env)[0].cluster_id == own.cluster_id
    env.create.assert_not_called()


def test_uncertain_create_is_not_reissued_on_retry(environment):
    env = environment
    env.create.side_effect = TimeoutError("private cloud credentials")
    with pytest.raises(service.TidbBindingUnavailableError, match="reconciliation"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    with pytest.raises(service.TidbBindingUnavailableError, match="reconciliation"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert bindings(env)[0].status == TidbAuthBindingStatus.FAILED
    assert bindings(env)[0].tenant_id == env.tenants[0].id
    env.create.assert_called_once()


def test_missing_config_does_not_reserve_or_call_cloud(environment, config_overrides):
    config_overrides(TIDB_PRIVATE_KEY=None)
    with pytest.raises(service.TidbBindingUnavailableError, match="not configured"):
        service.resolve_tidb_auth_binding(environment.tenants[0].id, allow_create=True)
    assert bindings(environment) == []
    environment.create.assert_not_called()


def test_unknown_tenant_cannot_allocate_cluster(environment):
    with pytest.raises(service.TidbBindingUnavailableError, match="does not exist"):
        service.resolve_tidb_auth_binding(str(uuid.uuid4()), allow_create=True)
    assert bindings(environment) == []
    environment.create.assert_not_called()


def test_lock_contention_is_retryable_and_never_creates_without_lock(environment):
    environment.redis.lock.side_effect = LockError("busy")
    with pytest.raises(service.TidbBindingPendingError):
        service.resolve_tidb_auth_binding(environment.tenants[0].id, allow_create=True)
    assert bindings(environment) == []
    environment.create.assert_not_called()


def test_binding_created_by_another_request_is_rechecked_under_lock(environment):
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True)
    with patch.object(service, "_load_binding", return_value=None):
        assert service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True).id == own.id
    env.create.assert_not_called()


def test_concurrent_first_writes_create_once(environment):
    env = environment
    started, finish = threading.Event(), threading.Event()

    def create(**_kwargs):
        started.set()
        assert finish.wait(5)
        return "one-cluster"

    def resolve():
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


def test_concurrent_tenants_claim_different_idle_clusters(environment):
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


def test_binding_revoked_during_readiness_is_not_reactivated(environment):
    env = environment
    own = add_binding(env, tenant=env.tenants[0].id, active=True, status=TidbAuthBindingStatus.CREATING)
    ready = env.get.return_value

    def revoke(*_args):
        with Session(env.engine) as session, session.begin():
            session.get(TidbAuthBinding, own.id).active = False
        return ready

    env.get.side_effect = revoke
    with pytest.raises(service.TidbBindingUnavailableError, match="changed"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    assert not bindings(env)[0].active


@pytest.mark.parametrize("missing", [{"account": ""}, {"password": ""}, {"qdrant_endpoint": None}])
def test_incomplete_active_binding_is_not_silently_replaced(environment, missing):
    env = environment
    add_binding(env, tenant=env.tenants[0].id, active=True, **missing)
    with pytest.raises(service.TidbBindingUnavailableError, match="incomplete"):
        service.resolve_tidb_auth_binding(env.tenants[0].id, allow_create=True)
    env.create.assert_not_called()


def test_cloud_create_reuses_configured_budget_and_has_bounded_timeout(config_overrides):
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


@pytest.mark.parametrize(
    "response", [httpx.Response(500), httpx.Response(200, json={}), httpx.Response(200, json={"clusterId": 1})]
)
def test_invalid_create_response_never_becomes_a_cluster_binding(response):
    response.request = httpx.Request("POST", "https://cloud.test")
    with patch("dify_vdb_tidb_on_qdrant.tidb_service._tidb_http_client") as http:
        http.post.return_value = response
        with pytest.raises((httpx.HTTPStatusError, ValueError)):
            TidbService.start_tidb_serverless_cluster(
                "project", "https://cloud.test", "pub", "priv", "region", display_name="name", password="password"
            )


def test_legacy_dataset_factory_uses_shared_binding_and_resumes_pending(environment):
    from dify_vdb_tidb_on_qdrant import tidb_on_qdrant_vector as legacy

    binding = add_binding(environment, tenant=environment.tenants[0].id, active=True)
    dataset = SimpleNamespace(id=str(uuid.uuid4()), tenant_id=binding.tenant_id, index_struct_dict=None)
    with (
        patch.object(
            legacy, "resolve_tidb_auth_binding", side_effect=[service.TidbBindingPendingError(), binding]
        ) as resolve,
        patch.object(legacy.time, "sleep") as sleep,
        patch.object(legacy, "TidbOnQdrantVector") as vector,
    ):
        legacy.TidbOnQdrantVectorFactory().init_vector(dataset, [], MagicMock())
    assert resolve.call_count == 2
    resolve.assert_called_with(binding.tenant_id, allow_create=True)
    sleep.assert_called_once_with(5)
    assert vector.call_args.kwargs["config"].endpoint == binding.qdrant_endpoint
    assert vector.call_args.kwargs["config"].api_key == "account:password"


def test_legacy_dataset_factory_bounds_readiness_wait(environment):
    from dify_vdb_tidb_on_qdrant import tidb_on_qdrant_vector as legacy

    dataset = SimpleNamespace(id=str(uuid.uuid4()), tenant_id=environment.tenants[0].id)
    with (
        patch.object(legacy, "resolve_tidb_auth_binding", side_effect=service.TidbBindingPendingError()),
        patch.object(legacy.time, "monotonic", side_effect=[0, 901]),
        patch.object(legacy.time, "sleep") as sleep,
    ):
        with pytest.raises(service.TidbBindingPendingError):
            legacy.TidbOnQdrantVectorFactory().init_vector(dataset, [], MagicMock())
    sleep.assert_not_called()
