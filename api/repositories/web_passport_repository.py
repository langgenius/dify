"""SQLAlchemy persistence adapter for web passport issuance."""

from collections.abc import Callable

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import AppStatus, EndUserType
from models.model import App, EndUser, Site
from services.entities.passport_entities import EndUserRecord, WebAppRecord, WebPassportEndUserResolution


class WebPassportRepository:
    def __init__(
        self,
        *,
        session_factory: sessionmaker[Session],
        generate_session_id: Callable[[], str],
    ) -> None:
        self._session_factory = session_factory
        self._generate_session_id = generate_session_id

    def get_active_web_app(self, app_code: str) -> WebAppRecord | None:
        stmt = self._active_web_app_stmt(app_code).limit(1)
        with self._session_factory() as session:
            row = session.execute(stmt).one_or_none()
        if row is None:
            return None
        site_id, app_id, tenant_id, persisted_app_code = row
        return WebAppRecord(
            site_id=str(site_id),
            app_id=str(app_id),
            tenant_id=str(tenant_id),
            app_code=str(persisted_app_code),
        )

    def is_web_app_active(self, app: WebAppRecord) -> bool:
        with self._session_factory() as session:
            return self._is_web_app_active(session, app)

    def resolve_standard_end_user(
        self,
        app: WebAppRecord,
        session_id: str | None,
    ) -> WebPassportEndUserResolution:
        with self._session_factory.begin() as session:
            if not self._is_web_app_active(session, app):
                return WebPassportEndUserResolution(app_active=False, end_user=None)

            if session_id:
                end_user = self._find_end_user_by_session_id(session, app, session_id)
                if end_user is not None:
                    return WebPassportEndUserResolution(app_active=True, end_user=end_user)
            else:
                session_id = self._generate_unique_session_id(session)

            end_user = self._create_anonymous_end_user(session, app, session_id)
            return WebPassportEndUserResolution(app_active=True, end_user=end_user)

    def resolve_authenticated_end_user(
        self,
        app: WebAppRecord,
        *,
        end_user_id: str | None,
        session_id: str | None,
    ) -> WebPassportEndUserResolution:
        with self._session_factory.begin() as session:
            if not self._is_web_app_active(session, app):
                return WebPassportEndUserResolution(app_active=False, end_user=None)

            end_user = None
            if session_id:
                end_user = self._find_end_user_by_session_id(session, app, session_id)
                if end_user is None:
                    end_user = self._create_anonymous_end_user(session, app, session_id)
            elif end_user_id:
                end_user = self._find_end_user_by_id(session, app, end_user_id)

            return WebPassportEndUserResolution(app_active=True, end_user=end_user)

    @staticmethod
    def _active_web_app_stmt(app_code: str):
        return (
            select(Site.id, App.id, App.tenant_id, Site.code)
            .join(App, App.id == Site.app_id)
            .where(
                Site.code == app_code,
                Site.status == AppStatus.NORMAL,
                App.status == AppStatus.NORMAL,
                App.enable_site.is_(True),
            )
        )

    def _is_web_app_active(self, session: Session, app: WebAppRecord) -> bool:
        stmt = self._active_web_app_stmt(app.app_code).where(
            Site.id == app.site_id,
            App.id == app.app_id,
            App.tenant_id == app.tenant_id,
        )
        return session.execute(stmt.limit(1)).one_or_none() is not None

    @staticmethod
    def _find_end_user_by_id(session: Session, app: WebAppRecord, end_user_id: str) -> EndUserRecord | None:
        persisted_id = session.scalar(
            select(EndUser.id).where(
                EndUser.id == end_user_id,
                EndUser.tenant_id == app.tenant_id,
                EndUser.app_id == app.app_id,
            )
        )
        return EndUserRecord(id=persisted_id) if persisted_id is not None else None

    @staticmethod
    def _find_end_user_by_session_id(
        session: Session,
        app: WebAppRecord,
        session_id: str,
    ) -> EndUserRecord | None:
        end_user_id = session.scalar(
            select(EndUser.id).where(
                EndUser.session_id == session_id,
                EndUser.tenant_id == app.tenant_id,
                EndUser.app_id == app.app_id,
            )
        )
        return EndUserRecord(id=end_user_id) if end_user_id is not None else None

    @staticmethod
    def _create_anonymous_end_user(
        session: Session,
        app: WebAppRecord,
        session_id: str,
    ) -> EndUserRecord:
        end_user = EndUser(
            tenant_id=app.tenant_id,
            app_id=app.app_id,
            type=EndUserType.BROWSER,
            is_anonymous=True,
            session_id=session_id,
        )
        session.add(end_user)
        session.flush()
        return EndUserRecord(id=end_user.id)

    def _generate_unique_session_id(self, session: Session) -> str:
        while True:
            session_id = self._generate_session_id()
            stmt = select(func.count()).select_from(EndUser).where(EndUser.session_id == session_id)
            if not session.scalar(stmt):
                return session_id
