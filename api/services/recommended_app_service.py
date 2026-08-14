from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from enums import DeploymentEdition
from models.model import App
from services.recommend_app.recommend_app_factory import RecommendAppRetrievalFactory


class RecommendedAppService:
    """Own recommended app runtime admission."""

    @staticmethod
    def is_trial_app_enabled() -> bool:
        """Return whether trial execution is enabled for this deployment."""
        return dify_config.DEPLOYMENT_EDITION == DeploymentEdition.CLOUD and dify_config.ENABLE_TRIAL_APP

    @classmethod
    def get_app(cls, app_id: str, *, session: Session) -> App | None:
        """Return a normal app only when it belongs to the recommended catalog."""
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        retrieval_instance = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)()
        recommended_app_detail = retrieval_instance.get_recommend_app_detail(app_id, session=session)
        if recommended_app_detail is None:
            return None

        return session.scalar(select(App).where(App.id == app_id, App.status == "normal").limit(1))
