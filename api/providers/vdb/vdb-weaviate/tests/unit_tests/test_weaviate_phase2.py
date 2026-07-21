"""Unit tests for Phase 2 Weaviate features: multi-tenancy, compression, and advanced index types.

Covers:
- Vector index config building (hnsw/flat/dynamic) and the flat+non-BQ constraint
- Quantizer building for each compression mode
- Tenant-scoped collection access, tenant ensure/remove, and index-struct persistence
- Factory layout selection (multi-tenant vs legacy) and backward compatibility
"""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from dify_vdb_weaviate import weaviate_vector as weaviate_vector_module
from dify_vdb_weaviate.weaviate_vector import WeaviateVector


def _bare_vector(collection_name="Shared_Node", tenant=None, client=None):
    """Builds a WeaviateVector without running __init__ (no client connection)."""
    wv = WeaviateVector.__new__(WeaviateVector)
    wv._collection_name = collection_name
    wv._client = client or MagicMock()
    wv._attributes = ["doc_id", "document_id", "doc_type"]
    wv._tenant = tenant
    return wv


class TestVectorIndexConfig(unittest.TestCase):
    """Tests for _build_vector_index_config / _build_quantizer."""

    def _patch_config(self, **overrides):
        defaults = {
            "WEAVIATE_INDEX_TYPE": "hnsw",
            "WEAVIATE_COMPRESSION": None,
            "WEAVIATE_DISTANCE_METRIC": "cosine",
            "WEAVIATE_DYNAMIC_INDEX_THRESHOLD": 10000,
            "WEAVIATE_RQ_BITS": None,
            "WEAVIATE_PQ_SEGMENTS": None,
            "WEAVIATE_PQ_TRAINING_LIMIT": None,
            "WEAVIATE_SQ_TRAINING_LIMIT": None,
            "WEAVIATE_COMPRESSION_CACHE": None,
        }
        defaults.update(overrides)
        return [patch.object(weaviate_vector_module.dify_config, k, v) for k, v in defaults.items()]

    def _build_index(self, **overrides):
        wv = _bare_vector()
        patches = self._patch_config(**overrides)
        for p in patches:
            p.start()
        try:
            return wv._build_vector_index_config()
        finally:
            for p in patches:
                p.stop()

    def _build_quantizer(self, **overrides):
        wv = _bare_vector()
        patches = self._patch_config(**overrides)
        for p in patches:
            p.start()
        try:
            return wv._build_quantizer()
        finally:
            for p in patches:
                p.stop()

    def test_hnsw_index_no_compression(self):
        cfg = self._build_index(WEAVIATE_INDEX_TYPE="hnsw")
        assert "HNSW" in type(cfg).__name__
        assert cfg.quantizer is None

    def test_flat_index(self):
        cfg = self._build_index(WEAVIATE_INDEX_TYPE="flat")
        assert "Flat" in type(cfg).__name__

    def test_dynamic_index_sets_threshold(self):
        cfg = self._build_index(WEAVIATE_INDEX_TYPE="dynamic", WEAVIATE_DYNAMIC_INDEX_THRESHOLD=5000)
        assert "Dynamic" in type(cfg).__name__
        assert cfg.threshold == 5000

    def test_hnsw_with_rq_compression_attaches_quantizer(self):
        cfg = self._build_index(WEAVIATE_INDEX_TYPE="hnsw", WEAVIATE_COMPRESSION="rq")
        assert cfg.quantizer is not None

    def test_flat_index_rejects_non_bq_compression(self):
        with pytest.raises(ValueError, match="flat Weaviate index supports only 'bq'"):
            self._build_index(WEAVIATE_INDEX_TYPE="flat", WEAVIATE_COMPRESSION="rq")

    def test_flat_index_allows_bq_compression(self):
        cfg = self._build_index(WEAVIATE_INDEX_TYPE="flat", WEAVIATE_COMPRESSION="bq")
        assert "Flat" in type(cfg).__name__
        assert cfg.quantizer is not None

    def test_unknown_index_type_raises(self):
        with pytest.raises(ValueError, match="Unsupported WEAVIATE_INDEX_TYPE"):
            self._build_index(WEAVIATE_INDEX_TYPE="galactic")

    def test_quantizer_none_when_no_compression(self):
        assert self._build_quantizer(WEAVIATE_COMPRESSION=None) is None
        assert self._build_quantizer(WEAVIATE_COMPRESSION="none") is None

    def test_quantizer_built_for_each_mode(self):
        for mode in ("rq", "pq", "bq", "sq"):
            assert self._build_quantizer(WEAVIATE_COMPRESSION=mode) is not None, mode

    def test_unknown_compression_raises(self):
        with pytest.raises(ValueError, match="Unsupported WEAVIATE_COMPRESSION"):
            self._build_quantizer(WEAVIATE_COMPRESSION="zip")


