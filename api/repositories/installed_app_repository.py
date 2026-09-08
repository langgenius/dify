"""Persist workspace installations with independently scoped operations."""

from datetime import datetime
from itertools import starmap
from typing import cast, override

from sqlalchemy import ColumnElement, UnaryExpression, and_, exists, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, sessionmaker

from libs.helper import escape_like_pattern
from models.model import App, AppMode, AppModelConfig, InstalledApp
from models.workflow import Workflow
from services.installed_app_access_service import InstalledAppAccessStore, InstalledAppNotFoundError, InstalledAppRef
from services.installed_app_generation_service import InstalledAppUsageRecorder
from services.installed_app_service import (
    InstalledAppCursor,
    InstalledAppInfo,
    InstalledAppOwnedByWorkspaceError,
    InstalledAppRecord,
    InstalledAppStore,
)


def _published_app_filter() -> ColumnElement[bool]:
    """Match the model configuration used by installed-app parameters.

    Keep the existing publication reference policy: workflow version, public
    visibility and site settings do not decide whether an installation is listed.
    """
    workflow_app_modes = (AppMode.ADVANCED_CHAT, AppMode.WORKFLOW)
    has_published_workflow = exists(select(Workflow.id).where(Workflow.id == App.workflow_id))
    has_published_model_config = exists(select(AppModelConfig.id).where(AppModelConfig.id == App.app_model_config_id))
    return and_(
        App.mode != AppMode.AGENT,
        or_(
            and_(App.mode.in_(workflow_app_modes), App.workflow_id.isnot(None), has_published_workflow),
            and_(~App.mode.in_(workflow_app_modes), App.app_model_config_id.isnot(None), has_published_model_config),
        ),
    )


def _installed_app_cursor_filter(cursor: InstalledAppCursor) -> ColumnElement[bool]:
    same_pin_group = InstalledApp.is_pinned == cursor.is_pinned
    if cursor.last_used_at is None:
        later_in_pin_group = and_(
            InstalledApp.last_used_at.is_(None),
            InstalledApp.id > cursor.installed_app_id,
        )
    else:
        later_in_pin_group = or_(
            InstalledApp.last_used_at < cursor.last_used_at,
            InstalledApp.last_used_at.is_(None),
            and_(
                InstalledApp.last_used_at == cursor.last_used_at,
                InstalledApp.id > cursor.installed_app_id,
            ),
        )
    if cursor.is_pinned:
        return or_(InstalledApp.is_pinned.is_(False), and_(same_pin_group, later_in_pin_group))
    return and_(same_pin_group, later_in_pin_group)


def _installed_app_order_by() -> tuple[UnaryExpression[bool], UnaryExpression[datetime | None], UnaryExpression[str]]:
    return (
        InstalledApp.is_pinned.desc(),
        InstalledApp.last_used_at.desc().nulls_last(),
        InstalledApp.id.asc(),
    )


def _to_record(installed_app: InstalledApp, app: App) -> InstalledAppRecord:
    return InstalledAppRecord(
        id=installed_app.id,
        app=InstalledAppInfo(
            id=app.id,
            name=app.name,
            description=app.description,
            mode=app.mode,
            icon_type=app.icon_type,
            icon=app.icon,
            icon_background=app.icon_background,
            use_icon_as_answer_icon=app.use_icon_as_answer_icon,
        ),
        app_owner_tenant_id=installed_app.app_owner_tenant_id,
        is_pinned=installed_app.is_pinned,
        last_used_at=installed_app.last_used_at,
    )


