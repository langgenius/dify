from services.recommend_app.buildin.buildin_retrieval import BuildInRecommendAppRetrieval
from services.recommend_app.database.database_retrieval import DatabaseRecommendAppRetrieval
from services.recommend_app.recommend_app_base import RecommendAppRetrievalBase
from services.recommend_app.recommend_app_type import RecommendAppType
from services.recommend_app.remote.remote_retrieval import RemoteRecommendAppRetrieval


class RecommendAppRetrievalFactory:
    @staticmethod
    def get_recommend_app_factory(mode: str) -> type[RecommendAppRetrievalBase]:
        match mode:
            case RecommendAppType.REMOTE:
                return RemoteRecommendAppRetrieval
            case RecommendAppType.DATABASE:
                return DatabaseRecommendAppRetrieval
            case RecommendAppType.BUILDIN:
                return BuildInRecommendAppRetrieval
            case _:
                raise ValueError(f"invalid fetch recommended apps mode: {mode}")

    @staticmethod
    def get_buildin_recommend_app_retrieval():
        return BuildInRecommendAppRetrieval
