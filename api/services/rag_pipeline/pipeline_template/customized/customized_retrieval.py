from typing import Optional

from constants.languages import languages
from extensions.ext_database import db
from models.model import App, RecommendedApp
from services.app_dsl_service import AppDslService
from services.rag_pipeline.pipeline_template.pipeline_template_base import PipelineTemplateRetrievalBase
from services.rag_pipeline.pipeline_template.pipeline_template_type import PipelineTemplateType


class CustomizedPipelineTemplateRetrieval(PipelineTemplateRetrievalBase):
    """
    Retrieval recommended app from database
    """

    def get_pipeline_templates(self, language: str) -> dict:
        result = self.fetch_pipeline_templates_from_db(language)
        return result

    def get_pipeline_template_detail(self, pipeline_id: str):
        result = self.fetch_pipeline_template_detail_from_db(pipeline_id)
        return result

    def get_type(self) -> str:
        return PipelineTemplateType.CUSTOMIZED

    @classmethod
    def fetch_recommended_apps_from_db(cls, language: str) -> dict:
        """
        Fetch recommended apps from db.
        :param language: language
        :return:
        """
        recommended_apps = (
            db.session.query(RecommendedApp)
            .filter(RecommendedApp.is_listed == True, RecommendedApp.language == language)
            .all()
        )

        if len(recommended_apps) == 0:
            recommended_apps = (
                db.session.query(RecommendedApp)
                .filter(RecommendedApp.is_listed == True, RecommendedApp.language == languages[0])
                .all()
            )

        categories = set()
        recommended_apps_result = []
        for recommended_app in recommended_apps:
            app = recommended_app.app
            if not app or not app.is_public:
                continue

            site = app.site
            if not site:
                continue

            recommended_app_result = {
                "id": recommended_app.id,
                "app": recommended_app.app,
                "app_id": recommended_app.app_id,
                "description": site.description,
                "copyright": site.copyright,
                "privacy_policy": site.privacy_policy,
                "custom_disclaimer": site.custom_disclaimer,
                "category": recommended_app.category,
                "position": recommended_app.position,
                "is_listed": recommended_app.is_listed,
            }
            recommended_apps_result.append(recommended_app_result)

            categories.add(recommended_app.category)

        return {"recommended_apps": recommended_apps_result, "categories": sorted(categories)}

    @classmethod
    def fetch_recommended_app_detail_from_db(cls, app_id: str) -> Optional[dict]:
        """
        Fetch recommended app detail from db.
        :param app_id: App ID
        :return:
        """
        # is in public recommended list
        recommended_app = (
            db.session.query(RecommendedApp)
            .filter(RecommendedApp.is_listed == True, RecommendedApp.app_id == app_id)
            .first()
        )

        if not recommended_app:
            return None

        # get app detail
        app_model = db.session.query(App).filter(App.id == app_id).first()
        if not app_model or not app_model.is_public:
            return None

        return {
            "id": app_model.id,
            "name": app_model.name,
            "icon": app_model.icon,
            "icon_background": app_model.icon_background,
            "mode": app_model.mode,
            "export_data": AppDslService.export_dsl(app_model=app_model),
        }
