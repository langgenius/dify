from abc import ABC, abstractmethod


class RecommendAppRetrievalBase(ABC):
    """Interface for recommend app retrieval."""

    @abstractmethod
    def get_recommended_apps_and_categories(self, language: str) -> dict:
        raise NotImplementedError

    @abstractmethod
    def get_recommend_app_detail(self, app_id: str):
        raise NotImplementedError

    @abstractmethod
    def get_type(self) -> str:
        raise NotImplementedError
