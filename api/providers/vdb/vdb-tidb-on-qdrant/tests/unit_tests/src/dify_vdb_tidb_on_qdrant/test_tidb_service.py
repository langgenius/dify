from dataclasses import dataclass

import dify_vdb_tidb_on_qdrant.tidb_service as tidb_service_module
import httpx
import pytest
from dify_vdb_tidb_on_qdrant.tidb_service import TidbService
from sqlalchemy.orm import Session

from models.dataset import TidbAuthBinding
from models.enums import TidbAuthBindingStatus


@dataclass(frozen=True)
class ApiKeys:
    """Stands in for ``DigestAuth`` so each recorded request shows the credentials it carries."""

    public_key: str
    private_key: str


@dataclass(frozen=True)
class CloudRequest:
    """One request sent to the TiDB Cloud API."""

    method: str
    url: str
    auth: object
    params: object = None


class FakeTidbCloudClient:
    """Stands in for the pooled TiDB Cloud client: answers with queued replies and records each request."""

    def __init__(self) -> None:
        self._replies: list[httpx.Response | Exception] = []
        self.requests: list[CloudRequest] = []

    def queue(self, *replies: httpx.Response | Exception) -> None:
        self._replies.extend(replies)

    def post(self, url: str, *, json: object, auth: object) -> httpx.Response:
        return self._reply(CloudRequest("POST", url, auth))

    def get(self, url: str, *, auth: object, params: object = None, timeout: object = None) -> httpx.Response:
        return self._reply(CloudRequest("GET", url, auth, params))

    def _reply(self, request: CloudRequest) -> httpx.Response:
        self.requests.append(request)
        reply = self._replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        # raise_for_status() needs the request that produced the response.
        reply.request = httpx.Request(request.method, request.url)
        return reply


class FakeRedis:
    """The parts of ``redis_client`` that batch creation uses, with a fixed set of cached values."""

    def __init__(self, cached: dict[str, bytes] | None = None) -> None:
        self._cached = cached or {}
        self.setex_calls: list[tuple[str, int, str]] = []

    def setex(self, name: str, seconds: int, value: str) -> None:
        self.setex_calls.append((name, seconds, value))

    def get(self, name: str) -> bytes | None:
        return self._cached.get(name)


@pytest.fixture
def cloud_client(monkeypatch: pytest.MonkeyPatch) -> FakeTidbCloudClient:
    client = FakeTidbCloudClient()
    monkeypatch.setattr(tidb_service_module, "_tidb_http_client", client)
    monkeypatch.setattr(tidb_service_module, "DigestAuth", ApiKeys)
    return client


