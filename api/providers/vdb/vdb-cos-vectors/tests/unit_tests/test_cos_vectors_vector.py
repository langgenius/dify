import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from core.rag.models.document import Document


class _FakeCosServiceError(Exception):
    def __init__(self, status_code: int = 500, message: str = ""):
        super().__init__(message or f"status_code={status_code}")
        self._status_code = status_code

    def get_status_code(self) -> int:
        return self._status_code


def _build_fake_qcloud_modules():
    qcloud_cos = types.ModuleType("qcloud_cos")
    qcloud_cos_exception = types.ModuleType("qcloud_cos.cos_exception")
    qcloud_cos_vectors = types.ModuleType("qcloud_cos.cos_vectors_client")

    class _CosConfig:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class _CosVectorsClient:
        def __init__(self, config):
            self.config = config
            self.get_vector_bucket = MagicMock(return_value=({}, {}))
            self.create_vector_bucket = MagicMock(return_value=({}, {}))
            self.get_index = MagicMock(return_value=({}, {}))
            self.create_index = MagicMock(return_value=({}, {}))
            self.delete_index = MagicMock(return_value={})
            self.put_vectors = MagicMock(return_value={})
            self.get_vectors = MagicMock(return_value=({}, {"vectors": []}))
            self.list_vectors = MagicMock(return_value=({}, {"vectors": []}))
            self.delete_vectors = MagicMock(return_value={})
            self.query_vectors = MagicMock(return_value=({}, {"vectors": []}))

    qcloud_cos.CosConfig = _CosConfig
    qcloud_cos_exception.CosServiceError = _FakeCosServiceError
    qcloud_cos_vectors.CosVectorsClient = _CosVectorsClient

    return {
        "qcloud_cos": qcloud_cos,
        "qcloud_cos.cos_exception": qcloud_cos_exception,
        "qcloud_cos.cos_vectors_client": qcloud_cos_vectors,
    }


@pytest.fixture
def cos_vectors_module(monkeypatch):
    for name, module in _build_fake_qcloud_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_cos_vectors.cos_vectors_vector as module

    return importlib.reload(module)


def _config(module, **overrides):
    values = {
        "region": "ap-beijing",
        "secret_id": "sid",
        "secret_key": "skey",
        "bucket_appid": "bucket-1250000000",
        "token": None,
        "scheme": "https",
        "endpoint": None,
        "timeout": 30,
        "distance_metric": "cosine",
        "data_type": "float32",
        "max_upsert_batch_size": 2,
        "non_filterable_metadata_keys": ["text"],
    }
    values.update(overrides)
    return module.COSVectorsConfig.model_validate(values)


def _make_vector(module, **overrides):
    """Return a COSVectorsVector with bucket-existence check already short-circuited."""
    config = _config(module, **overrides)
    # Bypass bucket ensure; we only want to test the per-index logic.
    with patch.object(module.COSVectorsVector, "_ensure_bucket", lambda self: None):
        return module.COSVectorsVector("collection_1", config)


def test_config_to_cos_config(cos_vectors_module):
    config = _config(cos_vectors_module, endpoint="cos-vectors.ap-beijing.myqcloud.com", timeout=45)
    cos_config = config.to_cos_config()
    assert cos_config.kwargs["Region"] == "ap-beijing"
    assert cos_config.kwargs["SecretId"] == "sid"
    assert cos_config.kwargs["SecretKey"] == "skey"
    assert cos_config.kwargs["Scheme"] == "https"
    assert cos_config.kwargs["Endpoint"] == "cos-vectors.ap-beijing.myqcloud.com"
    assert cos_config.kwargs["Timeout"] == 45


