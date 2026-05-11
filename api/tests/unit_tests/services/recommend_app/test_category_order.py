import json
from unittest.mock import patch

from services.recommend_app.category_order import get_explore_app_category_order, order_categories


@patch("services.recommend_app.category_order.redis_client.get")
def test_get_explore_app_category_order_returns_redis_list(mock_get):
    mock_get.return_value = json.dumps(["C", "A", "B"]).encode()

    assert get_explore_app_category_order("en-US") == ["C", "A", "B"]
    mock_get.assert_called_once_with("explore:apps:category_order:en-US")


@patch("services.recommend_app.category_order.redis_client.get")
def test_order_categories_uses_redis_order_as_source_of_truth(mock_get):
    mock_get.return_value = json.dumps(["C", "A", "B"]).encode()

    assert order_categories({"A", "B", "C", "D"}, "en-US") == ["C", "A", "B"]


@patch("services.recommend_app.category_order.redis_client.get")
def test_order_categories_falls_back_to_sorted_categories_without_redis_order(mock_get):
    mock_get.return_value = None

    assert order_categories({"B", "A", "C"}, "en-US") == ["A", "B", "C"]
