from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import scoped_session

from configs import dify_config
from models.model import AccountTrialAppRecord, TrialApp
from services.feature_service import FeatureService
from services.recommend_app.database.database_retrieval import DatabaseRecommendAppRetrieval
from services.recommend_app.recommend_app_factory import RecommendAppRetrievalFactory


class RecommendedAppService:
    @classmethod
    def get_recommended_apps_and_categories(cls, session: scoped_session, language: str):
        """
        Get recommended apps and categories.
        :param language: language
        :return:
        """
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        retrieval_instance = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)()
        result = retrieval_instance.get_recommended_apps_and_categories(language)
        if not result.get("recommended_apps"):
            result = (
                RecommendAppRetrievalFactory.get_buildin_recommend_app_retrieval().fetch_recommended_apps_from_builtin(
                    "en-US"
                )
            )

        if FeatureService.get_system_features().enable_trial_app:
            apps = result["recommended_apps"]
            for app in apps:
                app_id = app["app_id"]
                app["can_trial"] = cls._can_trial_app(session, app_id)
        return result

    @classmethod
    def get_learn_dify_apps(cls, session: scoped_session, language: str) -> dict[str, Any]:
        """
        Get database-backed recommended apps marked as Learn Dify.
        :param language: language
        :return:
        """
        result = DatabaseRecommendAppRetrieval.fetch_learn_dify_apps_from_db(language)

        if FeatureService.get_system_features().enable_trial_app:
            for app in result["recommended_apps"]:
                app["can_trial"] = cls._can_trial_app(session, app["app_id"])

        return {"recommended_apps": result["recommended_apps"]}

    @classmethod
    def get_recommend_app_detail(cls, session: scoped_session, app_id: str) -> dict[str, Any] | None:
        """
        Get recommend app detail.
        :param app_id: app id
        :return:
        """
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        retrieval_instance = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)()
        result: dict[str, Any] | None = retrieval_instance.get_recommend_app_detail(app_id)
        if result is None:
            return None
        if FeatureService.get_system_features().enable_trial_app:
            app_id = result["id"]
            result["can_trial"] = cls._can_trial_app(session, app_id)
        return result

    @classmethod
    def add_trial_app_record(cls, session: scoped_session, app_id: str, account_id: str):
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
    def _can_trial_app(session: scoped_session, app_id: str) -> bool:
        trial_app_model = session.scalar(select(TrialApp).where(TrialApp.app_id == app_id).limit(1))
        return trial_app_model is not None
