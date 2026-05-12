import pytest

from services.recommend_app.buildin.buildin_retrieval import BuildInRecommendAppRetrieval
from services.recommend_app.database.database_retrieval import DatabaseRecommendAppRetrieval
from services.recommend_app.recommend_app_factory import RecommendAppRetrievalFactory
from services.recommend_app.remote.remote_retrieval import RemoteRecommendAppRetrieval


class TestRecommendAppRetrievalFactory:
    @pytest.mark.parametrize(
        ("mode", "expected_class"),
        [
            ("remote", RemoteRecommendAppRetrieval),
            ("builtin", BuildInRecommendAppRetrieval),
            ("db", DatabaseRecommendAppRetrieval),
        ],
    )
    def test_factory_returns_correct_class(self, mode, expected_class):
        result = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)
        assert result is expected_class

    def test_factory_raises_for_unknown_mode(self):
        with pytest.raises(ValueError, match="invalid fetch recommended apps mode"):
            RecommendAppRetrievalFactory.get_recommend_app_factory("invalid_mode")

    def test_get_buildin_recommend_app_retrieval(self):
        result = RecommendAppRetrievalFactory.get_buildin_recommend_app_retrieval()
        assert result is BuildInRecommendAppRetrieval