@pytest.fixture
def sleeps(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    recorded: list[float] = []
    monkeypatch.setattr(tidb_service_module.time, "sleep", recorded.append)
    return recorded


KEYS = ApiKeys("pub", "priv")


class TestExtractQdrantEndpoint:
    """Unit tests for TidbService.extract_qdrant_endpoint."""

    def test_returns_endpoint_when_host_present(self) -> None:
        response = {"endpoints": {"public": {"host": "gateway01.us-east-1.tidbcloud.com", "port": 4000}}}
        result = TidbService.extract_qdrant_endpoint(response)
        assert result == "https://qdrant-gateway01.us-east-1.tidbcloud.com"

    def test_returns_none_when_host_missing(self) -> None:
        response: dict[str, dict[str, dict[str, str]]] = {"endpoints": {"public": {}}}
        assert TidbService.extract_qdrant_endpoint(response) is None

    def test_returns_none_when_public_missing(self) -> None:
        response: dict[str, dict[str, str]] = {"endpoints": {}}
        assert TidbService.extract_qdrant_endpoint(response) is None

    def test_returns_none_when_endpoints_missing(self) -> None:
        assert TidbService.extract_qdrant_endpoint({}) is None


class TestFetchQdrantEndpoint:
    """Unit tests for TidbService.fetch_qdrant_endpoint."""

    def test_returns_endpoint_when_host_present(self, cloud_client: FakeTidbCloudClient) -> None:
        cloud_client.queue(
            httpx.Response(
                200, json={"endpoints": {"public": {"host": "gateway01.us-east-1.tidbcloud.com", "port": 4000}}}
            )
        )
        result = TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123")
        assert result == "https://qdrant-gateway01.us-east-1.tidbcloud.com"
        assert cloud_client.requests == [CloudRequest("GET", "url/clusters/c-123", KEYS)]

    def test_returns_none_when_cluster_response_is_none(self, cloud_client: FakeTidbCloudClient) -> None:
        cloud_client.queue(httpx.Response(200, content=b"null"))
        assert TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123") is None

    def test_returns_none_when_host_missing(self, cloud_client: FakeTidbCloudClient) -> None:
        cloud_client.queue(httpx.Response(200, json={"endpoints": {"public": {}}}))
        assert TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123") is None

    def test_returns_none_when_endpoints_missing(self, cloud_client: FakeTidbCloudClient) -> None:
        cloud_client.queue(httpx.Response(200, json={}))
        assert TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123") is None

    def test_returns_none_on_exception(self, cloud_client: FakeTidbCloudClient) -> None:
        cloud_client.queue(httpx.ConnectError("network error"))
        assert TidbService.fetch_qdrant_endpoint("url", "pub", "priv", "c-123") is None


class TestCreateTidbServerlessClusterQdrantEndpoint:
    """Verify that create_tidb_serverless_cluster includes qdrant_endpoint in its result."""

    def test_result_contains_qdrant_endpoint(self, cloud_client: FakeTidbCloudClient) -> None:
        cloud_client.queue(
            httpx.Response(200, json={"clusterId": "c-1"}),
            httpx.Response(
                200,
                json={
                    "state": "ACTIVE",
                    "userPrefix": "pfx",
                    "endpoints": {"public": {"host": "gw.tidbcloud.com", "port": 4000}},
                },
            ),
        )

        result = TidbService.create_tidb_serverless_cluster("proj", "url", "iam", "pub", "priv", "us-east-1")

        assert result is not None
        assert result["account"] == "pfx.root"
        assert result["qdrant_endpoint"] == "https://qdrant-gw.tidbcloud.com"
        assert cloud_client.requests == [
            CloudRequest("POST", "url/clusters", KEYS),
            CloudRequest("GET", "url/clusters/c-1", KEYS),
        ]

    def test_result_qdrant_endpoint_none_when_no_endpoints(self, cloud_client: FakeTidbCloudClient) -> None:
        cloud_client.queue(
            httpx.Response(200, json={"clusterId": "c-1"}),
            httpx.Response(200, json={"state": "ACTIVE", "userPrefix": "pfx"}),
        )

        result = TidbService.create_tidb_serverless_cluster("proj", "url", "iam", "pub", "priv", "us-east-1")

        assert result is not None
        assert result["qdrant_endpoint"] is None


class TestBatchCreateTidbServerlessClusterQdrantEndpoint:
    """Verify that batch_create includes qdrant_endpoint per cluster."""

    def test_batch_result_contains_qdrant_endpoint(
        self, cloud_client: FakeTidbCloudClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        cluster_name = "abc123"
        fake_redis = FakeRedis({f"tidb_serverless_cluster_password:{cluster_name}": b"password123"})
        monkeypatch.setattr(tidb_service_module, "redis_client", fake_redis)
        cloud_client.queue(
            httpx.Response(200, json={"clusters": [{"clusterId": "c-1", "displayName": cluster_name}]}),
            httpx.Response(200, json={"endpoints": {"public": {"host": "gw.tidbcloud.com"}}}),
        )

        result = TidbService.batch_create_tidb_serverless_cluster(
            batch_size=1,
            project_id="proj",
            api_url="url",
            iam_url="iam",
            public_key="pub",
            private_key="priv",
            region="us-east-1",
        )

        assert result == [
            {
                "cluster_id": "c-1",
                "cluster_name": cluster_name,
                "account": "root",
                "password": "password123",
                "qdrant_endpoint": "https://qdrant-gw.tidbcloud.com",
            }
        ]
        assert [(seconds, len(password)) for _, seconds, password in fake_redis.setex_calls] == [(3600, 16)]
        assert cloud_client.requests == [
            CloudRequest("POST", "url/clusters:batchCreate", KEYS),
            CloudRequest("GET", "url/clusters/c-1", KEYS),
        ]


class TestCreateTidbServerlessClusterRetry:
    """Cover retry/logging paths in create_tidb_serverless_cluster."""

    def test_polls_until_active(self, cloud_client: FakeTidbCloudClient, sleeps: list[float]) -> None:
        cloud_client.queue(
            httpx.Response(200, json={"clusterId": "c-1"}),
            httpx.Response(200, json={"state": "CREATING", "userPrefix": ""}),
            httpx.Response(
                200, json={"state": "ACTIVE", "userPrefix": "pfx", "endpoints": {"public": {"host": "gw.tidb.com"}}}
            ),
        )

        result = TidbService.create_tidb_serverless_cluster("proj", "url", "iam", "pub", "priv", "us-east-1")

        assert result is not None
        assert result["qdrant_endpoint"] == "https://qdrant-gw.tidb.com"
        assert [request.url for request in cloud_client.requests] == [
            "url/clusters",
            "url/clusters/c-1",
            "url/clusters/c-1",
        ]
        assert sleeps == [30]

    def test_returns_none_after_max_retries(self, cloud_client: FakeTidbCloudClient, sleeps: list[float]) -> None:
        cloud_client.queue(
            httpx.Response(200, json={"clusterId": "c-1"}),
            *[httpx.Response(200, json={"state": "CREATING", "userPrefix": ""}) for _ in range(30)],
        )

        result = TidbService.create_tidb_serverless_cluster("proj", "url", "iam", "pub", "priv", "us-east-1")

        assert result is None
        assert len(cloud_client.requests) == 31
        assert sleeps == [30] * 30

    def test_raises_on_post_failure(self, cloud_client: FakeTidbCloudClient) -> None:
        cloud_client.queue(httpx.Response(400, text="Bad Request"))

        with pytest.raises(httpx.HTTPStatusError, match="400 Bad Request"):
            TidbService.create_tidb_serverless_cluster("proj", "url", "iam", "pub", "priv", "us-east-1")


class TestBatchCreateEdgeCases:
    """Cover logging/edge-case branches in batch_create."""

    def test_skips_cluster_when_no_cached_password(
        self, cloud_client: FakeTidbCloudClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(tidb_service_module, "redis_client", FakeRedis())
        cloud_client.queue(httpx.Response(200, json={"clusters": [{"clusterId": "c-1", "displayName": "name1"}]}))

        result = TidbService.batch_create_tidb_serverless_cluster(
            batch_size=1,
            project_id="proj",
            api_url="url",
            iam_url="iam",
            public_key="pub",
            private_key="priv",
            region="us-east-1",
        )

        assert len(result) == 0
        # No Get Cluster request: the qdrant endpoint is not fetched for a skipped cluster.
        assert cloud_client.requests == [CloudRequest("POST", "url/clusters:batchCreate", KEYS)]

    def test_raises_on_post_failure(self, cloud_client: FakeTidbCloudClient, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(tidb_service_module, "redis_client", FakeRedis())
        cloud_client.queue(httpx.Response(500, text="Server Error"))

        with pytest.raises(httpx.HTTPStatusError, match="500 Internal Server Error"):
            TidbService.batch_create_tidb_serverless_cluster(
                batch_size=1,
                project_id="proj",
                api_url="url",
                iam_url="iam",
                public_key="pub",
                private_key="priv",
                region="us-east-1",
            )


def _persist_tidb_auth_binding(sqlite3_session: Session) -> TidbAuthBinding:
    binding = TidbAuthBinding(
        tenant_id=None,
        cluster_id="c-1",
        cluster_name="cluster-1",
        active=False,
        status=TidbAuthBindingStatus.CREATING,
        account="root",
        password="password",
    )
    sqlite3_session.add(binding)
    sqlite3_session.commit()
    return binding


@pytest.mark.parametrize("sqlite3_session", [(TidbAuthBinding,)], indirect=True)
class TestBatchUpdateTidbServerlessClusterStatus:
    """Verify that status updates only expose clusters after qdrant endpoint is ready."""

    def test_sets_active_when_batch_response_contains_endpoint(
        self,
        cloud_client: FakeTidbCloudClient,
        monkeypatch: pytest.MonkeyPatch,
        sqlite3_session: Session,
    ) -> None:
        binding = _persist_tidb_auth_binding(sqlite3_session)
        monkeypatch.setattr(tidb_service_module.db, "session", sqlite3_session)
        cloud_client.queue(
            httpx.Response(
                200,
                json={
                    "clusters": [
                        {
                            "clusterId": "c-1",
                            "state": "ACTIVE",
                            "userPrefix": "pfx",
                            "endpoints": {"public": {"host": "gw.tidbcloud.com"}},
                        }
                    ]
                },
            )
        )

        TidbService.batch_update_tidb_serverless_cluster_status([binding], "proj", "url", "iam", "pub", "priv")

        sqlite3_session.expire_all()
        persisted = sqlite3_session.get(TidbAuthBinding, binding.id)
        assert persisted is not None
        assert persisted.account == "pfx.root"
        assert persisted.qdrant_endpoint == "https://qdrant-gw.tidbcloud.com"
        assert persisted.status == TidbAuthBindingStatus.ACTIVE
        assert cloud_client.requests == [
            CloudRequest("GET", "url/clusters:batchGet", KEYS, {"clusterIds": ["c-1"], "view": "BASIC"})
        ]

    def test_fetches_endpoint_when_batch_response_omits_it(
        self,
        cloud_client: FakeTidbCloudClient,
        monkeypatch: pytest.MonkeyPatch,
        sqlite3_session: Session,
    ) -> None:
        binding = _persist_tidb_auth_binding(sqlite3_session)
        monkeypatch.setattr(tidb_service_module.db, "session", sqlite3_session)
        cloud_client.queue(
            httpx.Response(
                200,
                json={"clusters": [{"clusterId": "c-1", "state": "ACTIVE", "userPrefix": "pfx", "endpoints": {}}]},
            ),
            httpx.Response(200, json={"endpoints": {"public": {"host": "gw.tidbcloud.com"}}}),
        )

        TidbService.batch_update_tidb_serverless_cluster_status([binding], "proj", "url", "iam", "pub", "priv")

        sqlite3_session.expire_all()
        persisted = sqlite3_session.get(TidbAuthBinding, binding.id)
        assert persisted is not None
        assert persisted.account == "pfx.root"
        assert persisted.qdrant_endpoint == "https://qdrant-gw.tidbcloud.com"
        assert persisted.status == TidbAuthBindingStatus.ACTIVE
        assert cloud_client.requests[1:] == [CloudRequest("GET", "url/clusters/c-1", KEYS)]

    def test_keeps_creating_when_endpoint_is_not_ready(
        self,
        cloud_client: FakeTidbCloudClient,
        monkeypatch: pytest.MonkeyPatch,
        sqlite3_session: Session,
    ) -> None:
        binding = _persist_tidb_auth_binding(sqlite3_session)
        monkeypatch.setattr(tidb_service_module.db, "session", sqlite3_session)
        cloud_client.queue(
            httpx.Response(
                200,
                json={"clusters": [{"clusterId": "c-1", "state": "ACTIVE", "userPrefix": "pfx", "endpoints": {}}]},
            ),
            httpx.Response(200, json={"endpoints": {}}),
        )

        TidbService.batch_update_tidb_serverless_cluster_status([binding], "proj", "url", "iam", "pub", "priv")

        sqlite3_session.expire_all()
        persisted = sqlite3_session.get(TidbAuthBinding, binding.id)
        assert persisted is not None
        assert persisted.account == "pfx.root"
        assert persisted.qdrant_endpoint is None
        assert persisted.status == TidbAuthBindingStatus.CREATING
        assert cloud_client.requests[1:] == [CloudRequest("GET", "url/clusters/c-1", KEYS)]
