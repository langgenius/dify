import pytest
from extensions.ext_redis import redis_client
from core.rag.datasource.vdb.tencent.tencent_vector import TencentConfig, TencentVector
from core.rag.models.document import Document


def _create_tencent_vector() -> TencentVector:
    tencent_vector = TencentVector(
        collection_name='test-001',
        config=TencentConfig(
            url="http://10.6.x.x",
            api_key="nTZ**********************",
            timeout=30,
            username="dify",
            database="dify",
            shard=1,
            replicas=2,
        )
    )
    documents = [
        Document(page_content="This is document 1", metadata={"doc_id": "doc1", "document_id": "foo1"}),
        Document(page_content="This is document 2", metadata={"doc_id": "doc2", "document_id": "foo2"}),
    ]
    embeddings = [[0.2123, 0.23, 0.213], [0.2123, 0.22, 0.213]]
    tencent_vector.create(texts=documents, embeddings=embeddings)

    return tencent_vector


@pytest.fixture(autouse=True)
def mock_redis_lock(mocker):
    mocker.patch.object(redis_client, "lock")


def test_text_exists():
    tencent_vector = _create_tencent_vector()
    assert tencent_vector.text_exists(id="doc1") is True


def test_delete_by_ids():
    tencent_vector = _create_tencent_vector()
    tencent_vector.delete_by_ids(ids=['doc2'])


def test_delete_by_metadata_field():
    tencent_vector = _create_tencent_vector()
    tencent_vector.delete_by_metadata_field(key="document_id", value="foo1")


def test_search_by_vector():
    tencent_vector = _create_tencent_vector()
    res = tencent_vector.search_by_vector(query_vector=[0.3123, 0.43, 0.213])
    assert len(res) > 0

def test_delete():
    tencent_vector = _create_tencent_vector()
    tencent_vector.delete()
