from typing import Any, Protocol


class RecommendAppRetrievalBase(Protocol):
    """Interface for recommend app retrieval."""

    def get_recommended_apps_and_categories(self, language: str) -> Any: ...

    def get_recommend_app_detail(self, app_id: str) -> Any: ...

    def get_type(self) -> str: ...