def test_ensure_bucket_creates_when_missing(cos_vectors_module, monkeypatch):
    config = _config(cos_vectors_module)
    client_instance = cos_vectors_module.CosVectorsClient(config.to_cos_config())
    # First probe (outside lock) -> 404.
    # Second probe (inside lock, double-check) -> also 404 so we proceed to create.
    client_instance.get_vector_bucket.side_effect = [
        _FakeCosServiceError(status_code=404),
        _FakeCosServiceError(status_code=404),
    ]
    client_instance.create_vector_bucket.return_value = ({}, {})

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(cos_vectors_module.redis_client, "get", MagicMock(return_value=None))
    monkeypatch.setattr(cos_vectors_module.redis_client, "set", MagicMock())
    with (
        patch.object(cos_vectors_module, "CosVectorsClient", return_value=client_instance),
        patch.object(cos_vectors_module.redis_client, "lock", MagicMock(return_value=lock)),
    ):
        vector = cos_vectors_module.COSVectorsVector("collection_1", config)

    assert vector._client is client_instance
    client_instance.create_vector_bucket.assert_called_once_with(Bucket="bucket-1250000000")
    # Cache is populated after creation so subsequent init_vector calls skip the HEAD.
    cos_vectors_module.redis_client.set.assert_called()


def test_ensure_bucket_short_circuits_on_cache_hit(cos_vectors_module, monkeypatch):
    config = _config(cos_vectors_module)
    client_instance = cos_vectors_module.CosVectorsClient(config.to_cos_config())
    # Cache hit means we must not HEAD the bucket nor try to create it.
    monkeypatch.setattr(cos_vectors_module.redis_client, "get", MagicMock(return_value=1))
    monkeypatch.setattr(cos_vectors_module.redis_client, "set", MagicMock())
    monkeypatch.setattr(cos_vectors_module.redis_client, "lock", MagicMock())
    with patch.object(cos_vectors_module, "CosVectorsClient", return_value=client_instance):
        cos_vectors_module.COSVectorsVector("collection_1", config)

    client_instance.get_vector_bucket.assert_not_called()
    client_instance.create_vector_bucket.assert_not_called()
    cos_vectors_module.redis_client.lock.assert_not_called()


def test_ensure_bucket_exists_without_cache(cos_vectors_module, monkeypatch):
    config = _config(cos_vectors_module)
    client_instance = cos_vectors_module.CosVectorsClient(config.to_cos_config())
    client_instance.get_vector_bucket.return_value = ({}, {})  # bucket already exists
    monkeypatch.setattr(cos_vectors_module.redis_client, "get", MagicMock(return_value=None))
    set_mock = MagicMock()
    monkeypatch.setattr(cos_vectors_module.redis_client, "set", set_mock)
    monkeypatch.setattr(cos_vectors_module.redis_client, "lock", MagicMock())
    with patch.object(cos_vectors_module, "CosVectorsClient", return_value=client_instance):
        cos_vectors_module.COSVectorsVector("collection_1", config)

    # First HEAD succeeds; we do NOT need to acquire the lock.
    client_instance.get_vector_bucket.assert_called_once()
    client_instance.create_vector_bucket.assert_not_called()
    cos_vectors_module.redis_client.lock.assert_not_called()
    set_mock.assert_called_once()


def test_ensure_bucket_reraises_non_404(cos_vectors_module, monkeypatch):
    config = _config(cos_vectors_module)
    client_instance = cos_vectors_module.CosVectorsClient(config.to_cos_config())
    client_instance.get_vector_bucket.side_effect = _FakeCosServiceError(status_code=500)
    monkeypatch.setattr(cos_vectors_module.redis_client, "get", MagicMock(return_value=None))

    with (
        patch.object(cos_vectors_module, "CosVectorsClient", return_value=client_instance),
        pytest.raises(_FakeCosServiceError),
    ):
        cos_vectors_module.COSVectorsVector("collection_1", config)


