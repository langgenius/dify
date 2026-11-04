import importlib
import json
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.datasource.vdb.field import Field
from core.rag.models.document import Document
from extensions import ext_redis
from models.dataset import Dataset


def _opensearch_build_fake_opensearch_modules():
    """Build fake opensearchpy modules to avoid the ``from events import Events``
    namespace collision (opensearch-py #756)."""
    opensearchpy = types.ModuleType("opensearchpy")
    opensearchpy_helpers = types.ModuleType("opensearchpy.helpers")

    class BulkIndexError(Exception):
        def __init__(self, errors):
            super().__init__("bulk error")
            self.errors = errors

    class Urllib3AWSV4SignerAuth:
        def __init__(self, credentials, region, service):
            self.credentials = credentials
            self.region = region
            self.service = service

    class Urllib3HttpConnection:
        pass

    class _IndicesClient:
        def __init__(self):
            self.exists = MagicMock(return_value=False)
            self.create = MagicMock()
            self.delete = MagicMock()

    class OpenSearch:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.indices = _IndicesClient()
            self.search = MagicMock(return_value={"hits": {"hits": []}})
            self.get = MagicMock()

    helpers = SimpleNamespace(bulk=MagicMock())

    opensearchpy.OpenSearch = OpenSearch
    opensearchpy.Urllib3AWSV4SignerAuth = Urllib3AWSV4SignerAuth
    opensearchpy.Urllib3HttpConnection = Urllib3HttpConnection
    opensearchpy.helpers = helpers
    opensearchpy_helpers.BulkIndexError = BulkIndexError

    return {
        "opensearchpy": opensearchpy,
        "opensearchpy.helpers": opensearchpy_helpers,
    }


def _opensearch_config(module, **overrides):
    values = {
        "host": "localhost",
        "port": 9200,
        "secure": False,
        "user": "admin",
        "password": "password",
    }
    values.update(overrides)
    return module.OpenSearchConfig.model_validate(values)


def get_example_text() -> str:
    return "This is a sample text for testing purposes."


