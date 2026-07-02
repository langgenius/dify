from typing import Any, Protocol

from sqlalchemy.orm import Session, scoped_session


class RecommendAppRetrievalBase(Protocol):
    """Interface for recommend app retrieval."""

    def get_recommended_apps_and_categories(self, language: str, *, session: scoped_session | Session) -> Any: ...

    def get_learn_dify_apps(self, language: str, *, session: scoped_session | Session) -> Any: ...

    def get_recommend_app_detail(self, app_id: str, *, session: scoped_session | Session) -> Any: ...

    def get_type(self) -> str: ...
