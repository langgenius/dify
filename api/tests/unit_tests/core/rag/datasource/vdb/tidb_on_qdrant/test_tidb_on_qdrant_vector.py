import importlib
import sys
import types
from collections import UserDict
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


def _build_fake_qdrant_modules():
    qdrant_client = types.ModuleType("qdrant_client")
    qdrant_http = types.ModuleType("qdrant_client.http")
    qdrant_http_models = types.ModuleType("qdrant_client.http.models")
    qdrant_http_exceptions = types.ModuleType("qdrant_client.http.exceptions")
    qdrant_local_pkg = types.ModuleType("qdrant_client.local")
    qdrant_local_mod = types.ModuleType("qdrant_client.local.qdrant_local")

    class UnexpectedResponseError(Exception):
        def __init__(self, status_code):
            super().__init__(f"status={status_code}")
            self.status_code = status_code

    class FilterSelector:
        def __init__(self, filter):
            self.filter = filter

    class HnswConfigDiff:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class TextIndexParams:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class VectorParams:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class PointStruct:
        def __init__(self, **kwargs):
            self.id = kwargs["id"]
            self.vector = kwargs["vector"]
            self.payload = kwargs["payload"]

    class Filter:
        def __init__(self, must=None):
            self.must = must or []

    class FieldCondition:
        def __init__(self, key, match):
            self.key = key
            self.match = match

    class MatchValue:
        def __init__(self, value):
            self.value = value

    class MatchAny:
        def __init__(self, any):
            self.any = any

    class _Distance(UserDict):
        def __getitem__(self, key):
            return key

    class QdrantClient:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.get_collections = MagicMock(return_value=SimpleNamespace(collections=[]))
            self.create_collection = MagicMock()
            self.create_payload_index = MagicMock()
            self.upsert = MagicMock()
            self.delete = MagicMock()
            self.delete_collection = MagicMock()
            self.retrieve = MagicMock(return_value=[])
            self.search = MagicMock(return_value=[])
            self.scroll = MagicMock(return_value=([], None))

    class QdrantLocal(QdrantClient):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self._load = MagicMock()

    qdrant_client.QdrantClient = QdrantClient
    qdrant_http.models = qdrant_http_models
    qdrant_http_models.FilterSelector = FilterSelector
    qdrant_http_models.HnswConfigDiff = HnswConfigDiff
    qdrant_http_models.PayloadSchemaType = SimpleNamespace(KEYWORD="KEYWORD")
    qdrant_http_models.TextIndexParams = TextIndexParams
    qdrant_http_models.TextIndexType = SimpleNamespace(TEXT="TEXT")
    qdrant_http_models.TokenizerType = SimpleNamespace(MULTILINGUAL="MULTILINGUAL")
    qdrant_http_models.VectorParams = VectorParams
    qdrant_http_models.Distance = _Distance()
    qdrant_http_models.PointStruct = PointStruct
    qdrant_http_models.Filter = Filter
    qdrant_http_models.FieldCondition = FieldCondition
    qdrant_http_models.MatchValue = MatchValue
    qdrant_http_models.MatchAny = MatchAny
    qdrant_http_exceptions.UnexpectedResponse = UnexpectedResponseError

    qdrant_local_mod.QdrantLocal = QdrantLocal
    qdrant_local_pkg.qdrant_local = qdrant_local_mod

    return {
        "qdrant_client": qdrant_client,
        "qdrant_client.http": qdrant_http,
        "qdrant_client.http.models": qdrant_http_models,
        "qdrant_client.http.exceptions": qdrant_http_exceptions,
        "qdrant_client.local": qdrant_local_pkg,
        "qdrant_client.local.qdrant_local": qdrant_local_mod,
    }


@pytest.fixture
def tidb_vector_module(monkeypatch):
    for name, module in _build_fake_qdrant_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.tidb_on_qdrant.tidb_on_qdrant_vector as module

    return importlib.reload(module)