class TestWeaviateMultiTenancy(unittest.TestCase):
    """Tests for tenant-scoped data access and tenant lifecycle."""

    def test_collection_scopes_to_tenant_when_set(self):
        wv = _bare_vector(tenant="ds-1")
        result = wv._collection()
        wv._client.collections.use.assert_called_once_with("Shared_Node")
        wv._client.collections.use.return_value.with_tenant.assert_called_once_with("ds-1")
        assert result is wv._client.collections.use.return_value.with_tenant.return_value

    def test_collection_unscoped_without_tenant(self):
        wv = _bare_vector(tenant=None)
        result = wv._collection()
        wv._client.collections.use.assert_called_once_with("Shared_Node")
        wv._client.collections.use.return_value.with_tenant.assert_not_called()
        assert result is wv._client.collections.use.return_value

    def test_delete_removes_tenant_not_collection_under_mt(self):
        wv = _bare_vector(tenant="ds-1")
        wv._client.collections.exists.return_value = True
        mock_col = wv._client.collections.use.return_value

        wv.delete()

        mock_col.tenants.remove.assert_called_once_with("ds-1")
        wv._client.collections.delete.assert_not_called()

    def test_delete_removes_collection_without_tenant(self):
        wv = _bare_vector(tenant=None)
        wv._client.collections.exists.return_value = True

        wv.delete()

        wv._client.collections.delete.assert_called_once_with("Shared_Node")

    def test_ensure_tenant_creates_missing_tenant(self):
        wv = _bare_vector(tenant="ds-1")
        wv._client.collections.exists.return_value = True
        mock_col = wv._client.collections.use.return_value
        mock_col.tenants.exists.return_value = False

        wv._ensure_tenant()

        mock_col.tenants.create.assert_called_once_with("ds-1")

    def test_ensure_tenant_skips_existing_tenant(self):
        wv = _bare_vector(tenant="ds-1")
        wv._client.collections.exists.return_value = True
        mock_col = wv._client.collections.use.return_value
        mock_col.tenants.exists.return_value = True

        wv._ensure_tenant()

        mock_col.tenants.create.assert_not_called()

    def test_ensure_tenant_noop_without_tenant(self):
        wv = _bare_vector(tenant=None)
        wv._ensure_tenant()
        wv._client.collections.exists.assert_not_called()

    def test_to_index_struct_records_tenant(self):
        wv = _bare_vector(collection_name="Shared_Node", tenant="ds-1")
        assert wv.to_index_struct() == {
            "type": weaviate_vector_module.VectorType.WEAVIATE,
            "vector_store": {"class_prefix": "Shared_Node", "multi_tenant": True, "tenant": "ds-1"},
        }

    def test_to_index_struct_legacy_has_no_tenant_keys(self):
        wv = _bare_vector(collection_name="Legacy_Node", tenant=None)
        assert wv.to_index_struct() == {
            "type": weaviate_vector_module.VectorType.WEAVIATE,
            "vector_store": {"class_prefix": "Legacy_Node"},
        }


