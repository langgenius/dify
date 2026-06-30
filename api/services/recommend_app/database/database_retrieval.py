from typing import Any, NotRequired, TypedDict, override

from sqlalchemy import select
from sqlalchemy.orm import Session, scoped_session

from constants.languages import languages
from models.model import App, RecommendedApp
from services.app_dsl_service import AppDslService
from services.recommend_app.category_order import order_categories
from services.recommend_app.recommend_app_base import RecommendAppRetrievalBase
from services.recommend_app.recommend_app_type import RecommendAppType


class RecommendedAppItemDict(TypedDict):
    id: str
    app: App | None
    app_id: str
    description: Any
    copyright: Any
    privacy_policy: Any
    custom_disclaimer: str
    categories: list[str]
    position: int
    is_listed: bool
    can_trial: NotRequired[bool]


class RecommendedAppsResultDict(TypedDict):
    recommended_apps: list[RecommendedAppItemDict]
    categories: list[str]


class RecommendedAppDetailDict(TypedDict):
    id: str
    name: str
    icon: Any
    icon_background: str | None
    mode: str
    export_data: str


class DatabaseRecommendAppRetrieval(RecommendAppRetrievalBase):
    """
    Retrieval recommended app from database
    """

    @override
    def get_recommended_apps_and_categories(
        self, language: str, *, session: scoped_session | Session
    ) -> RecommendedAppsResultDict:
        result = self.fetch_recommended_apps_from_db(language, session=session)
        return result

    @override
    def get_learn_dify_apps(self, language: str, *, session: scoped_session | Session) -> RecommendedAppsResultDict:
        result = self.fetch_learn_dify_apps_from_db(language, session=session)
        return result

    @override
    def get_recommend_app_detail(
        self, app_id: str, *, session: scoped_session | Session
    ) -> RecommendedAppDetailDict | None:
        result = self.fetch_recommended_app_detail_from_db(app_id, session=session)
        return result

    @override
    def get_type(self) -> str:
        return RecommendAppType.DATABASE

    @classmethod
    def fetch_recommended_apps_from_db(
        cls, language: str, *, session: scoped_session | Session
    ) -> RecommendedAppsResultDict:
        """
        Fetch recommended apps from db.
        :param language: language
        :return:
        """
        recommended_apps = cls._fetch_listed_recommended_apps(language, session=session)

        if len(recommended_apps) == 0:
            recommended_apps = cls._fetch_listed_recommended_apps(languages[0], session=session)

        return cls._format_recommended_apps(recommended_apps, language)

    @classmethod
    def fetch_learn_dify_apps_from_db(
        cls, language: str, *, session: scoped_session | Session
    ) -> RecommendedAppsResultDict:
        """
        Fetch listed recommended apps explicitly marked for the Learn Dify section.
        :param language: language
        :return:
        """
        recommended_apps = cls._fetch_listed_recommended_apps(language, session=session, is_learn_dify=True)

        if len(recommended_apps) == 0 and language != languages[0]:
            recommended_apps = cls._fetch_listed_recommended_apps(languages[0], session=session, is_learn_dify=True)

        return cls._format_recommended_apps(recommended_apps, language)

    @classmethod
    def _fetch_listed_recommended_apps(
        cls, language: str, *, session: scoped_session | Session, is_learn_dify: bool | None = None
    ) -> list[RecommendedApp]:
        filters = [RecommendedApp.is_listed.is_(True), RecommendedApp.language == language]
        if is_learn_dify is not None:
            filters.append(RecommendedApp.is_learn_dify.is_(is_learn_dify))

        return list(session.scalars(select(RecommendedApp).where(*filters)).all())

    @classmethod
    def _format_recommended_apps(
        cls, recommended_apps: list[RecommendedApp], language: str
    ) -> RecommendedAppsResultDict:
        """
        Serialize DB recommended app rows into the Explore list response shape.
        :param recommended_apps: recommended app rows
        :param language: language used for category ordering
        :return:
        """

        categories = set()
        recommended_apps_result: list[RecommendedAppItemDict] = []
        for recommended_app in recommended_apps:
            app = recommended_app.app
            if not app or not app.is_public:
                continue

            site = app.site
            if not site:
                continue

            app_categories = recommended_app.categories or []
            recommended_app_result: RecommendedAppItemDict = {
                "id": recommended_app.id,
                "app": recommended_app.app,
                "app_id": recommended_app.app_id,
                "description": site.description,
                "copyright": site.copyright,
                "privacy_policy": site.privacy_policy,
                "custom_disclaimer": site.custom_disclaimer,
                "categories": app_categories,
                "position": recommended_app.position,
                "is_listed": recommended_app.is_listed,
            }
            recommended_apps_result.append(recommended_app_result)

            categories.update(app_categories)

        return RecommendedAppsResultDict(
            recommended_apps=recommended_apps_result,
            categories=order_categories(categories, language),
        )

    @classmethod
    def fetch_recommended_app_detail_from_db(
        cls, app_id: str, *, session: scoped_session | Session
    ) -> RecommendedAppDetailDict | None:
        """
        Fetch recommended app detail from db.
        :param app_id: App ID
        :return:
        """
        # is in public recommended list
        recommended_app = session.scalar(
            select(RecommendedApp).where(RecommendedApp.is_listed == True, RecommendedApp.app_id == app_id).limit(1)
        )

        if not recommended_app:
            return None

        # get app detail
        app_model = session.get(App, app_id)
        if not app_model or not app_model.is_public:
            return None

        return RecommendedAppDetailDict(
            id=app_model.id,
            name=app_model.name,
            icon=app_model.icon,
            icon_background=app_model.icon_background,
            mode=app_model.mode,
            export_data=AppDslService.export_dsl(app_model=app_model, session=session),
        )
