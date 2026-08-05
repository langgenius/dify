import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from core.rag.datasource.vdb.field import Field
from core.rag.models.document import Document
from extensions import ext_redis


def _build_fake_opensearch_modules():
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


@pytest.fixture
def opensearch_module(monkeypatch: pytest.MonkeyPatch):
    for name, module in _build_fake_opensearch_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import dify_vdb_opensearch.opensearch_vector as module

    return importlib.reload(module)


def _config(module, **overrides):
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


class TestOpenSearchConfig:
    def test_to_opensearch_params(self, opensearch_module):
        config = _config(opensearch_module, secure=True)
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

        config = _config(
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
        vector = module.OpenSearchVector(self.COLLECTION_NAME, _config(module))
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
        vector = module.OpenSearchVector(self.COLLECTION_NAME, _config(module))
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
