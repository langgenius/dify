import os

import pytest
from _pytest.monkeypatch import MonkeyPatch
from elasticsearch import Elasticsearch

from core.rag.datasource.vdb.field import Field


class MockIndicesClient:
    def __init__(self):
        pass

    def create(self, index, mappings, settings):
        return {"acknowledge": True}

    def refresh(self, index):
        return {"acknowledge": True}

    def delete(self, index):
        return {"acknowledge": True}

    def exists(self, index):
        return True


class MockClient:
    def __init__(self, **kwargs):
        self.indices = MockIndicesClient()

    def index(self, **kwargs):
        return {"acknowledge": True}

    def exists(self, **kwargs):
        return True

    def delete(self, **kwargs):
        return {"acknowledge": True}

    def search(self, **kwargs):
        return {
            "took": 1,
            "hits": {
                "hits": [
                    {
                        "_source": {
                            Field.CONTENT_KEY: "abcdef",
                            Field.VECTOR: [1, 2],
                            Field.METADATA_KEY: {},
                        },
                        "_score": 1.0,
                    },
                    {
                        "_source": {
                            Field.CONTENT_KEY: "123456",
                            Field.VECTOR: [2, 2],
                            Field.METADATA_KEY: {},
                        },
                        "_score": 0.9,
                    },
                    {
                        "_source": {
                            Field.CONTENT_KEY: "a1b2c3",
                            Field.VECTOR: [3, 2],
                            Field.METADATA_KEY: {},
                        },
                        "_score": 0.8,
                    },
                ]
            },
        }


MOCK = os.getenv("MOCK_SWITCH", "false").lower() == "true"


@pytest.fixture
def setup_client_mock(request, monkeypatch: MonkeyPatch):
    if MOCK:
        monkeypatch.setattr(Elasticsearch, "__init__", MockClient.__init__)
        monkeypatch.setattr(Elasticsearch, "index", MockClient.index)
        monkeypatch.setattr(Elasticsearch, "exists", MockClient.exists)
        monkeypatch.setattr(Elasticsearch, "delete", MockClient.delete)
        monkeypatch.setattr(Elasticsearch, "search", MockClient.search)

    yield

    if MOCK:
        monkeypatch.undo()