class TestOpensearchCases:
    @staticmethod
    @pytest.fixture
    def opensearch_module(monkeypatch: pytest.MonkeyPatch):
        for name, module in _opensearch_build_fake_opensearch_modules().items():
            monkeypatch.setitem(sys.modules, name, module)

        import dify_vdb_opensearch.opensearch_vector as module

        return importlib.reload(module)

    class TestOpenSearchConfig:
        def test_to_opensearch_params(self, opensearch_module):
            config = _opensearch_config(opensearch_module, secure=True)
            params = config.to_opensearch_params()

            assert params["hosts"] == [{"host": "localhost", "port": 9200}]
            assert params["use_ssl"] is True
            assert params["verify_certs"] is True
            assert params["connection_class"].__name__ == "Urllib3HttpConnection"
            assert params["http_auth"] == ("admin", "password")

        def test_to_opensearch_params_with_aws_managed_iam(self, opensearch_module, monkeypatch: pytest.MonkeyPatch):
            class _Session:
                def get_credentials(self):
                    return "creds"

            boto3 = types.ModuleType("boto3")
            boto3.Session = _Session
            monkeypatch.setitem(sys.modules, "boto3", boto3)

            config = _opensearch_config(
                opensearch_module,
                secure=True,
                auth_method="aws_managed_iam",
                aws_region="ap-southeast-2",
                aws_service="aoss",
                host="aoss-endpoint.ap-southeast-2.aoss.amazonaws.com",
                port=9201,
            )
            params = config.to_opensearch_params()

            assert params["hosts"] == [{"host": "aoss-endpoint.ap-southeast-2.aoss.amazonaws.com", "port": 9201}]
            assert params["use_ssl"] is True
            assert params["verify_certs"] is True
            assert params["connection_class"].__name__ == "Urllib3HttpConnection"
            assert params["http_auth"].credentials == "creds"
            assert params["http_auth"].region == "ap-southeast-2"
            assert params["http_auth"].service == "aoss"

    class TestOpenSearchVector:
        COLLECTION_NAME = "test_collection"
        EXAMPLE_DOC_ID = "example_doc_id"

        def _make_vector(self, module):
            vector = module.OpenSearchVector(self.COLLECTION_NAME, _opensearch_config(module))
            vector._client = MagicMock()
            return vector

        @pytest.mark.parametrize(
            ("search_response", "expected_length", "expected_doc_id"),
            [
                (
                    {
                        "hits": {
                            "total": {"value": 1},
                            "hits": [
                                {
                                    "_source": {
                                        "page_content": get_example_text(),
                                        "metadata": {"document_id": "example_doc_id"},
                                    }
                                }
                            ],
                        }
                    },
                    1,
                    "example_doc_id",
                ),
                ({"hits": {"total": {"value": 0}, "hits": []}}, 0, None),
            ],
        )
        def test_search_by_full_text(self, opensearch_module, search_response, expected_length, expected_doc_id):
            vector = self._make_vector(opensearch_module)
            vector._client.search.return_value = search_response

            hits = vector.search_by_full_text(query=get_example_text())
            assert len(hits) == expected_length
            if expected_length > 0:
                assert hits[0].metadata["document_id"] == expected_doc_id

        def test_search_by_vector(self, opensearch_module):
            vector = self._make_vector(opensearch_module)
            query_vector = [0.1] * 128
            mock_response = {
                "hits": {
                    "total": {"value": 1},
                    "hits": [
                        {
                            "_source": {
                                Field.CONTENT_KEY: get_example_text(),
                                Field.METADATA_KEY: {"document_id": self.EXAMPLE_DOC_ID},
                            },
                            "_score": 1.0,
                        }
                    ],
                }
            }
            vector._client.search.return_value = mock_response

            hits = vector.search_by_vector(query_vector=query_vector)

            assert len(hits) > 0
            assert hits[0].metadata["document_id"] == self.EXAMPLE_DOC_ID

        def test_get_ids_by_metadata_field(self, opensearch_module):
            vector = self._make_vector(opensearch_module)
            mock_response = {"hits": {"total": {"value": 1}, "hits": [{"_id": "mock_id"}]}}
            vector._client.search.return_value = mock_response

            doc = Document(page_content="Test content", metadata={"document_id": self.EXAMPLE_DOC_ID})
            embedding = [0.1] * 128

            opensearch_module.helpers.bulk.reset_mock()
            vector.add_texts([doc], [embedding])

            ids = vector.get_ids_by_metadata_field(key="document_id", value=self.EXAMPLE_DOC_ID)
            assert len(ids) == 1
            assert ids[0] == "mock_id"

        def test_add_texts(self, opensearch_module):
            vector = self._make_vector(opensearch_module)
            vector._client.index.return_value = {"result": "created"}

            doc = Document(page_content="Test content", metadata={"document_id": self.EXAMPLE_DOC_ID})
            embedding = [0.1] * 128

            opensearch_module.helpers.bulk.reset_mock()
            vector.add_texts([doc], [embedding])

            mock_response = {"hits": {"total": {"value": 1}, "hits": [{"_id": "mock_id"}]}}
            vector._client.search.return_value = mock_response

            ids = vector.get_ids_by_metadata_field(key="document_id", value=self.EXAMPLE_DOC_ID)
            assert len(ids) == 1
            assert ids[0] == "mock_id"

        def test_delete_nonexistent_index(self, opensearch_module):
            """ignore_unavailable=True handles non-existent indices gracefully."""
            vector = self._make_vector(opensearch_module)
            vector.delete()

            vector._client.indices.delete.assert_called_once_with(
                index=self.COLLECTION_NAME.lower(), ignore_unavailable=True
            )

        def test_delete_existing_index(self, opensearch_module):
            vector = self._make_vector(opensearch_module)
            vector.delete()

            vector._client.indices.delete.assert_called_once_with(
                index=self.COLLECTION_NAME.lower(), ignore_unavailable=True
            )

    @staticmethod
    @pytest.fixture(scope="module")
    def setup_mock_redis():
        ext_redis.redis_client.get = MagicMock(return_value=None)
        ext_redis.redis_client.set = MagicMock(return_value=None)

        mock_redis_lock = MagicMock()
        mock_redis_lock.__enter__ = MagicMock()
        mock_redis_lock.__exit__ = MagicMock()
        ext_redis.redis_client.lock = MagicMock(return_value=mock_redis_lock)

    @pytest.mark.usefixtures("setup_mock_redis")
    class TestOpenSearchVectorWithRedis:
        COLLECTION_NAME = "test_collection"
        EXAMPLE_DOC_ID = "example_doc_id"

        def _make_vector(self, module):
            vector = module.OpenSearchVector(self.COLLECTION_NAME, _opensearch_config(module))
            vector._client = MagicMock()
            return vector

        def test_search_by_full_text(self, opensearch_module):
            vector = self._make_vector(opensearch_module)
            search_response = {
                "hits": {
                    "total": {"value": 1},
                    "hits": [
                        {"_source": {"page_content": get_example_text(), "metadata": {"document_id": "example_doc_id"}}}
                    ],
                }
            }
            vector._client.search.return_value = search_response

            hits = vector.search_by_full_text(query=get_example_text())
            assert len(hits) == 1
            assert hits[0].metadata["document_id"] == "example_doc_id"

        def test_get_ids_by_metadata_field(self, opensearch_module):
            vector = self._make_vector(opensearch_module)
            mock_response = {"hits": {"total": {"value": 1}, "hits": [{"_id": "mock_id"}]}}
            vector._client.search.return_value = mock_response

            doc = Document(page_content="Test content", metadata={"document_id": self.EXAMPLE_DOC_ID})
            embedding = [0.1] * 128

            opensearch_module.helpers.bulk.reset_mock()
            vector.add_texts([doc], [embedding])

            ids = vector.get_ids_by_metadata_field(key="document_id", value=self.EXAMPLE_DOC_ID)
            assert len(ids) == 1
            assert ids[0] == "mock_id"

        def test_add_texts(self, opensearch_module):
            vector = self._make_vector(opensearch_module)
            vector._client.index.return_value = {"result": "created"}

            doc = Document(page_content="Test content", metadata={"document_id": self.EXAMPLE_DOC_ID})
            embedding = [0.1] * 128

            opensearch_module.helpers.bulk.reset_mock()
            vector.add_texts([doc], [embedding])

            mock_response = {"hits": {"total": {"value": 1}, "hits": [{"_id": "mock_id"}]}}
            vector._client.search.return_value = mock_response

            ids = vector.get_ids_by_metadata_field(key="document_id", value=self.EXAMPLE_DOC_ID)
            assert len(ids) == 1
            assert ids[0] == "mock_id"

        def test_search_by_vector(self, opensearch_module):
            vector = self._make_vector(opensearch_module)
            query_vector = [0.1] * 128
            mock_response = {
                "hits": {
                    "total": {"value": 1},
                    "hits": [
                        {
                            "_source": {
                                Field.CONTENT_KEY: get_example_text(),
                                Field.METADATA_KEY: {"document_id": self.EXAMPLE_DOC_ID},
                            },
                            "_score": 1.0,
                        }
                    ],
                }
            }
            vector._client.search.return_value = mock_response

            hits = vector.search_by_vector(query_vector=query_vector)
            assert len(hits) > 0
            assert hits[0].metadata["document_id"] == self.EXAMPLE_DOC_ID


