import importlib
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from core.rag.models.document import Document


def _build_fake_couchbase_modules():
    couchbase = types.ModuleType("couchbase")
    couchbase_auth = types.ModuleType("couchbase.auth")
    couchbase_cluster = types.ModuleType("couchbase.cluster")
    couchbase_management = types.ModuleType("couchbase.management")
    couchbase_management_search = types.ModuleType("couchbase.management.search")
    couchbase_options = types.ModuleType("couchbase.options")
    couchbase_vector = types.ModuleType("couchbase.vector_search")
    couchbase_search = types.ModuleType("couchbase.search")

    class PasswordAuthenticator:
        def __init__(self, user, password):
            self.user = user
            self.password = password

    class ClusterOptions:
        def __init__(self, auth):
            self.auth = auth

    class SearchOptions:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    class VectorQuery:
        def __init__(self, field, vector, top_k):
            self.field = field
            self.vector = vector
            self.top_k = top_k

    class VectorSearch:
        @staticmethod
        def from_vector_query(vector_query):
            return {"vector_query": vector_query}

    class QueryStringQuery:
        def __init__(self, query):
            self.query = query

    class SearchRequest:
        @staticmethod
        def create(payload):
            return {"payload": payload}

    class SearchIndex:
        def __init__(self, name, params, source_name):
            self.name = name
            self.params = params
            self.source_name = source_name

    class _QueryResult:
        def __init__(self, rows=None):
            self._rows = rows or []

        def execute(self):
            return self

        def __iter__(self):
            return iter(self._rows)

    class _SearchIter:
        def __init__(self, rows=None):
            self._rows = rows or []

        def rows(self):
            return self._rows

    class _Collection:
        def __init__(self):
            self.upsert = MagicMock(return_value=True)

    class _SearchIndexManager:
        def __init__(self):
            self.upsert_index = MagicMock()

    class _Scope:
        def __init__(self):
            self._collection = _Collection()
            self._search_index_manager = _SearchIndexManager()
            self.search = MagicMock(return_value=_SearchIter())

        def collection(self, _name):
            return self._collection

        def search_indexes(self):
            return self._search_index_manager

    class _CollectionManager:
        def __init__(self):
            self.create_collection = MagicMock()
            self.drop_collection = MagicMock()
            self.get_all_scopes = MagicMock(return_value=[])

    class _Bucket:
        def __init__(self):
            self._scope = _Scope()
            self._collections = _CollectionManager()

        def scope(self, _scope_name):
            return self._scope

        def collections(self):
            return self._collections

    class Cluster:
        def __init__(self, connection_string, options):
            self.connection_string = connection_string
            self.options = options
            self._bucket = _Bucket()
            self.wait_until_ready = MagicMock()
            self.query = MagicMock(return_value=_QueryResult())

        def bucket(self, _name):
            return self._bucket

    couchbase_auth.PasswordAuthenticator = PasswordAuthenticator
    couchbase_cluster.Cluster = Cluster
    couchbase_management_search.SearchIndex = SearchIndex
    couchbase_options.ClusterOptions = ClusterOptions
    couchbase_options.SearchOptions = SearchOptions
    couchbase_vector.VectorQuery = VectorQuery
    couchbase_vector.VectorSearch = VectorSearch
    couchbase_search.QueryStringQuery = QueryStringQuery
    couchbase_search.SearchRequest = SearchRequest

    couchbase.search = couchbase_search
    couchbase.management = couchbase_management

    return {
        "couchbase": couchbase,
        "couchbase.auth": couchbase_auth,
        "couchbase.cluster": couchbase_cluster,
        "couchbase.management": couchbase_management,
        "couchbase.management.search": couchbase_management_search,
        "couchbase.options": couchbase_options,
        "couchbase.vector_search": couchbase_vector,
        "couchbase.search": couchbase_search,
    }


@pytest.fixture
def couchbase_module(monkeypatch):
    for name, module in _build_fake_couchbase_modules().items():
        monkeypatch.setitem(sys.modules, name, module)

    import core.rag.datasource.vdb.couchbase.couchbase_vector as module

    return importlib.reload(module)