def test_create_index_branches(cos_vectors_module, monkeypatch):
    vector = _make_vector(cos_vectors_module)

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(cos_vectors_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(cos_vectors_module.redis_client, "set", MagicMock())

    # Already cached -> short circuit
    monkeypatch.setattr(cos_vectors_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_index(8)
    vector._client.create_index.assert_not_called()

    # Index already exists remotely -> no create, but cache is refreshed
    monkeypatch.setattr(cos_vectors_module.redis_client, "get", MagicMock(return_value=None))
    vector._client.get_index.return_value = ({}, {})
    vector._create_index(8)
    vector._client.create_index.assert_not_called()

    # Index missing remotely -> create_index called
    vector._client.get_index.side_effect = _FakeCosServiceError(status_code=404)
    vector._create_index(8)
    vector._client.create_index.assert_called_once()
    call = vector._client.create_index.call_args.kwargs
    assert call["Bucket"] == "bucket-1250000000"
    assert call["Index"] == "collection_1"
    assert call["Dimension"] == 8
    assert call["DistanceMetric"] == "cosine"
    assert call["DataType"] == "float32"
    assert call["NonFilterableMetadataKeys"] == ["text"]


def test_add_texts_batches_and_skips_missing_doc_id(cos_vectors_module, caplog):
    vector = _make_vector(cos_vectors_module)
    docs = [
        Document(page_content="a", metadata={"doc_id": "k1", "document_id": "d1"}),
        Document(page_content="b", metadata={"doc_id": "k2", "document_id": "d1"}),
        Document(page_content="c", metadata={"doc_id": "k3", "document_id": "d2"}),
        # page_content must always win over a pre-existing metadata["text"]
        Document(page_content="real", metadata={"doc_id": "k4", "text": "old-bogus"}),
        Document(page_content="d", metadata={}),  # no doc_id -> skipped
    ]
    embeddings = [[0.1], [0.2], [0.3], [0.4], [0.5]]
    vector.add_texts(docs, embeddings)

    # batch_size=2, 4 valid vectors -> 2 batches of [2,2]
    assert vector._client.put_vectors.call_count == 2
    first_call = vector._client.put_vectors.call_args_list[0].kwargs
    assert first_call["Bucket"] == "bucket-1250000000"
    assert first_call["Index"] == "collection_1"
    assert [v["key"] for v in first_call["Vectors"]] == ["k1", "k2"]
    assert first_call["Vectors"][0]["data"] == {"float32": [0.1]}
    assert first_call["Vectors"][0]["metadata"]["text"] == "a"
    assert first_call["Vectors"][0]["metadata"]["document_id"] == "d1"
    # page_content overrides any metadata["text"] the caller provided
    second_call = vector._client.put_vectors.call_args_list[1].kwargs
    k4 = next(v for v in second_call["Vectors"] if v["key"] == "k4")
    assert k4["metadata"]["text"] == "real"


def test_create_invokes_create_index_and_add_texts(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    vector._create_index = MagicMock()
    vector.add_texts = MagicMock()

    docs = [Document(page_content="a", metadata={"doc_id": "k1"})]
    vector.create(docs, [[0.1, 0.2, 0.3]])

    vector._create_index.assert_called_once_with(3)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2, 0.3]])