# TODO(wylswz): There's a known issue with namespace collision
# https://github.com/langgenius/dify/issues/34732
def _opensearch_vector_build_fake_opensearch_modules():
    opensearchpy = types.ModuleType("opensearchpy")
    opensearchpy_helpers = types.ModuleType("opensearchpy.helpers")

    class BulkIndexError(Exception):
        def __init__(self, errors):
            super().__init__("bulk error")
            self.errors = errors

    class Urllib3AWSV4SignerAuth:
        def __init__(self, credentials, region, service):
            self.credentials = credentials
            self.region = region
            self.service = service

    class Urllib3HttpConnection:
        pass

    class _IndicesClient:
        def __init__(self):
            self.exists = MagicMock(return_value=False)
            self.create = MagicMock()
            self.delete = MagicMock()

    class OpenSearch:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self.indices = _IndicesClient()
            self.search = MagicMock(return_value={"hits": {"hits": []}})
            self.get = MagicMock()

    helpers = SimpleNamespace(bulk=MagicMock())

    opensearchpy.OpenSearch = OpenSearch
    opensearchpy.Urllib3AWSV4SignerAuth = Urllib3AWSV4SignerAuth
    opensearchpy.Urllib3HttpConnection = Urllib3HttpConnection
    opensearchpy.helpers = helpers
    opensearchpy_helpers.BulkIndexError = BulkIndexError

    return {
        "opensearchpy": opensearchpy,
        "opensearchpy.helpers": opensearchpy_helpers,
    }


def _opensearch_vector_config(module, **overrides):
    values = {
        "host": "localhost",
        "port": 9200,
        "secure": True,
        "verify_certs": True,
        "auth_method": "basic",
        "user": "admin",
        "password": "secret",
    }
    values.update(overrides)
    return module.OpenSearchConfig.model_validate(values)


