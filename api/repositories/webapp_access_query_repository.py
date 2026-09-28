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
                return app_id if app_id is not None else None
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
        stmt = (
            select(EndUser.session_id)
            .select_from(Site)
            .join(App, App.id == Site.app_id)
            .join(EndUser, EndUser.app_id == App.id)
            .where(
                Site.code == app_code,
                App.id == app_id,
                App.enable_site.is_(True),
                EndUser.id == end_user_id,
                EndUser.tenant_id == App.tenant_id,
            )
            .limit(1)
        )
        try:
            with self._session_factory() as session:
                session_id = session.scalar(stmt)
                if session_id is None:
                    return None
                return WebAppSessionRecord(end_user_session_id=session_id)
        except (DBAPIError, TimeoutError) as e:
            raise WebAppAccessUnavailableError from e
