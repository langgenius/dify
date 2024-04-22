from core.rag.datasource.vdb.elasticsearch.elasticsearch_vector import ElasticSearchConfig, ElasticSearchVector
from core.rag.models.document import Document


def _create_elasticsearch_vector() -> ElasticSearchVector:
    es_vector = ElasticSearchVector(
        index_name='difyai-001',
        config=ElasticSearchConfig(
            host='http://localhost',
            port='9200',
            api_key_id='difyai',
            api_key='difyai123456'
        ),
        attributes=[]
    )
    documents = [
        Document(page_content="This is my document 01", metadata={"doc_id": "doc01", "source": "source01"}),
        Document(page_content="This is my document 02", metadata={"doc_id": "doc02", "source": "source02"}),
        Document(page_content="This is my document 03", metadata={"doc_id": "doc03", "source": "source03"}),
        Document(page_content="This is my document 04", metadata={"doc_id": "doc04", "source": "source04"}),
    ]
    embeddings = [
        [0.05787, 0.48987, 0.39758, 0.52784, 0.80389],
        [0.82231, 0.20338, 0.86496, 0.77795, 0.49477],
        [0.74193, 0.71291, 0.11598, 0.15358, 0.77719],
        [0.72267, 0.14779, 0.73123, 0.13277, 0.00964]]
    es_vector.create(texts=documents, embeddings=embeddings)

    return es_vector


def test_text_exists():
    es_vector = _create_elasticsearch_vector()
    assert es_vector.text_exists(id="doc01") is True


def test_delete_by_ids():
    es_vector = _create_elasticsearch_vector()
    es_vector.delete_by_ids(ids=['doc02', 'doc03'])


def test_delete_by_metadata_field():
    es_vector = _create_elasticsearch_vector()
    es_vector.delete_by_metadata_field(key="source", value="source04")


def test_search_by_vector():
    es_vector = _create_elasticsearch_vector()
    res = es_vector.search_by_vector(query_vector=[0.74193, 0.71291, 0.11598, 0.15358, 0.77719])
    assert len(res) > 0


def test_delete():
    es_vector = _create_elasticsearch_vector()
    es_vector.delete()
