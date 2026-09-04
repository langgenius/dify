"""Database repository for web-app access queries."""

from typing import override

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, TimeoutError
from sqlalchemy.orm import Session, sessionmaker

from models.model import App, EndUser, Site
from services.entities.authentication_entities import WebAppSessionRecord
from services.web_authentication_service import WebAppSessionQuery
from services.webapp_access_query_service import WebAppAccessQuery, WebAppAccessUnavailableError


class WebAppAccessQueryRepository(WebAppAccessQuery, WebAppSessionQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def find_app_id_by_code(self, app_code: str) -> str | None:
        try:
            with self._session_factory() as session:
                app_id = session.scalar(select(Site.app_id).where(Site.code == app_code).limit(1))
                return str(app_id) if app_id is not None else None
        except (DBAPIError, TimeoutError) as e:
            raise WebAppAccessUnavailableError from e

    @override
    def find_active_session(
        self,
        *,
        app_id: str,
        app_code: str,
        end_user_id: str,
    ) -> WebAppSessionRecord | None:
        try:
            with self._session_factory() as session:
                app = session.scalar(select(App).where(App.id == app_id).limit(1))
                site = session.scalar(select(Site).where(Site.code == app_code).limit(1))
                end_user = session.scalar(select(EndUser).where(EndUser.id == end_user_id).limit(1))
                if app is None or site is None or not app.enable_site or end_user is None:
                    return None
                return WebAppSessionRecord(end_user_session_id=end_user.session_id)
        except (DBAPIError, TimeoutError) as e:
            raise WebAppAccessUnavailableError from e
