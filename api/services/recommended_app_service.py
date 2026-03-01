from configs import dify_config
from extensions.ext_database import db
from models.model import AccountTrialAppRecord, TrialApp
from services.feature_service import FeatureService
from services.recommend_app.recommend_app_factory import RecommendAppRetrievalFactory


class RecommendedAppService:
    @classmethod
    def get_recommended_apps_and_categories(cls, language: str):
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
                trial_app_model = db.session.query(TrialApp).where(TrialApp.app_id == app_id).first()
                if trial_app_model:
                    app["can_trial"] = True
                else:
                    app["can_trial"] = False
        return result

    @classmethod
    def get_recommend_app_detail(cls, app_id: str) -> dict | None:
        """
        Get recommend app detail.
        :param app_id: app id
        :return:
        """
        mode = dify_config.HOSTED_FETCH_APP_TEMPLATES_MODE
        retrieval_instance = RecommendAppRetrievalFactory.get_recommend_app_factory(mode)()
        result: dict = retrieval_instance.get_recommend_app_detail(app_id)
        if FeatureService.get_system_features().enable_trial_app:
            app_id = result["id"]
            trial_app_model = db.session.query(TrialApp).where(TrialApp.app_id == app_id).first()
            if trial_app_model:
                result["can_trial"] = True
            else:
                result["can_trial"] = False
        return result

    @classmethod
    def add_trial_app_record(cls, app_id: str, account_id: str):
        """
        Add trial app record.
        :param app_id: app id
        :return:
        """
        account_trial_app_record = (
            db.session.query(AccountTrialAppRecord)
            .where(AccountTrialAppRecord.app_id == app_id, AccountTrialAppRecord.account_id == account_id)
            .first()
        )
        if account_trial_app_record:
            account_trial_app_record.count += 1
            db.session.commit()
        else:
            db.session.add(AccountTrialAppRecord(app_id=app_id, count=1, account_id=account_id))
            db.session.commit()
