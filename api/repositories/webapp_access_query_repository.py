"""Database repository for web-app access queries."""

from typing import override

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, TimeoutError
from sqlalchemy.orm import Session, sessionmaker

from models.model import Site
from services.webapp_access_query_service import WebAppAccessQuery, WebAppAccessUnavailableError


class WebAppAccessQueryRepository(WebAppAccessQuery):
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
