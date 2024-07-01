import json
import logging
from os import path
from typing import Optional

import requests
from flask import current_app

from constants.languages import languages
from extensions.ext_database import db
from models.model import App, RecommendedApp
from services.app_service import AppService

logger = logging.getLogger(__name__)


class RecommendedAppService:

    builtin_data: Optional[dict] = None

    @classmethod
    def get_recommended_apps_and_categories(cls, language: str) -> dict:
        """
        Get recommended apps and categories.
        :param language: language
        :return:
        """
        mode = current_app.config.get('HOSTED_FETCH_APP_TEMPLATES_MODE', 'remote')
        if mode == 'remote':
            try:
                result = cls._fetch_recommended_apps_from_dify_official(language)
            except Exception as e:
                logger.warning(f'fetch recommended apps from dify official failed: {e}, switch to built-in.')
                result = cls._fetch_recommended_apps_from_builtin(language)
        elif mode == 'db':
            result = cls._fetch_recommended_apps_from_db(language)
        elif mode == 'builtin':
            result = cls._fetch_recommended_apps_from_builtin(language)
        else:
            raise ValueError(f'invalid fetch recommended apps mode: {mode}')

        if not result.get('recommended_apps') and language != 'en-US':
            result = cls._fetch_recommended_apps_from_builtin('en-US')

        return result

    @classmethod
    def _fetch_recommended_apps_from_db(cls, language: str) -> dict:
        """
        Fetch recommended apps from db.
        :param language: language
        :return:
        """
        recommended_apps = db.session.query(RecommendedApp).filter(
            RecommendedApp.is_listed == True,
            RecommendedApp.language == language
        ).all()

        if len(recommended_apps) == 0:
            recommended_apps = db.session.query(RecommendedApp).filter(
                RecommendedApp.is_listed == True,
                RecommendedApp.language == languages[0]
            ).all()

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
                'id': recommended_app.id,
                'app': {
                    'id': app.id,
                    'name': app.name,
                    'mode': app.mode,
                    'icon': app.icon,
                    'icon_background': app.icon_background
                },
                'app_id': recommended_app.app_id,
                'description': site.description,
                'copyright': site.copyright,
                'privacy_policy': site.privacy_policy,
                'custom_disclaimer': site.custom_disclaimer,
                'category': recommended_app.category,
                'position': recommended_app.position,
                'is_listed': recommended_app.is_listed
            }
            recommended_apps_result.append(recommended_app_result)

            categories.add(recommended_app.category)  # add category to categories

        return {'recommended_apps': recommended_apps_result, 'categories': sorted(categories)}

    @classmethod
    def _fetch_recommended_apps_from_dify_official(cls, language: str) -> dict:
        """
        Fetch recommended apps from dify official.
        :param language: language
        :return:
        """
        domain = current_app.config.get('HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN', 'https://tmpl.dify.ai')
        url = f'{domain}/apps?language={language}'
        response = requests.get(url, timeout=(3, 10))
        if response.status_code != 200:
            raise ValueError(f'fetch recommended apps failed, status code: {response.status_code}')

        return response.json()

    @classmethod
    def _fetch_recommended_apps_from_builtin(cls, language: str) -> dict:
        """
        Fetch recommended apps from builtin.
        :param language: language
        :return:
        """
        builtin_data = cls._get_builtin_data()
        return builtin_data.get('recommended_apps', {}).get(language)

    @classmethod
    def get_recommend_app_detail(cls, app_id: str) -> Optional[dict]:
        """
        Get recommend app detail.
        :param app_id: app id
        :return:
        """
        mode = current_app.config.get('HOSTED_FETCH_APP_TEMPLATES_MODE', 'remote')
        if mode == 'remote':
            try:
                result = cls._fetch_recommended_app_detail_from_dify_official(app_id)
            except Exception as e:
                logger.warning(f'fetch recommended app detail from dify official failed: {e}, switch to built-in.')
                result = cls._fetch_recommended_app_detail_from_builtin(app_id)
        elif mode == 'db':
            result = cls._fetch_recommended_app_detail_from_db(app_id)
        elif mode == 'builtin':
            result = cls._fetch_recommended_app_detail_from_builtin(app_id)
        else:
            raise ValueError(f'invalid fetch recommended app detail mode: {mode}')

        return result

    @classmethod
    def _fetch_recommended_app_detail_from_dify_official(cls, app_id: str) -> Optional[dict]:
        """
        Fetch recommended app detail from dify official.
        :param app_id: App ID
        :return:
        """
        domain = current_app.config.get('HOSTED_FETCH_APP_TEMPLATES_REMOTE_DOMAIN', 'https://tmpl.dify.ai')
        url = f'{domain}/apps/{app_id}'
        response = requests.get(url, timeout=(3, 10))
        if response.status_code != 200:
            return None

        return response.json()

    @classmethod
    def _fetch_recommended_app_detail_from_db(cls, app_id: str) -> Optional[dict]:
        """
        Fetch recommended app detail from db.
        :param app_id: App ID
        :return:
        """
        # is in public recommended list
        recommended_app = db.session.query(RecommendedApp).filter(
            RecommendedApp.is_listed == True,
            RecommendedApp.app_id == app_id
        ).first()

        if not recommended_app:
            return None

        # get app detail
        app_model = db.session.query(App).filter(App.id == app_id).first()
        if not app_model or not app_model.is_public:
            return None

        app_service = AppService()
        export_str = app_service.export_app(app_model)

        return {
            'id': app_model.id,
            'name': app_model.name,
            'icon': app_model.icon,
            'icon_background': app_model.icon_background,
            'mode': app_model.mode,
            'export_data': export_str
        }

    @classmethod
    def _fetch_recommended_app_detail_from_builtin(cls, app_id: str) -> Optional[dict]:
        """
        Fetch recommended app detail from builtin.
        :param app_id: App ID
        :return:
        """
        builtin_data = cls._get_builtin_data()
        return builtin_data.get('app_details', {}).get(app_id)

    @classmethod
    def _get_builtin_data(cls) -> dict:
        """
        Get builtin data.
        :return:
        """
        if cls.builtin_data:
            return cls.builtin_data

        root_path = current_app.root_path
        with open(path.join(root_path, 'constants', 'recommended_apps.json'), encoding='utf-8') as f:
            json_data = f.read()
            data = json.loads(json_data)
            cls.builtin_data = data

        return cls.builtin_data

    @classmethod
    def fetch_all_recommended_apps_and_export_datas(cls):
        """
        Fetch all recommended apps and export datas
        :return:
        """
        templates = {
            "recommended_apps": {},
            "app_details": {}
        }
        for language in languages:
            try:
                result = cls._fetch_recommended_apps_from_dify_official(language)
            except Exception as e:
                logger.warning(f'fetch recommended apps from dify official failed: {e}, skip.')
                continue

            templates['recommended_apps'][language] = result

            for recommended_app in result.get('recommended_apps'):
                app_id = recommended_app.get('app_id')

                # get app detail
                app_detail = cls._fetch_recommended_app_detail_from_dify_official(app_id)
                if not app_detail:
                    continue

                templates['app_details'][app_id] = app_detail

        return templates
