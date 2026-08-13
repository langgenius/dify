import os

import pytest
from _pytest.monkeypatch import MonkeyPatch
from tcvectordb.exceptions import ServerInternalError
from tcvectordb.rpc.client.rpcclient import RPCClient
from tcvectordb.rpc.proto import olama_pb2


class InMemoryVdbTransport:
    """Return protobuf responses at the Tencent SDK RPC boundary."""

    def __init__(self) -> None:
        self.collections: dict[tuple[str, str], olama_pb2.CreateCollectionRequest] = {}
        self.documents: dict[tuple[str, str], dict[str, olama_pb2.Document]] = {}

    def list_databases(self, req, timeout=None, ai=False):
        response = olama_pb2.DatabaseResponse(code=0, msg="operation success", databases=["dify"])
        response.info["dify"].db_type = olama_pb2.DataType.BASE
        return response

    def create_database(self, req, timeout=None, ai=False):
        return olama_pb2.DatabaseResponse(code=0, msg="operation success", affectedCount=1)

    def create_collection(self, req, timeout=None, ai=False):
        key = (req.database, req.collection)
        stored_request = olama_pb2.CreateCollectionRequest()
        stored_request.CopyFrom(req)
        self.collections[key] = stored_request
        self.documents[key] = {}
        return olama_pb2.CreateCollectionResponse(code=0, msg="operation success", affectedCount=1)

    def describe_collection(self, req, timeout=None, ai=False):
        key = (req.database, req.collection)
        collection = self.collections.get(key)
        if collection is None:
            raise ServerInternalError(code=15302, message="Collection does not exist")
        response = olama_pb2.DescribeCollectionResponse(code=0, msg="operation success")
        response.collection.CopyFrom(collection)
        return response

    def drop_collection(self, req, timeout=None, ai=False):
        key = (req.database, req.collection)
        self.collections.pop(key, None)
        self.documents.pop(key, None)
        return olama_pb2.DropCollectionResponse(code=0, msg="operation success", affectedCount=1)

    def upsert(self, req, timeout=None, ai=False):
        collection_documents = self.documents.setdefault((req.database, req.collection), {})
        for document in req.documents:
            stored_document = olama_pb2.Document()
            stored_document.CopyFrom(document)
            collection_documents[document.id] = stored_document
        return olama_pb2.UpsertResponse(
            code=0,
            msg="operation success",
            affectedCount=len(req.documents),
        )

    def query(self, req, timeout=None, ai=False):
        documents = self.documents.get((req.database, req.collection), {})
        ids = list(req.query.documentIds) or list(documents)
        response = olama_pb2.QueryResponse(code=0, msg="operation success")
        for doc_id in ids:
            if document := documents.get(doc_id):
                response.documents.add().CopyFrom(document)
        return response

    def search(self, req, timeout=None, ai=False):
        return self._search_response(req)

    def hybrid_search(self, req, timeout=None, ai=False):
        return self._search_response(req)

    def delete(self, req, timeout=None, ai=False):
        documents = self.documents.get((req.database, req.collection), {})
        deleted = 0
        for doc_id in req.query.documentIds:
            if documents.pop(doc_id, None) is not None:
                deleted += 1
        return olama_pb2.DeleteResponse(code=0, msg="operation success", affectedCount=deleted)

    def _search_response(self, req):
        response = olama_pb2.SearchResponse(code=0, msg="operation success")
        result = response.results.add()
        documents = self.documents.get((req.database, req.collection), {})
        limit = req.search.limit or 10
        for document in list(documents.values())[:limit]:
            result_document = result.documents.add()
            result_document.CopyFrom(document)
            result_document.score = 0.9
        return response


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_tcvectordb_mock(monkeypatch: MonkeyPatch):
    if MOCK:
        transport = InMemoryVdbTransport()
        for method_name in (
            "list_databases",
            "create_database",
            "create_collection",
            "describe_collection",
            "drop_collection",
            "upsert",
            "query",
            "search",
            "hybrid_search",
            "delete",
        ):
            transport_method = getattr(transport, method_name)

            def call_transport(client, *args, _method=transport_method, **kwargs):
                return _method(*args, **kwargs)

            monkeypatch.setattr(RPCClient, method_name, call_transport)
