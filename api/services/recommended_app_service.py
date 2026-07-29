from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from configs import dify_config
from enums.deployment_edition import DeploymentEdition
from models.model import AccountTrialAppRecord, App, TrialApp
from services.recommend_app.recommend_app_factory import RecommendAppRetrievalFactory


class RecommendedAppService:
    """Own recommended app retrieval and Cloud-only trial eligibility."""

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

    @classmethod
    def get_recommended_apps_and_categories(cls, language: str, *, session: Session):
        """
        Get recommended apps and categories.
        :param language: language
        :return:
        """
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        retrieval_instance = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)()
        result = retrieval_instance.get_recommended_apps_and_categories(language, session=session)
        if not result.get("recommended_apps"):
            result = (
                RecommendAppRetrievalFactory.get_buildin_recommend_app_retrieval().fetch_recommended_apps_from_builtin(
                    "en-US"
                )
            )

        apps = result["recommended_apps"]
        trial_apps = cls._get_trial_apps(session, [app["app_id"] for app in apps]) if cls.is_trial_app_enabled() else {}
        for app in apps:
            trial_app = trial_apps.get(app["app_id"])
            app["can_trial"] = trial_app is not None
            app["trial_limit"] = trial_app.trial_limit if trial_app else None
        return result

    @classmethod
    def get_learn_dify_apps(cls, language: str, *, session: Session) -> dict[str, Any]:
        """
        Get recommended apps marked for the Learn Dify section.
        :param language: language
        :return:
        """
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        retrieval_instance = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)()
        result = retrieval_instance.get_learn_dify_apps(language, session=session)

        apps = result["recommended_apps"]
        trial_apps = cls._get_trial_apps(session, [app["app_id"] for app in apps]) if cls.is_trial_app_enabled() else {}
        for app in apps:
            trial_app = trial_apps.get(app["app_id"])
            app["can_trial"] = trial_app is not None
            app["trial_limit"] = trial_app.trial_limit if trial_app else None

        return {"recommended_apps": apps}

    @classmethod
    def get_recommend_app_detail(cls, app_id: str, *, session: Session) -> dict[str, Any] | None:
        """
        Get recommend app detail.
        :param app_id: app id
        :return:
        """
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        retrieval_instance = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)()
        result: dict[str, Any] | None = retrieval_instance.get_recommend_app_detail(app_id, session=session)
        if result is None:
            return None
        result["can_trial"] = cls.is_trial_app_enabled() and cls._can_trial_app(session, result["id"])
        return result

    @classmethod
    def add_trial_app_record(cls, app_id: str, account_id: str, *, session: Session):
        """
        Add trial app record.
        :param app_id: app id
        :return:
        """
        account_trial_app_record = session.scalar(
            select(AccountTrialAppRecord)
            .where(AccountTrialAppRecord.app_id == app_id, AccountTrialAppRecord.account_id == account_id)
            .limit(1)
        )
        if account_trial_app_record:
            account_trial_app_record.count += 1
            session.commit()
        else:
            session.add(AccountTrialAppRecord(app_id=app_id, count=1, account_id=account_id))
            session.commit()

    @staticmethod
    def _can_trial_app(session: Session, app_id: str) -> bool:
        trial_app_model = session.scalar(select(TrialApp).where(TrialApp.app_id == app_id).limit(1))
        return trial_app_model is not None

    @staticmethod
    def _get_trial_apps(session: Session, app_ids: list[str]) -> dict[str, TrialApp]:
        if not app_ids:
            return {}
        trial_apps = session.scalars(select(TrialApp).where(TrialApp.app_id.in_(app_ids))).all()
        return {trial_app.app_id: trial_app for trial_app in trial_apps}