@pytest.fixture
def tidb_service_module():
    import core.rag.datasource.vdb.tidb_on_qdrant.tidb_service as module

    return importlib.reload(module)


def _config(module, **overrides):
    values = {
        "endpoint": "http://localhost:6333",
        "api_key": "api-key",
        "timeout": 20,
        "root_path": "/tmp",
        "grpc_port": 6334,
        "prefer_grpc": False,
        "replication_factor": 1,
    }
    values.update(overrides)
    return module.TidbOnQdrantConfig.model_validate(values)


def test_tidb_qdrant_config_and_init(tidb_vector_module):
    config = _config(tidb_vector_module)
    url_params = config.to_qdrant_params()
    assert url_params["url"] == "http://localhost:6333"
    assert url_params["verify"] is False

    path_config = _config(tidb_vector_module, endpoint="path:data")
    assert path_config.to_qdrant_params()["path"] == "/tmp/data"
    with pytest.raises(ValueError, match="root_path is required"):
        _config(tidb_vector_module, endpoint="path:data", root_path=None).to_qdrant_params()

    vector = tidb_vector_module.TidbOnQdrantVector("collection_1", "group-1", config)
    assert vector.get_type() == tidb_vector_module.VectorType.TIDB_ON_QDRANT
    assert vector.to_index_struct()["vector_store"]["class_prefix"] == "collection_1"