class SQLAlchemyInstalledAppRepository(InstalledAppAccessStore, InstalledAppUsageRecorder, InstalledAppStore):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory: sessionmaker[Session] = session_factory

    @override
    def resolve(self, *, installed_app_id: str, tenant_id: str) -> InstalledAppRef | None:
        with self._session_factory() as session:
            installed_app = session.scalar(
                select(InstalledApp)
                .where(InstalledApp.id == installed_app_id, InstalledApp.tenant_id == tenant_id)
                .limit(1)
            )
            if installed_app is None:
                return None

            # An installed public app can belong to another workspace. Admission
            # preserves the existence check; publication policy belongs to its callers.
            app = session.execute(select(App.id, App.mode).where(App.id == installed_app.app_id).limit(1)).first()
            if app is None:
                session.delete(installed_app)
                session.commit()
                return None

            return InstalledAppRef(
                id=installed_app.id, app_id=app.id, tenant_id=installed_app.tenant_id, app_mode=app.mode.value
            )

    @override
    def record(self, *, installed_app: InstalledAppRef, used_at: datetime) -> None:
        """Commit usage independently so generation failures do not roll it back."""
        with self._session_factory.begin() as session:
            result = session.execute(
                update(InstalledApp)
                .where(
                    InstalledApp.id == installed_app.id,
                    InstalledApp.tenant_id == installed_app.tenant_id,
                    InstalledApp.app_id == installed_app.app_id,
                )
                .values(last_used_at=used_at)
            )
            if cast(CursorResult, result).rowcount == 0:
                raise InstalledAppNotFoundError(f"Installed app {installed_app.id} no longer exists")

    @override
    def get_candidates(
        self,
        *,
        tenant_id: str,
        cursor: InstalledAppCursor | None,
        limit: int,
        app_id: str | None,
        name: str | None,
    ) -> tuple[InstalledAppRecord, ...]:
        statement = (
            select(InstalledApp, App)
            .join(App, App.id == InstalledApp.app_id)
            .where(InstalledApp.tenant_id == tenant_id, _published_app_filter())
        )
        if app_id:
            statement = statement.where(InstalledApp.app_id == app_id)
        if name and (normalized_name := name.strip()):
            escaped_name = escape_like_pattern(normalized_name)
            statement = statement.where(App.name.ilike(f"%{escaped_name}%", escape="\\"))
        if cursor is not None:
            statement = statement.where(_installed_app_cursor_filter(cursor))
        with self._session_factory() as session:
            rows = session.execute(statement.order_by(*_installed_app_order_by()).limit(limit))
            return tuple(starmap(_to_record, rows))

    @override
    def get_published(self, *, installed_app: InstalledAppRef) -> InstalledAppRecord | None:
        with self._session_factory() as session:
            row = session.execute(
                select(InstalledApp, App)
                .join(App, App.id == InstalledApp.app_id)
                .where(
                    InstalledApp.id == installed_app.id,
                    InstalledApp.tenant_id == installed_app.tenant_id,
                    InstalledApp.app_id == installed_app.app_id,
                    _published_app_filter(),
                )
                .limit(1)
            ).first()
            return None if row is None else _to_record(row[0], row[1])

    @override
    def uninstall(self, *, installed_app: InstalledAppRef) -> None:
        with self._session_factory.begin() as session:
            installation = session.scalar(
                select(InstalledApp).where(
                    InstalledApp.id == installed_app.id,
                    InstalledApp.tenant_id == installed_app.tenant_id,
                    InstalledApp.app_id == installed_app.app_id,
                )
            )
            if installation is None:
                raise InstalledAppNotFoundError(f"Installed app {installed_app.id} no longer exists")
            if installation.app_owner_tenant_id == installed_app.tenant_id:
                raise InstalledAppOwnedByWorkspaceError(f"Installed app {installed_app.id} is owned by this workspace")
            session.delete(installation)

    @override
    def set_pinned(self, *, installed_app: InstalledAppRef, is_pinned: bool) -> None:
        with self._session_factory.begin() as session:
            result = session.execute(
                update(InstalledApp)
                .where(
                    InstalledApp.id == installed_app.id,
                    InstalledApp.tenant_id == installed_app.tenant_id,
                    InstalledApp.app_id == installed_app.app_id,
                )
                .values(is_pinned=is_pinned)
            )
            if cast(CursorResult, result).rowcount == 0:
                raise InstalledAppNotFoundError(f"Installed app {installed_app.id} no longer exists")
