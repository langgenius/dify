from unittest.mock import MagicMock, patch

from core.rag.datasource.vdb.myscale.myscale_vector import MyScaleConfig, MyScaleVector


@patch("core.rag.datasource.vdb.myscale.myscale_vector.get_client")
def test_search_by_vector_uses_parameterized_query(mock_get_client):
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client

    vector = MyScaleVector(
        collection_name="test_collection",
        config=MyScaleConfig(
            host="localhost",
            port=8123,
            user="default",
            password="",
            database="dify",
            fts_params="",
        ),
    )
    vector._search = MagicMock(return_value=[])

    query_vector = [0.1, 0.2, 0.3]
    vector.search_by_vector(query_vector, top_k=5)

    vector._search.assert_called_once_with(
        "distance(vector, %(query_vector)s)",
        vector._vec_order,
        parameters={"query_vector": query_vector},
        top_k=5,
    )
