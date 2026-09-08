from datetime import UTC, datetime

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole, CustomizeTokenStrategy
from models.model import App, AppMode, IconType, Site, UploadFile
from repositories.app_site_command_repository import AppSiteCommandRepository
from services.app_site_service import AppSiteAppNotFoundError, AppSiteChanges, AppSiteNotFoundError
from services.icon_configuration_service import IconConfigurationError

_APP_ID = "11111111-1111-1111-1111-111111111111"
_WORKSPACE_ID = "22222222-2222-2222-2222-222222222222"
_OTHER_WORKSPACE_ID = "33333333-3333-3333-3333-333333333333"
_ACTOR_ID = "44444444-4444-4444-4444-444444444444"
_FILE_ID = "55555555-5555-5555-5555-555555555555"


def _persist_app(session: Session, *, with_site: bool = True) -> None:
    app = App(
        id=_APP_ID,
        tenant_id=_WORKSPACE_ID,
        name="Site App",
        description="",
        mode=AppMode.CHAT,
        icon_type=None,
        icon=None,
        icon_background=None,
        enable_site=True,
        enable_api=True,
    )
    session.add(app)
    if with_site:
        session.add(
            Site(
                app_id=_APP_ID,
                title="Original",
                description="Original description",
                default_language="en-US",
                input_placeholder="Original placeholder",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
                prompt_public=False,
                show_workflow_steps=True,
                use_icon_as_answer_icon=False,
                code="old-code",
            )
        )
    session.commit()


def _repository(session_factory: sessionmaker[Session]) -> AppSiteCommandRepository:
    return AppSiteCommandRepository(session_factory=session_factory)


def test_update_preserves_none_and_writes_false_and_empty_values(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app(sqlite_session)

    result = _repository(sqlite_session_factory).update_site(
        workspace_id=_WORKSPACE_ID,
        app_id=_APP_ID,
        actor_id=_ACTOR_ID,
        changes=AppSiteChanges(
            title=None,
            input_placeholder="",
            customize_token_strategy="allow",
            show_workflow_steps=False,
        ),
    )

    assert result.title == "Original"
    assert result.input_placeholder == ""
    assert result.customize_token_strategy == "allow"
    assert result.show_workflow_steps is False
    with sqlite_session_factory() as session:
        site = session.scalar(select(Site).where(Site.app_id == _APP_ID))
        assert site is not None
        assert site.title == "Original"
        assert site.input_placeholder == ""
        assert site.customize_token_strategy == CustomizeTokenStrategy.ALLOW
        assert site.show_workflow_steps is False
        assert site.updated_by == _ACTOR_ID


def test_update_scopes_app_to_workspace_and_distinguishes_missing_site(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app(sqlite_session)
    repository = _repository(sqlite_session_factory)

    with pytest.raises(AppSiteAppNotFoundError):
        repository.update_site(
            workspace_id=_OTHER_WORKSPACE_ID,
            app_id=_APP_ID,
            actor_id=_ACTOR_ID,
            changes=AppSiteChanges(title="Leaked"),
        )

    with sqlite_session_factory.begin() as session:
        session.execute(delete(Site).where(Site.app_id == _APP_ID))

    with pytest.raises(AppSiteNotFoundError):
        repository.update_site(
            workspace_id=_WORKSPACE_ID,
            app_id=_APP_ID,
            actor_id=_ACTOR_ID,
            changes=AppSiteChanges(title="Missing"),
        )


def test_update_rolls_back_when_a_site_field_rejects_the_value(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app(sqlite_session)

    with pytest.raises(ValueError, match="cannot exceed 512"):
        _repository(sqlite_session_factory).update_site(
            workspace_id=_WORKSPACE_ID,
            app_id=_APP_ID,
            actor_id=_ACTOR_ID,
            changes=AppSiteChanges(title="Changed", custom_disclaimer="x" * 513),
        )

    with sqlite_session_factory() as session:
        site = session.scalar(select(Site).where(Site.app_id == _APP_ID))
        assert site is not None
        assert site.title == "Original"
        assert site.updated_by is None


def test_update_rejects_cross_workspace_icon_reference(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_app(sqlite_session)
    upload_file = UploadFile(
        tenant_id=_OTHER_WORKSPACE_ID,
        storage_type=StorageType.LOCAL,
        key=f"upload_files/{_OTHER_WORKSPACE_ID}/icon.png",
        name="icon.png",
        size=10,
        extension="png",
        mime_type="image/png",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=_ACTOR_ID,
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
        used=True,
    )
    upload_file.id = _FILE_ID
    sqlite_session.add(upload_file)
    sqlite_session.commit()

    with pytest.raises(IconConfigurationError, match="missing or does not belong"):
        _repository(sqlite_session_factory).update_site(
            workspace_id=_WORKSPACE_ID,
            app_id=_APP_ID,
            actor_id=_ACTOR_ID,
            changes=AppSiteChanges(icon_type=IconType.IMAGE.value, icon=_FILE_ID),
        )

    with sqlite_session_factory() as session:
        site = session.scalar(select(Site).where(Site.app_id == _APP_ID))
        assert site is not None
        assert site.icon_type is None
        assert site.icon is None


def test_reset_access_token_uses_the_owned_transaction(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _persist_app(sqlite_session)
    observed_session: Session | None = None

    def generate_code(length: int, *, session: Session) -> str:
        nonlocal observed_session
        observed_session = session
        assert length == 16
        assert session.in_transaction()
        return "new-code"

    monkeypatch.setattr(Site, "generate_code", generate_code)

    result = _repository(sqlite_session_factory).reset_access_token(
        workspace_id=_WORKSPACE_ID,
        app_id=_APP_ID,
        actor_id=_ACTOR_ID,
    )

    assert observed_session is not None
    assert result.code == "new-code"
    with sqlite_session_factory() as session:
        site = session.scalar(select(Site).where(Site.app_id == _APP_ID))
        assert site is not None
        assert site.code == "new-code"
        assert site.updated_by == _ACTOR_ID