def _config(module):
    return module.CouchbaseConfig(
        connection_string="couchbase://localhost",
        user="user",
        password="pass",
        bucket_name="bucket",
        scope_name="scope",
    )


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("connection_string", "", "CONNECTION_STRING is required"),
        ("user", "", "COUCHBASE_USER is required"),
        ("password", "", "COUCHBASE_PASSWORD is required"),
        ("bucket_name", "", "COUCHBASE_PASSWORD is required"),
        ("scope_name", "", "COUCHBASE_SCOPE_NAME is required"),
    ],
)
def test_couchbase_config_validation(couchbase_module, field, value, message):
    values = _config(couchbase_module).model_dump()
    values[field] = value
    with pytest.raises(ValidationError, match=message):
        couchbase_module.CouchbaseConfig.model_validate(values)


def test_init_sets_cluster_handles(couchbase_module):
    vector = couchbase_module.CouchbaseVector("collection_1", _config(couchbase_module))

    assert vector._bucket_name == "bucket"
    assert vector._scope_name == "scope"
    vector._cluster.wait_until_ready.assert_called_once()


def test_create_and_create_collection_branches(couchbase_module, monkeypatch):
    vector = couchbase_module.CouchbaseVector.__new__(couchbase_module.CouchbaseVector)
    vector._collection_name = "collection_1"
    vector._client_config = _config(couchbase_module)
    vector._scope_name = "scope"
    vector._bucket_name = "bucket"
    vector._bucket = MagicMock()
    vector._scope = MagicMock()
    vector._collection_exists = MagicMock(return_value=False)
    vector.add_texts = MagicMock()

    monkeypatch.setattr(couchbase_module.uuid, "uuid4", lambda: "a-b-c")
    vector._create_collection = MagicMock()
    docs = [Document(page_content="text", metadata={"doc_id": "id-1"})]
    vector.create(docs, [[0.1, 0.2]])

    vector._create_collection.assert_called_once_with(uuid="abc", vector_length=2)
    vector.add_texts.assert_called_once_with(docs, [[0.1, 0.2]])

    lock = MagicMock()
    lock.__enter__.return_value = None
    lock.__exit__.return_value = None
    monkeypatch.setattr(couchbase_module.redis_client, "lock", MagicMock(return_value=lock))
    monkeypatch.setattr(couchbase_module.redis_client, "set", MagicMock())

    vector = couchbase_module.CouchbaseVector("collection_1", _config(couchbase_module))
    monkeypatch.setattr(couchbase_module.redis_client, "get", MagicMock(return_value=1))
    vector._create_collection(vector_length=2, uuid="uuid-1")
    vector._bucket.collections().create_collection.assert_not_called()

    monkeypatch.setattr(couchbase_module.redis_client, "get", MagicMock(return_value=None))
    vector._collection_exists = MagicMock(return_value=True)
    vector._create_collection(vector_length=2, uuid="uuid-2")
    vector._bucket.collections().create_collection.assert_not_called()

    vector._collection_exists = MagicMock(return_value=False)
    vector._create_collection(vector_length=3, uuid="uuid-3")

    vector._bucket.collections().create_collection.assert_called_once_with("scope", "collection_1")
    vector._scope.search_indexes().upsert_index.assert_called_once()
    search_index = vector._scope.search_indexes().upsert_index.call_args.args[0]
    assert search_index.name == "collection_1_search"
    assert (
        search_index.params["mapping"]["types"]["scope.collection_1"]["properties"]["embedding"]["fields"][0]["dims"]
        == 3
    )
    couchbase_module.redis_client.set.assert_called_once()


def test_collection_exists_get_type_and_add_texts(couchbase_module):
    vector = couchbase_module.CouchbaseVector("collection_1", _config(couchbase_module))

    scope_obj = SimpleNamespace(name="scope", collections=[SimpleNamespace(name="collection_1")])
    vector._bucket.collections().get_all_scopes.return_value = [scope_obj]
    assert vector._collection_exists("collection_1") is True

    scope_obj = SimpleNamespace(name="scope", collections=[SimpleNamespace(name="other")])
    vector._bucket.collections().get_all_scopes.return_value = [scope_obj]
    assert vector._collection_exists("collection_1") is False

    vector._get_uuids = MagicMock(return_value=["id-1", "id-2"])
    docs = [
        Document(page_content="a", metadata={"doc_id": "id-1"}),
        Document(page_content="b", metadata={"doc_id": "id-2"}),
    ]
    ids = vector.add_texts(docs, [[0.1], [0.2]])

    assert ids == ["id-1", "id-2"]
    assert vector._scope.collection("collection_1").upsert.call_count == 2
    assert vector.get_type() == couchbase_module.VectorType.COUCHBASE