class TestOpensearchVectorCases:
    @staticmethod
    @pytest.fixture
    def opensearch_module(monkeypatch: pytest.MonkeyPatch):
        for name, module in _opensearch_vector_build_fake_opensearch_modules().items():
            monkeypatch.setitem(sys.modules, name, module)

        import dify_vdb_opensearch.opensearch_vector as module

        return importlib.reload(module)

    @staticmethod
    @pytest.mark.parametrize(
        ("field", "value", "message"),
        [
            ("host", "", "config OPENSEARCH_HOST is required"),
            ("port", 0, "config OPENSEARCH_PORT is required"),
        ],
    )
    def test_config_validation_required_fields(opensearch_module, field, value, message):
        values = _opensearch_vector_config(opensearch_module).model_dump()
        values[field] = value

        with pytest.raises(ValidationError, match=message):
            opensearch_module.OpenSearchConfig.model_validate(values)

    @staticmethod
    def test_config_validation_for_aws_auth_and_https_fields(opensearch_module):
        values = {
            "host": "localhost",
            "port": 9200,
            "secure": True,
            "verify_certs": True,
            "auth_method": "aws_managed_iam",
            "user": "admin",
            "password": "secret",
        }
        with pytest.raises(ValidationError, match="OPENSEARCH_AWS_REGION"):
            opensearch_module.OpenSearchConfig.model_validate(values)

        values = _opensearch_vector_config(opensearch_module).model_dump()
        values["OPENSEARCH_SECURE"] = False
        values["OPENSEARCH_VERIFY_CERTS"] = True
        with pytest.raises(ValidationError, match="verify_certs=True requires secure"):
            opensearch_module.OpenSearchConfig.model_validate(values)

    @staticmethod
    def test_create_aws_managed_iam_auth(opensearch_module, monkeypatch: pytest.MonkeyPatch):
        class _Session:
            def get_credentials(self):
                return "creds"

        boto3 = types.ModuleType("boto3")
        boto3.Session = _Session
        monkeypatch.setitem(sys.modules, "boto3", boto3)

        config = _opensearch_vector_config(
            opensearch_module,
            auth_method="aws_managed_iam",
            aws_region="us-east-1",
            aws_service="es",
        )
        auth = config.create_aws_managed_iam_auth()

        assert auth.credentials == "creds"
        assert auth.region == "us-east-1"
        assert auth.service == "es"

    @staticmethod
    def test_to_opensearch_params_supports_basic_and_aws(opensearch_module):
        basic_params = _opensearch_vector_config(opensearch_module).to_opensearch_params()
        assert basic_params["http_auth"] == ("admin", "secret")

        aws_config = _opensearch_vector_config(
            opensearch_module,
            auth_method="aws_managed_iam",
            aws_region="us-west-2",
            aws_service="es",
        )
        with patch.object(opensearch_module.OpenSearchConfig, "create_aws_managed_iam_auth", return_value="iam-auth"):
            aws_params = aws_config.to_opensearch_params()

        assert aws_params["http_auth"] == "iam-auth"

    @staticmethod
    def test_init_and_create_delegate_calls(opensearch_module):
        vector = opensearch_module.OpenSearchVector("Collection_1", _opensearch_vector_config(opensearch_module))
        vector.create_collection = MagicMock()
        vector.add_texts = MagicMock()
        docs = [Document(page_content="hello", metadata={"doc_id": "seg-1"})]

        vector.create(docs, [[0.1, 0.2]])

        assert vector.get_type() == "opensearch"
        vector.create_collection.assert_called_once_with([[0.1, 0.2]], [{"doc_id": "seg-1"}])
        vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])

    @staticmethod
    def test_add_texts_supports_regular_and_aoss_clients(opensearch_module, monkeypatch: pytest.MonkeyPatch):
        vector = opensearch_module.OpenSearchVector(
            "Collection_1", _opensearch_vector_config(opensearch_module, aws_service="es")
        )
        docs = [
            Document(page_content="a", metadata={"doc_id": "1"}),
            Document(page_content="b", metadata={"doc_id": "2"}),
        ]

        monkeypatch.setattr(opensearch_module, "uuid4", lambda: SimpleNamespace(hex="generated-id"))
        opensearch_module.helpers.bulk.reset_mock()
        vector.add_texts(docs, [[0.1], [0.2]])
        actions = opensearch_module.helpers.bulk.call_args.kwargs["actions"]
        assert len(actions) == 2
        assert all("_id" in action for action in actions)

        vector._client_config.aws_service = "aoss"
        opensearch_module.helpers.bulk.reset_mock()
        vector.add_texts(docs, [[0.3], [0.4]])
        aoss_actions = opensearch_module.helpers.bulk.call_args.kwargs["actions"]
        assert all("_id" not in action for action in aoss_actions)

    @staticmethod
    def test_metadata_lookup_and_delete_by_metadata_field(opensearch_module):
        vector = opensearch_module.OpenSearchVector("collection_1", _opensearch_vector_config(opensearch_module))
        vector._client.search.return_value = {"hits": {"hits": [{"_id": "id-1"}, {"_id": "id-2"}]}}

        assert vector.get_ids_by_metadata_field("document_id", "doc-1") == ["id-1", "id-2"]

        vector._client.search.return_value = {"hits": {"hits": []}}
        assert vector.get_ids_by_metadata_field("document_id", "doc-1") is None

        vector.get_ids_by_metadata_field = MagicMock(return_value=["id-1"])
        vector.delete_by_ids = MagicMock()
        vector.delete_by_metadata_field("document_id", "doc-1")
        vector.delete_by_ids.assert_called_once_with(["id-1"])

    @staticmethod
    def test_delete_by_ids_branches_and_bulk_error_handling(opensearch_module):
        vector = opensearch_module.OpenSearchVector("collection_1", _opensearch_vector_config(opensearch_module))
        opensearch_module.helpers.bulk.reset_mock()
        vector._client.indices.exists.return_value = False
        vector.delete_by_ids(["doc-1"])
        opensearch_module.helpers.bulk.assert_not_called()

        vector._client.indices.exists.return_value = True
        vector.get_ids_by_metadata_field = MagicMock(side_effect=[["es-1"], None])
        vector.delete_by_ids(["doc-1", "doc-2"])
        opensearch_module.helpers.bulk.assert_called_once()

        opensearch_module.helpers.bulk.reset_mock()
        vector.get_ids_by_metadata_field = MagicMock(return_value=["es-404"])
        opensearch_module.helpers.bulk.side_effect = opensearch_module.BulkIndexError(
            [{"delete": {"status": 404, "_id": "es-404"}}]
        )
        vector.delete_by_ids(["doc-404"])
        assert opensearch_module.helpers.bulk.call_count == 1

        opensearch_module.helpers.bulk.side_effect = None

    @staticmethod
    def test_delete_and_text_exists(opensearch_module):
        vector = opensearch_module.OpenSearchVector("collection_1", _opensearch_vector_config(opensearch_module))
        vector.delete()
        vector._client.indices.delete.assert_called_once_with(index="collection_1", ignore_unavailable=True)

        vector._client.get.return_value = {"_id": "id-1"}
        assert vector.text_exists("id-1") is True
        vector._client.get.side_effect = RuntimeError("not found")
        assert vector.text_exists("id-1") is False

    @staticmethod
    def test_search_by_vector_validates_and_builds_documents(opensearch_module):
        vector = opensearch_module.OpenSearchVector("collection_1", _opensearch_vector_config(opensearch_module))

        with pytest.raises(ValueError, match="query_vector should be a list"):
            vector.search_by_vector("not-a-list")

        with pytest.raises(ValueError, match="should be floats"):
            vector.search_by_vector([0.1, 1])

        vector._client.search.return_value = {
            "hits": {
                "hits": [
                    {
                        "_source": {
                            opensearch_module.Field.CONTENT_KEY: "doc-1",
                            opensearch_module.Field.METADATA_KEY: None,
                        },
                        "_score": 0.9,
                    },
                    {
                        "_source": {
                            opensearch_module.Field.CONTENT_KEY: "doc-2",
                            opensearch_module.Field.METADATA_KEY: {"doc_id": "2"},
                        },
                        "_score": 0.1,
                    },
                ]
            }
        }
        docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5)
        assert len(docs) == 1
        assert docs[0].page_content == "doc-1"
        assert docs[0].metadata["score"] == pytest.approx(0.9)

        vector.search_by_vector([0.1, 0.2], top_k=3, document_ids_filter=["doc-a", "doc-b"])
        query = vector._client.search.call_args.kwargs["body"]
        assert "script_score" in query["query"]

    @staticmethod
    def test_search_by_vector_reraises_client_error(opensearch_module):
        vector = opensearch_module.OpenSearchVector("collection_1", _opensearch_vector_config(opensearch_module))
        vector._client.search.side_effect = RuntimeError("boom")

        with pytest.raises(RuntimeError, match="boom"):
            vector.search_by_vector([0.1, 0.2])

    @staticmethod
    def test_search_by_full_text_and_filters(opensearch_module):
        vector = opensearch_module.OpenSearchVector("collection_1", _opensearch_vector_config(opensearch_module))
        vector._client.search.return_value = {
            "hits": {
                "hits": [
                    {
                        "_source": {
                            opensearch_module.Field.METADATA_KEY: {"doc_id": "1"},
                            opensearch_module.Field.VECTOR: [0.1],
                            opensearch_module.Field.CONTENT_KEY: "matched text",
                        }
                    },
                ]
            }
        }

        docs = vector.search_by_full_text("hello", document_ids_filter=["d-1"])

        assert len(docs) == 1
        assert docs[0].page_content == "matched text"
        query = vector._client.search.call_args.kwargs["body"]
        assert query["query"]["bool"]["filter"] == [{"terms": {"metadata.document_id": ["d-1"]}}]

    @staticmethod
    def test_create_collection_cache_and_create_path(opensearch_module, monkeypatch: pytest.MonkeyPatch):
        lock = MagicMock()
        lock.__enter__.return_value = None
        lock.__exit__.return_value = None
        monkeypatch.setattr(opensearch_module.redis_client, "lock", MagicMock(return_value=lock))
        monkeypatch.setattr(opensearch_module.redis_client, "set", MagicMock())

        vector = opensearch_module.OpenSearchVector("Collection_1", _opensearch_vector_config(opensearch_module))

        monkeypatch.setattr(opensearch_module.redis_client, "get", MagicMock(return_value=1))
        vector._client.indices.create.reset_mock()
        vector.create_collection([[0.1, 0.2]])
        vector._client.indices.create.assert_not_called()

        monkeypatch.setattr(opensearch_module.redis_client, "get", MagicMock(return_value=None))
        vector._client.indices.exists.return_value = False
        vector.create_collection([[0.1, 0.2]])
        vector._client.indices.create.assert_called_once()
        index_body = vector._client.indices.create.call_args.kwargs["body"]
        assert index_body["mappings"]["properties"]["vector"]["dimension"] == 2
        opensearch_module.redis_client.set.assert_called()

    @staticmethod
    def test_opensearch_factory_initializes_expected_collection_name(
        opensearch_module, monkeypatch: pytest.MonkeyPatch
    ):
        factory = opensearch_module.OpenSearchVectorFactory()
        dataset_with_index = Dataset(
            id="dataset-1", index_struct=json.dumps({"vector_store": {"class_prefix": "EXISTING_COLLECTION"}})
        )
        dataset_without_index = Dataset(id="dataset-2")

        monkeypatch.setattr(opensearch_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
        monkeypatch.setattr(opensearch_module.dify_config, "OPENSEARCH_HOST", "localhost")
        monkeypatch.setattr(opensearch_module.dify_config, "OPENSEARCH_PORT", 9200)
        monkeypatch.setattr(opensearch_module.dify_config, "OPENSEARCH_SECURE", True)
        monkeypatch.setattr(opensearch_module.dify_config, "OPENSEARCH_VERIFY_CERTS", True)
        monkeypatch.setattr(opensearch_module.dify_config, "OPENSEARCH_AUTH_METHOD", "basic")
        monkeypatch.setattr(opensearch_module.dify_config, "OPENSEARCH_USER", "admin")
        monkeypatch.setattr(opensearch_module.dify_config, "OPENSEARCH_PASSWORD", "secret")
        monkeypatch.setattr(opensearch_module.dify_config, "OPENSEARCH_AWS_REGION", None)
        monkeypatch.setattr(opensearch_module.dify_config, "OPENSEARCH_AWS_SERVICE", None)

        with patch.object(opensearch_module, "OpenSearchVector", return_value="vector") as vector_cls:
            result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock(), session=None)
            result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock(), session=None)

        assert result_1 == "vector"
        assert result_2 == "vector"
        assert vector_cls.call_args_list[0].kwargs["collection_name"] == "existing_collection"
        assert vector_cls.call_args_list[1].kwargs["collection_name"] == "auto_collection"
        assert dataset_without_index.index_struct is not None
