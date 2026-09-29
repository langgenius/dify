"""Database repository for web-app access queries."""

from typing import override
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, TimeoutError
from sqlalchemy.orm import Session, sessionmaker

from core.app.public_runtime import published_app_filter
from models.enums import AppStatus
from models.model import App, Site
from services.webapp_access_query_service import WebAppAccessQuery, WebAppAccessUnavailableError


class WebAppAccessQueryRepository(WebAppAccessQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def find_app_id_by_code(self, app_code: str) -> str | None:
        try:
            with self._session_factory() as session:
                app_id = session.scalar(
                    select(App.id)
                    .join(Site, Site.app_id == App.id)
                    .where(
                        Site.code == app_code,
                        Site.status == AppStatus.NORMAL,
                        App.status == AppStatus.NORMAL,
                        App.enable_site.is_(True),
                        published_app_filter(),
                    )
                    .limit(1)
                )
                return app_id if app_id is not None else None
        except (DBAPIError, TimeoutError) as e:
            raise WebAppAccessUnavailableError from e

    @override
    def is_app_available(self, app_id: str) -> bool:
        try:
            canonical_id = str(UUID(app_id))
        except ValueError:
            return False
        try:
            with self._session_factory() as session:
                return (
                    session.scalar(
                        select(App.id)
                        .join(Site, Site.app_id == App.id)
                        .where(
                            App.id == canonical_id,
                            Site.status == AppStatus.NORMAL,
                            App.status == AppStatus.NORMAL,
                            App.enable_site.is_(True),
                            published_app_filter(),
                        )
                        .limit(1)
                    )
                    is not None
                )
        except (DBAPIError, TimeoutError) as e:
            raise WebAppAccessUnavailableError from e
