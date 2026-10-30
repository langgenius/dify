import pytest
from sqlalchemy.orm import Session

from models.model import App, IconType
from repositories.app.console_repository import ConsoleAppRepository
from services.errors.file import UploadFileReferenceNotFoundError
from tests.unit_tests.model_factories import make_app, make_upload_file


def test_update_icon_validates_new_image_in_owner_transaction(sqlite_session: Session) -> None:
    app = make_app(icon_type=IconType.IMAGE, icon="historical-missing")
    sqlite_session.add_all([app, make_upload_file(file_id="new-image")])
    sqlite_session.commit()

    updated = ConsoleAppRepository.update_app_icon(
        app,
        "new-image",
        "#000000",
        IconType.IMAGE,
        account_id="account-1",
        session=sqlite_session,
    )

    assert updated.icon == "new-image"


def test_update_icon_rejects_missing_new_image_without_overwriting_owner(sqlite_session: Session) -> None:
    app = make_app(icon_type=IconType.EMOJI, icon="🤖")
    sqlite_session.add(app)
    sqlite_session.commit()

    with pytest.raises(UploadFileReferenceNotFoundError):
        ConsoleAppRepository.update_app_icon(
            app,
            "missing-image",
            "#000000",
            IconType.IMAGE,
            account_id="account-1",
            session=sqlite_session,
        )
    sqlite_session.rollback()
    persisted = sqlite_session.get(App, app.id)
    assert persisted is not None
    assert persisted.icon_type == IconType.EMOJI
    assert persisted.icon == "🤖"


def test_unrelated_app_edit_does_not_revalidate_unchanged_historical_icon(sqlite_session: Session) -> None:
    app = make_app(icon_type=IconType.IMAGE, icon="historical-missing")
    sqlite_session.add(app)
    sqlite_session.commit()

    updated = ConsoleAppRepository.update_app_fields(
        app,
        {"name": "Renamed"},
        account_id="account-1",
        session=sqlite_session,
    )

    assert updated.name == "Renamed"
    assert updated.icon == "historical-missing"