def test_query_delete_helpers(couchbase_module):
    vector = couchbase_module.CouchbaseVector("collection_1", _config(couchbase_module))

    vector._cluster.query.return_value = SimpleNamespace(execute=lambda: iter([{"count": 2}]))
    assert vector.text_exists("id-1") is True

    vector._cluster.query.return_value = SimpleNamespace(execute=lambda: iter([]))
    assert vector.text_exists("id-2") is False

    query_result = MagicMock()
    query_result.execute.return_value = None
    vector._cluster.query.return_value = query_result

    vector.delete_by_ids(["id-1", "id-2"])
    vector.delete_by_document_id("id-1")
    vector.delete_by_metadata_field("document_id", "doc-1")
    assert vector._cluster.query.call_count >= 3

    vector._cluster.query.side_effect = RuntimeError("delete failed")
    vector.delete_by_ids(["id-3"])


def test_search_methods_and_format_metadata(couchbase_module):
    vector = couchbase_module.CouchbaseVector("collection_1", _config(couchbase_module))

    row_1 = SimpleNamespace(fields={"text": "doc-a", "metadata.document_id": "d-1"}, score=0.9)
    row_2 = SimpleNamespace(fields={"text": "doc-b", "metadata.document_id": "d-2"}, score=0.3)
    vector._scope.search.return_value = SimpleNamespace(rows=lambda: [row_1, row_2])

    docs = vector.search_by_vector([0.1, 0.2], top_k=2, score_threshold=0.5)
    assert len(docs) == 1
    assert docs[0].page_content == "doc-a"
    assert docs[0].metadata["document_id"] == "d-1"
    assert docs[0].metadata["score"] == pytest.approx(0.9)

    vector._scope.search.side_effect = RuntimeError("search error")
    with pytest.raises(ValueError, match="Search failed"):
        vector.search_by_vector([0.1], top_k=1)

    vector._scope.search.side_effect = None
    row_3 = SimpleNamespace(fields={"text": "full-text", "metadata.doc_id": "x"}, score=0.7)
    vector._scope.search.return_value = SimpleNamespace(rows=lambda: [row_3])
    docs = vector.search_by_full_text("hello", top_k=1)
    assert len(docs) == 1
    assert docs[0].metadata["doc_id"] == "x"

    vector._scope.search.side_effect = RuntimeError("full text failed")
    with pytest.raises(ValueError, match="Search failed"):
        vector.search_by_full_text("hello", top_k=1)

    assert vector._format_metadata({"metadata.a": 1, "plain": 2}) == {"a": 1, "plain": 2}


def test_delete_collection_and_factory(couchbase_module, monkeypatch):
    vector = couchbase_module.CouchbaseVector("collection_1", _config(couchbase_module))
    scopes = [
        SimpleNamespace(collections=[SimpleNamespace(name="other")]),
        SimpleNamespace(collections=[SimpleNamespace(name="collection_1")]),
    ]
    vector._bucket.collections().get_all_scopes.return_value = scopes

    vector.delete()
    vector._bucket.collections().drop_collection.assert_called_once_with("_default", "collection_1")

    factory = couchbase_module.CouchbaseVectorFactory()
    dataset_with_index = SimpleNamespace(
        id="dataset-1",
        index_struct_dict={"vector_store": {"class_prefix": "EXISTING_COLLECTION"}},
        index_struct=None,
    )
    dataset_without_index = SimpleNamespace(id="dataset-2", index_struct_dict=None, index_struct=None)

    monkeypatch.setattr(couchbase_module.Dataset, "gen_collection_name_by_id", lambda _id: "AUTO_COLLECTION")
    monkeypatch.setattr(
        couchbase_module,
        "current_app",
        SimpleNamespace(
            config={
                "COUCHBASE_CONNECTION_STRING": "couchbase://localhost",
                "COUCHBASE_USER": "user",
                "COUCHBASE_PASSWORD": "pass",
                "COUCHBASE_BUCKET_NAME": "bucket",
                "COUCHBASE_SCOPE_NAME": "scope",
            }
        ),
    )

    with patch.object(couchbase_module, "CouchbaseVector", return_value="vector") as vector_cls:
        result_1 = factory.init_vector(dataset_with_index, attributes=[], embeddings=MagicMock())
        result_2 = factory.init_vector(dataset_without_index, attributes=[], embeddings=MagicMock())

    assert result_1 == "vector"
    assert result_2 == "vector"
    assert vector_cls.call_args_list[0].kwargs["collection_name"] == "EXISTING_COLLECTION"
    assert vector_cls.call_args_list[1].kwargs["collection_name"] == "AUTO_COLLECTION"
    assert dataset_without_index.index_struct is not None
