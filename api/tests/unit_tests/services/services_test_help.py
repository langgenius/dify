from unittest.mock import MagicMock


class ServiceDbTestHelper:
    """
    Helper class for service database query tests.
    """

    @staticmethod
    def setup_db_query_filter_by_mock(mock_db, query_results):
        """
        Smart database query mock that responds based on model type and query parameters.

        Args:
            mock_db: Mock database session
            query_results: Dict mapping (model_name, filter_key, filter_value) to return value
                          Example: {('Account', 'email', 'test@example.com'): mock_account}
        """

        def query_side_effect(model):
            mock_query = MagicMock()

            def filter_by_side_effect(**kwargs):
                mock_filter_result = MagicMock()

                def first_side_effect():
                    # Find matching result based on model and filter parameters
                    for (model_name, filter_key, filter_value), result in query_results.items():
                        if model.__name__ == model_name and filter_key in kwargs and kwargs[filter_key] == filter_value:
                            return result
                    return None

                mock_filter_result.first.side_effect = first_side_effect

                # Handle order_by calls for complex queries
                def order_by_side_effect(*args, **kwargs):
                    mock_order_result = MagicMock()

                    def order_first_side_effect():
                        # Look for order_by results in the same query_results dict
                        for (model_name, filter_key, filter_value), result in query_results.items():
                            if (
                                model.__name__ == model_name
                                and filter_key == "order_by"
                                and filter_value == "first_available"
                            ):
                                return result
                        return None

                    mock_order_result.first.side_effect = order_first_side_effect
                    return mock_order_result

                mock_filter_result.order_by.side_effect = order_by_side_effect
                return mock_filter_result

            mock_query.filter_by.side_effect = filter_by_side_effect
            return mock_query

        mock_db.session.query.side_effect = query_side_effect