class TestWeaviateFactoryMultiTenancy(unittest.TestCase):
    """Tests for layout selection in WeaviateVectorFactory.init_vector."""

    def _common_config_patches(self):
        return [
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_ENDPOINT", "http://localhost:8080"),
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_GRPC_ENDPOINT", ""),
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_API_KEY", None),
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_BATCH_SIZE", 100),
            patch.object(weaviate_vector_module.dify_config, "VECTOR_INDEX_NAME_PREFIX", "Vector_index"),
        ]

    def test_new_dataset_uses_shared_collection_and_tenant_when_mt_enabled(self):
        dataset = SimpleNamespace(
            id="dataset-3",
            index_struct_dict=None,
            index_struct=None,
            embedding_model="text-embedding-3-small",
            embedding_model_provider="openai",
        )
        patches = self._common_config_patches() + [
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_MULTI_TENANCY_ENABLED", True),
            patch("dify_vdb_weaviate.weaviate_vector.WeaviateVector", return_value="vector"),
        ]
        for p in patches:
            p.start()
        try:
            factory = weaviate_vector_module.WeaviateVectorFactory()
            mock_vector = weaviate_vector_module.WeaviateVector
            factory.init_vector(dataset, ["doc_id"], MagicMock())

            kwargs = mock_vector.call_args.kwargs
            assert kwargs["collection_name"].startswith("Vector_index_shared_")
            assert kwargs["collection_name"].endswith("_Node")
            assert kwargs["tenant"] == "dataset-3"

            index_struct = json.loads(dataset.index_struct)
            assert index_struct["vector_store"]["multi_tenant"] is True
            assert index_struct["vector_store"]["tenant"] == "dataset-3"
            assert index_struct["vector_store"]["class_prefix"] == kwargs["collection_name"]
        finally:
            for p in patches:
                p.stop()

    def test_new_dataset_uses_legacy_layout_when_mt_disabled(self):
        dataset = SimpleNamespace(
            id="dataset-4",
            index_struct_dict=None,
            index_struct=None,
            embedding_model="m",
            embedding_model_provider="p",
        )
        patches = self._common_config_patches() + [
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_MULTI_TENANCY_ENABLED", False),
            patch.object(
                weaviate_vector_module.Dataset, "gen_collection_name_by_id", return_value="GeneratedCollection_Node"
            ),
            patch("dify_vdb_weaviate.weaviate_vector.WeaviateVector", return_value="vector"),
        ]
        for p in patches:
            p.start()
        try:
            factory = weaviate_vector_module.WeaviateVectorFactory()
            mock_vector = weaviate_vector_module.WeaviateVector
            factory.init_vector(dataset, ["doc_id"], MagicMock())

            kwargs = mock_vector.call_args.kwargs
            assert kwargs["collection_name"] == "GeneratedCollection_Node"
            assert kwargs["tenant"] is None
            assert json.loads(dataset.index_struct)["vector_store"] == {"class_prefix": "GeneratedCollection_Node"}
        finally:
            for p in patches:
                p.stop()

    def test_existing_multi_tenant_dataset_reuses_tenant(self):
        dataset = SimpleNamespace(
            id="dataset-5",
            index_struct_dict={
                "vector_store": {"class_prefix": "Vector_index_shared_abc_Node", "multi_tenant": True, "tenant": "ds-5"}
            },
            index_struct=None,
            embedding_model="m",
            embedding_model_provider="p",
        )
        patches = self._common_config_patches() + [
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_MULTI_TENANCY_ENABLED", True),
            patch("dify_vdb_weaviate.weaviate_vector.WeaviateVector", return_value="vector"),
        ]
        for p in patches:
            p.start()
        try:
            factory = weaviate_vector_module.WeaviateVectorFactory()
            mock_vector = weaviate_vector_module.WeaviateVector
            factory.init_vector(dataset, ["doc_id"], MagicMock())

            kwargs = mock_vector.call_args.kwargs
            assert kwargs["collection_name"] == "Vector_index_shared_abc_Node"
            assert kwargs["tenant"] == "ds-5"
            assert dataset.index_struct is None  # existing struct is not rewritten
        finally:
            for p in patches:
                p.stop()

    def test_existing_legacy_dataset_stays_non_tenant_even_when_mt_enabled(self):
        dataset = SimpleNamespace(
            id="dataset-6",
            index_struct_dict={"vector_store": {"class_prefix": "Legacy_Node"}},
            index_struct=None,
            embedding_model="m",
            embedding_model_provider="p",
        )
        patches = self._common_config_patches() + [
            patch.object(weaviate_vector_module.dify_config, "WEAVIATE_MULTI_TENANCY_ENABLED", True),
            patch("dify_vdb_weaviate.weaviate_vector.WeaviateVector", return_value="vector"),
        ]
        for p in patches:
            p.start()
        try:
            factory = weaviate_vector_module.WeaviateVectorFactory()
            mock_vector = weaviate_vector_module.WeaviateVector
            factory.init_vector(dataset, ["doc_id"], MagicMock())

            kwargs = mock_vector.call_args.kwargs
            assert kwargs["collection_name"] == "Legacy_Node"
            assert kwargs["tenant"] is None
        finally:
            for p in patches:
                p.stop()