def test_tidb_qdrant_create_collection_and_add_texts(tidb_vector_module, monkeypatch):
    vector = tidb_vector_module.TidbOnQdrantVector("collection_1", "group-1", _config(tidb_vector_module))
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(tidb_vector_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(tidb_vector_module.redis_client, "set", MagicMock())

    monkeypatch.setattr(tidb_vector_module.redis_client, "get", MagicMock(return_value=1))
    vector.create_collection("collection_1", 3)
    vector._client.create_collection.assert_not_called()

    monkeypatch.setattr(tidb_vector_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.get_collections.return_value = SimpleNamespace(collections=[])
    vector.create_collection("collection_1", 3)
    vector._client.create_collection.assert_called_once()
    assert vector._client.create_payload_index.call_count == 4
    tidb_vector_module.redis_client.set.assert_called_once()

    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        Document(page_content="b", metadata={"doc_id": "id-2"}),
    ]
    ids = vector.add_texts(docs, [[0.1], [0.2]])
    assert ids == ["id-1", "id-2"]
    vector._client.upsert.assert_called_once()

    payloads = tidb_vector_module.TidbOnQdrantVector._build_payloads(
        ["a"], [{"doc_id": "id-1"}], "content", "metadata", "group-1", "group_id"
    )
    assert payloads[0]["group_id"] == "group-1"


def test_tidb_qdrant_delete_search_and_helpers(tidb_vector_module):
    vector = tidb_vector_module.TidbOnQdrantVector("collection_1", "group-1", _config(tidb_vector_module))
    unexpected = sys.modules["qdrant_client.http.exceptions"].UnexpectedResponse

    vector._client.delete.side_effect = unexpected(404)
    vector.delete_by_metadata_field("document_id", "doc-1")
    vector._client.delete.side_effect = unexpected(500)
    with pytest.raises(unexpected):
        vector.delete_by_metadata_field("document_id", "doc-1")
    vector._client.delete.side_effect = None

    vector._client.delete_collection.side_effect = unexpected(404)
    vector.delete()
    vector._client.delete_collection.side_effect = unexpected(500)
    with pytest.raises(unexpected):
        vector.delete()
    vector._client.delete_collection.side_effect = None

    vector._client.delete.side_effect = unexpected(404)
    vector.delete_by_ids(["id-1"])
    vector._client.delete.side_effect = unexpected(500)
    with pytest.raises(unexpected):
        vector.delete_by_ids(["id-1"])
    vector._client.delete.side_effect = None

    vector._client.get_collections.return_value = SimpleNamespace(collections=[SimpleNamespace(name="collection_1")])
    vector._client.retrieve.return_value = [{"id": "id-1"}]
    assert vector.text_exists("id-1") is True

    vector._client.search.return_value = [
        SimpleNamespace(payload=None, score=0.8, vector=[0.1]),
        SimpleNamespace(payload={"metadata": {"doc_id": "1"}, "page_content": "doc-a"}, score=0.7, vector=[0.1]),
    ]
    docs = vector.search_by_vector([0.1], top_k=2, score_threshold=0.6, document_ids_filter=["doc-a"])
    assert len(docs) == 1
    assert docs[0].metadata["score"] == pytest.approx(0.7)

    vector._client.scroll.return_value = (
        [SimpleNamespace(payload={"page_content": "doc-b", "metadata": {"doc_id": "2"}}, vector=[0.2])],
        None,
    )
    docs = vector.search_by_full_text("query", top_k=1, document_ids_filter=["doc-a"])
    assert len(docs) == 1
    assert docs[0].page_content == "doc-b"

    local_client = tidb_vector_module.QdrantLocal()
    vector._client = local_client
    vector._reload_if_needed()
    local_client._load.assert_called_once()

    doc = vector._document_from_scored_point(
        SimpleNamespace(payload={"page_content": "doc", "metadata": {"doc_id": "x"}}, vector=[0.3]),
        "page_content",
        "metadata",
    )
    assert doc.page_content == "doc"


def test_tidb_qdrant_factory_branches(tidb_vector_module, monkeypatch):
    factory = tidb_vector_module.TidbOnQdrantVectorFactory()
    dataset = SimpleNamespace(
        id="dataset-1",
        tenant_id="tenant-1",
        index_struct_dict=None,
        index_struct=None,
    )
    monkeypatch.setattr(tidb_vector_module, "select", lambda _model: SimpleNamespace(where=lambda *_args: "stmt"))
    monkeypatch.setattr(tidb_vector_module, "current_app", SimpleNamespace(config=SimpleNamespace(root_path="/root")))
    monkeypatch.setattr(tidb_vector_module.dify_config, "TIDB_ON_QDRANT_URL", "http://localhost:6333")
    monkeypatch.setattr(tidb_vector_module.dify_config, "TIDB_ON_QDRANT_CLIENT_TIMEOUT", 20)
    monkeypatch.setattr(tidb_vector_module.dify_config, "TIDB_ON_QDRANT_GRPC_PORT", 6334)
    monkeypatch.setattr(tidb_vector_module.dify_config, "TIDB_ON_QDRANT_GRPC_ENABLED", False)
    monkeypatch.setattr(tidb_vector_module.dify_config, "QDRANT_REPLICATION_FACTOR", 1)
    monkeypatch.setattr(tidb_vector_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")

    # direct auth binding exists
    tidb_vector_module.db.session.scalars = MagicMock(
        return_value=SimpleNamespace(one_or_none=lambda: SimpleNamespace(account="user", password="pass"))
    )
    with patch.object(tidb_vector_module, "TidbOnQdrantVector", return_value="vector") as vector_cls:
        result = factory.init_vector(dataset, attributes=[], embeddings=MagicMock())
    assert result == "vector"
    assert vector_cls.call_args.kwargs["config"].api_key == "user:pass"

    # no auth binding -> consume idle cluster
    tidb_vector_module.db.session.scalars = MagicMock(
        side_effect=[
            SimpleNamespace(one_or_none=lambda: None),
            SimpleNamespace(one_or_none=lambda: None),
        ]
    )
    idle = SimpleNamespace(account="idle-user", password="idle-pass", active=False, tenant_id=None, status="ACTIVE")
    query_chain = SimpleNamespace(
        where=lambda *_args, **_kwargs: SimpleNamespace(limit=lambda _n: SimpleNamespace(one_or_none=lambda: idle))
    )
    tidb_vector_module.db.session.query = MagicMock(return_value=query_chain)
    tidb_vector_module.db.session.commit = MagicMock()
    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(tidb_vector_module.redis_client, "lock", MagicMock(return_value=lock))
    with patch.object(tidb_vector_module, "TidbOnQdrantVector", return_value="vector") as vector_cls:
        factory.init_vector(dataset, attributes=[], embeddings=MagicMock())
    assert vector_cls.call_args.kwargs["config"].api_key == "idle-user:idle-pass"

    # no idle -> create new cluster
    tidb_vector_module.db.session.scalars = MagicMock(
        side_effect=[
            SimpleNamespace(one_or_none=lambda: None),
            SimpleNamespace(one_or_none=lambda: None),
        ]
    )
    query_chain = SimpleNamespace(
        where=lambda *_args, **_kwargs: SimpleNamespace(limit=lambda _n: SimpleNamespace(one_or_none=lambda: None))
    )
    tidb_vector_module.db.session.query = MagicMock(return_value=query_chain)
    tidb_vector_module.db.session.add = MagicMock()
    tidb_vector_module.db.session.commit = MagicMock()

    class _Binding:
        tenant_id = "tenant_id"
        active = "active"
        status = "status"

        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    monkeypatch.setattr(tidb_vector_module, "TidbAuthBinding", _Binding)
    monkeypatch.setattr(
        tidb_vector_module.TidbService,
        "create_tidb_serverless_cluster",
        MagicMock(
            return_value={
                "cluster_id": "c1",
                "cluster_name": "cluster",
                "account": "new-user",
                "password": "new-pass",
            }
        ),
    )
    with patch.object(tidb_vector_module, "TidbOnQdrantVector", return_value="vector") as vector_cls:
        factory.init_vector(dataset, attributes=[], embeddings=MagicMock())
    assert vector_cls.call_args.kwargs["config"].api_key == "new-user:new-pass"


def test_tidb_vector_factory_http_helpers(tidb_vector_module):
    factory = tidb_vector_module.TidbOnQdrantVectorFactory()
    tidb_config = tidb_vector_module.TidbConfig(api_url="http://api", public_key="pk", private_key="sk")

    response = SimpleNamespace(status_code=200, json=lambda: {"ok": True}, raise_for_status=MagicMock())
    with patch.object(tidb_vector_module.httpx, "post", return_value=response):
        assert factory.create_tidb_serverless_cluster(tidb_config, "cluster", "us-west") == {"ok": True}

    response = SimpleNamespace(status_code=400, raise_for_status=MagicMock())
    with patch.object(tidb_vector_module.httpx, "post", return_value=response):
        factory.create_tidb_serverless_cluster(tidb_config, "cluster", "us-west")
    response.raise_for_status.assert_called_once()

    response = SimpleNamespace(status_code=200, json=lambda: {"ok": True}, raise_for_status=MagicMock())
    with patch.object(tidb_vector_module.httpx, "put", return_value=response):
        assert factory.change_tidb_serverless_root_password(tidb_config, "cluster-1", "new-password") == {"ok": True}

    response = SimpleNamespace(status_code=500, raise_for_status=MagicMock())
    with patch.object(tidb_vector_module.httpx, "put", return_value=response):
        factory.change_tidb_serverless_root_password(tidb_config, "cluster-1", "new-password")
    response.raise_for_status.assert_called_once()


def test_tidb_service_methods(tidb_service_module, monkeypatch):
    # create cluster success path
    post_resp = SimpleNamespace(status_code=200, json=lambda: {"clusterId": "c1"}, raise_for_status=MagicMock())
    get_resp = {"state": "ACTIVE", "userPrefix": "prefix"}
    monkeypatch.setattr(tidb_service_module.httpx, "post", MagicMock(return_value=post_resp))
    original_get_cluster = tidb_service_module.TidbService.get_tidb_serverless_cluster
    monkeypatch.setattr(
        tidb_service_module.TidbService, "get_tidb_serverless_cluster", MagicMock(return_value=get_resp)
    )
    monkeypatch.setattr(tidb_service_module.time, "sleep", MagicMock())
    result = tidb_service_module.TidbService.create_tidb_serverless_cluster(
        "proj", "http://api", "http://iam", "pk", "sk", "us-west"
    )
    assert result["account"] == "prefix.root"

    post_resp = SimpleNamespace(status_code=500, raise_for_status=MagicMock())
    monkeypatch.setattr(tidb_service_module.httpx, "post", MagicMock(return_value=post_resp))
    tidb_service_module.TidbService.create_tidb_serverless_cluster(
        "proj", "http://api", "http://iam", "pk", "sk", "us-west"
    )
    post_resp.raise_for_status.assert_called_once()
    monkeypatch.setattr(tidb_service_module.TidbService, "get_tidb_serverless_cluster", original_get_cluster)

    # delete/get/change helpers
    delete_resp = SimpleNamespace(status_code=200, json=lambda: {"deleted": True}, raise_for_status=MagicMock())
    monkeypatch.setattr(tidb_service_module.httpx, "delete", MagicMock(return_value=delete_resp))
    assert tidb_service_module.TidbService.delete_tidb_serverless_cluster("http://api", "pk", "sk", "c1") == {
        "deleted": True
    }

    get_resp = SimpleNamespace(status_code=200, json=lambda: {"clusterId": "c1"}, raise_for_status=MagicMock())
    monkeypatch.setattr(tidb_service_module.httpx, "get", MagicMock(return_value=get_resp))
    assert tidb_service_module.TidbService.get_tidb_serverless_cluster("http://api", "pk", "sk", "c1") == {
        "clusterId": "c1"
    }

    patch_resp = SimpleNamespace(status_code=200, json=lambda: {"updated": True}, raise_for_status=MagicMock())
    monkeypatch.setattr(tidb_service_module.httpx, "patch", MagicMock(return_value=patch_resp))
    assert tidb_service_module.TidbService.change_tidb_serverless_root_password(
        "http://api", "pk", "sk", "c1", "root", "new-password"
    ) == {"updated": True}

    # batch status update
    cluster = SimpleNamespace(cluster_id="c1", status="PENDING", account="")
    list_resp = SimpleNamespace(
        status_code=200, json=lambda: {"clusters": [{"clusterId": "c1", "state": "ACTIVE", "userPrefix": "up"}]}
    )
    monkeypatch.setattr(tidb_service_module.httpx, "get", MagicMock(return_value=list_resp))
    tidb_service_module.db.session.add = MagicMock()
    tidb_service_module.db.session.commit = MagicMock()
    tidb_service_module.TidbService.batch_update_tidb_serverless_cluster_status(
        [cluster], "proj", "http://api", "http://iam", "pk", "sk"
    )
    assert cluster.status == "ACTIVE"
    assert cluster.account == "up.root"
    tidb_service_module.db.session.commit.assert_called_once()

    # batch create
    monkeypatch.setattr(tidb_service_module.redis_client, "setex", MagicMock())
    monkeypatch.setattr(tidb_service_module.redis_client, "get", MagicMock(return_value=b"pwd"))
    create_resp = SimpleNamespace(
        status_code=200,
        json=lambda: {"clusters": [{"clusterId": "c1", "displayName": "display"}]},
        raise_for_status=MagicMock(),
    )
    monkeypatch.setattr(tidb_service_module.httpx, "post", MagicMock(return_value=create_resp))
    created = tidb_service_module.TidbService.batch_create_tidb_serverless_cluster(
        1, "proj", "http://api", "http://iam", "pk", "sk", "us-west"
    )
    assert created[0]["password"] == "pwd"

    bad_resp = SimpleNamespace(status_code=500, raise_for_status=MagicMock())
    monkeypatch.setattr(tidb_service_module.httpx, "post", MagicMock(return_value=bad_resp))
    assert (
        tidb_service_module.TidbService.batch_create_tidb_serverless_cluster(
            1, "proj", "http://api", "http://iam", "pk", "sk", "us-west"
        )
        == []
    )