def test_text_exists_branches(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    vector._client.get_vectors.return_value = ({}, {"vectors": [{"key": "k1"}]})
    assert vector.text_exists("k1") is True

    vector._client.get_vectors.return_value = ({}, {"vectors": []})
    assert vector.text_exists("k1") is False

    vector._client.get_vectors.side_effect = _FakeCosServiceError(status_code=404)
    assert vector.text_exists("k1") is False

    vector._client.get_vectors.side_effect = _FakeCosServiceError(status_code=500)
    with pytest.raises(_FakeCosServiceError):
        vector.text_exists("k1")


def test_delete_by_ids_batches_and_handles_404(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    # batch_size=2 -> expect two calls
    vector.delete_by_ids(["k1", "k2", "k3"])
    assert vector._client.delete_vectors.call_count == 2

    # Empty input: no call
    vector._client.delete_vectors.reset_mock()
    vector.delete_by_ids([])
    vector._client.delete_vectors.assert_not_called()

    # 404 on one batch is tolerated — subsequent batches still run
    vector._client.delete_vectors.reset_mock()
    vector._client.delete_vectors.side_effect = _FakeCosServiceError(status_code=404)
    vector.delete_by_ids(["x1", "x2", "x3"])
    assert vector._client.delete_vectors.call_count == 2

    # Non-404 re-raises
    vector._client.delete_vectors.reset_mock()
    vector._client.delete_vectors.side_effect = _FakeCosServiceError(status_code=500)
    with pytest.raises(_FakeCosServiceError):
        vector.delete_by_ids(["y1"])


def test_get_ids_and_delete_by_metadata_field(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    # ListVectors paginates via NextToken; match filters are applied locally.
    vector._client.list_vectors.side_effect = [
        (
            {},
            {
                "vectors": [
                    {"key": "k1", "metadata": {"document_id": "d1"}},
                    {"key": "k2", "metadata": {"document_id": "d2"}},
                ],
                "NextToken": "tok1",
            },
        ),
        (
            {},
            {
                "vectors": [
                    {"key": "k3", "metadata": {"document_id": "d1"}},
                ]
            },
        ),
    ]

    ids = vector.get_ids_by_metadata_field("document_id", "d1")
    assert ids == ["k1", "k3"]
    assert vector._client.list_vectors.call_count == 2
    second_call = vector._client.list_vectors.call_args_list[1].kwargs
    assert second_call["NextToken"] == "tok1"
    assert second_call["ReturnMetaData"] is True

    # delete_by_metadata_field should chain into delete_by_ids
    vector._client.list_vectors.side_effect = [
        (
            {},
            {"vectors": [
                {"key": "k1", "metadata": {"document_id": "d1"}},
                {"key": "k3", "metadata": {"document_id": "d1"}},
            ]},
        ),
    ]
    vector.delete_by_metadata_field("document_id", "d1")
    assert set(vector._client.delete_vectors.call_args.kwargs["Keys"]) == {"k1", "k3"}


def test_get_ids_by_metadata_returns_empty_when_index_missing(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    vector._client.list_vectors.side_effect = _FakeCosServiceError(status_code=404)
    assert vector.get_ids_by_metadata_field("document_id", "d1") == []


def test_get_ids_by_metadata_paginates_until_next_token_empty(cos_vectors_module):
    """Pagination must continue as long as NextToken is returned."""
    vector = _make_vector(cos_vectors_module)
    vector._client.list_vectors.side_effect = [
        (
            {},
            {
                "vectors": [{"key": "k1", "metadata": {"document_id": "d1"}}],
                "NextToken": "tok1",
            },
        ),
        (
            {},
            {"vectors": [{"key": "k2", "metadata": {"document_id": "d1"}}]},
        ),
    ]
    assert vector.get_ids_by_metadata_field("document_id", "d1") == ["k1", "k2"]
    assert vector._client.list_vectors.call_count == 2


def test_search_by_vector_with_and_without_filter(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    vector._client.query_vectors.return_value = (
        {},
        {
            "vectors": [
                {"key": "k1", "distance": 0.1, "metadata": {"text": "hello", "document_id": "d1"}},
                {"key": "k2", "distance": 0.8, "metadata": {"text": "world", "document_id": "d2"}},
            ]
        },
    )

    docs = vector.search_by_vector([0.1, 0.2], top_k=5, score_threshold=0.5, document_ids_filter=["d1", "d2"])
    assert len(docs) == 1
    assert docs[0].page_content == "hello"
    assert docs[0].metadata["score"] == pytest.approx(0.9)

    sent = vector._client.query_vectors.call_args.kwargs
    assert sent["TopK"] == 5
    assert sent["Filter"] == {"document_id": {"$in": ["d1", "d2"]}}
    assert sent["QueryVector"] == {"float32": [0.1, 0.2]}
    assert sent["ReturnDistance"] is True
    assert sent["ReturnMetaData"] is True

    # No filter
    vector._client.query_vectors.reset_mock()
    vector._client.query_vectors.return_value = ({}, {"vectors": []})
    assert vector.search_by_vector([0.1, 0.2]) == []
    assert vector._client.query_vectors.call_args.kwargs["Filter"] is None

    # Empty query_vector short-circuits
    vector._client.query_vectors.reset_mock()
    assert vector.search_by_vector([]) == []
    vector._client.query_vectors.assert_not_called()


def test_search_by_vector_euclidean_score(cos_vectors_module):
    vector = _make_vector(cos_vectors_module, distance_metric="euclidean")
    vector._client.query_vectors.return_value = (
        {},
        {"vectors": [{"key": "k1", "distance": 1.0, "metadata": {"text": "x"}}]},
    )
    docs = vector.search_by_vector([0.1], score_threshold=0.0)
    assert docs[0].metadata["score"] == pytest.approx(0.5)  # 1 / (1 + 1)


def test_search_by_vector_missing_index_returns_empty(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    vector._client.query_vectors.side_effect = _FakeCosServiceError(status_code=404)
    assert vector.search_by_vector([0.1]) == []


def test_search_by_full_text_returns_empty(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    assert vector.search_by_full_text("anything") == []


def test_delete_drops_only_index(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    vector.delete()
    vector._client.delete_index.assert_called_once_with(Bucket="bucket-1250000000", Index="collection_1")

    # 404 tolerated
    vector._client.delete_index.side_effect = _FakeCosServiceError(status_code=404)
    vector.delete()

    # Non-404 re-raises
    vector._client.delete_index.side_effect = _FakeCosServiceError(status_code=500)
    with pytest.raises(_FakeCosServiceError):
        vector.delete()


def test_factory_uses_existing_and_generated_collection_names(cos_vectors_module, monkeypatch):
    factory = cos_vectors_module.COSVectorsFactory()
    dataset_existing = SimpleNamespace(
        id="ds-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_new = SimpleNamespace(id="ds-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(cos_vectors_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_REGION", "ap-beijing")
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_SECRET_ID", "sid")
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_SECRET_KEY", "skey")
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_BUCKET_APPID", "bucket-1250000000")
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_TOKEN", None)
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_SCHEME", "https")
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_ENDPOINT", None)
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_TIMEOUT", 30)
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_DISTANCE_METRIC", "cosine")
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_DATA_TYPE", "float32")
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_MAX_UPSERT_BATCH_SIZE", 500)
    monkeypatch.setattr(cos_vectors_module.dify_config, "COS_VECTORS_NON_FILTERABLE_METADATA_KEYS", "text,raw_text")

    with patch.object(cos_vectors_module, "COSVectorsVector", return_value="vector") as vector_cls:
        r1 = factory.init_vector(dataset_existing, attributes=[], embeddings=MagicMock())
        r2 = factory.init_vector(dataset_new, attributes=[], embeddings=MagicMock())

    assert r1 == "vector"
    assert r2 == "vector"
    # Underscores are invalid in COS Vectors index names, so they get normalized to '-'.
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing-collection"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto-collection"
    assert dataset_new.index_struct is not None
    cfg = vector_cls.call_args_list[0].kwargs["config"]
    assert cfg.non_filterable_metadata_keys == ["text", "raw_text"]
    assert cfg.region == "ap-beijing"
    assert cfg.bucket_appid == "bucket-1250000000"


def test_describe_index_returns_payload_or_none(cos_vectors_module):
    vector = _make_vector(cos_vectors_module)
    vector._client.get_index.return_value = ({}, {"indexName": "collection_1", "dimension": 1536})
    assert vector.describe_index() == {"indexName": "collection_1", "dimension": 1536}

    vector._client.get_index.side_effect = _FakeCosServiceError(status_code=404)
    assert vector.describe_index() is None

    vector._client.get_index.side_effect = _FakeCosServiceError(status_code=500)
    with pytest.raises(_FakeCosServiceError):
        vector.describe_index()