class TestWeaviateCreateCollectionMultiTenancy(unittest.TestCase):
    """Tests that _create_collection wires multi-tenancy config and ensures the tenant."""

    @patch("dify_vdb_weaviate.weaviate_vector.redis_client")
    @patch("dify_vdb_weaviate.weaviate_vector.dify_config")
    def test_create_collection_sets_mt_config_and_creates_tenant(self, mock_dify_config, mock_redis):
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock(return_value=False)
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = None

        mock_dify_config.WEAVIATE_TOKENIZATION = None
        mock_dify_config.WEAVIATE_INDEX_TYPE = "hnsw"
        mock_dify_config.WEAVIATE_COMPRESSION = None
        mock_dify_config.WEAVIATE_DISTANCE_METRIC = "cosine"
        mock_dify_config.WEAVIATE_REPLICATION_FACTOR = 1

        client = MagicMock()
        # exists() calls: create-guard (False), _ensure_properties (False), _ensure_tenant (True)
        client.collections.exists.side_effect = [False, False, True]
        mock_col = client.collections.use.return_value
        mock_col.tenants.exists.return_value = False

        wv = _bare_vector(collection_name="Shared_Node", tenant="ds-1", client=client)
        wv._create_collection()

        create_kwargs = client.collections.create.call_args.kwargs
        assert create_kwargs["multi_tenancy_config"] is not None
        mock_col.tenants.create.assert_called_once_with("ds-1")
        # Cache key is tenant-scoped so other datasets sharing the collection are not skipped.
        assert mock_redis.set.call_args.args[0] == "vector_indexing_Shared_Node_ds-1"

    @patch("dify_vdb_weaviate.weaviate_vector.redis_client")
    @patch("dify_vdb_weaviate.weaviate_vector.dify_config")
    def test_create_collection_no_mt_config_without_tenant(self, mock_dify_config, mock_redis):
        mock_lock = MagicMock()
        mock_lock.__enter__ = MagicMock()
        mock_lock.__exit__ = MagicMock(return_value=False)
        mock_redis.lock.return_value = mock_lock
        mock_redis.get.return_value = None

        mock_dify_config.WEAVIATE_TOKENIZATION = None
        mock_dify_config.WEAVIATE_INDEX_TYPE = "hnsw"
        mock_dify_config.WEAVIATE_COMPRESSION = None
        mock_dify_config.WEAVIATE_DISTANCE_METRIC = "cosine"
        mock_dify_config.WEAVIATE_REPLICATION_FACTOR = 1

        client = MagicMock()
        client.collections.exists.return_value = False
        mock_cfg = MagicMock()
        mock_cfg.properties = []
        client.collections.use.return_value.config.get.return_value = mock_cfg

        wv = _bare_vector(collection_name="Legacy_Node", tenant=None, client=client)
        wv._create_collection()

        create_kwargs = client.collections.create.call_args.kwargs
        assert create_kwargs["multi_tenancy_config"] is None
        client.collections.use.return_value.tenants.create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
