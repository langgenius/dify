from collections.abc import Callable
from unittest.mock import MagicMock
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from fields.end_user_fields import EndUserDetail, SimpleEndUser
from models.enums import CustomizeTokenStrategy, EndUserType
from models.model import App, AppMode, EndUser, IconType, Site
from repositories.app_scoped_end_user_repository import AppScopedEndUserRepo
from repositories.web_passport_repository import WebPassportRepository


def _stable_uuid(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def _persist_webapp(
    session: Session,
    *,
    app_code: str = "code",
    identity: str | None = None,
    enable_site: bool = True,
) -> tuple[App, Site]:
    identity = identity or app_code
    app = App(
        id=_stable_uuid(f"app:{identity}"),
        tenant_id=_stable_uuid(f"tenant:{identity}"),
        name="Web App",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        enable_site=enable_site,
        enable_api=False,
    )
    site = Site(
        id=_stable_uuid(f"site:{identity}"),
        app_id=app.id,
        title="Web App Site",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code=app_code,
    )
    session.add_all([app, site])
    session.commit()
    return app, site


def _repository(
    session_factory: sessionmaker[Session],
    *,
    generate_session_id: Callable[[], str] | None = None,
) -> WebPassportRepository:
    return WebPassportRepository(
        session_factory=session_factory,
        generate_session_id=generate_session_id or (lambda: "generated-session"),
    )


def test_get_active_web_app_returns_detached_record(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, site = _persist_webapp(sqlite_session)
    repository = _repository(sqlite_session_factory)

    record = repository.get_active_web_app("code")

    assert record is not None
    assert (record.site_id, record.app_id, record.tenant_id, record.app_code) == (
        site.id,
        app.id,
        app.tenant_id,
        "code",
    )


def test_get_active_web_app_rejects_disabled_app(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp(sqlite_session, enable_site=False)
    repository = _repository(sqlite_session_factory)

    assert repository.get_active_web_app("code") is None


def test_get_active_web_app_accepts_duplicate_site_codes(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    first_app, _ = _persist_webapp(sqlite_session, app_code="duplicate", identity="first")
    second_app, _ = _persist_webapp(sqlite_session, app_code="duplicate", identity="second")
    repository = _repository(sqlite_session_factory)

    record = repository.get_active_web_app("duplicate")

    assert record is not None
    assert record.app_id in {first_app.id, second_app.id}


def test_is_web_app_active_revalidates_site_code(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _, site = _persist_webapp(sqlite_session)
    repository = _repository(sqlite_session_factory)
    record = repository.get_active_web_app("code")
    assert record is not None
    assert repository.is_web_app_active(record) is True

    site.code = "reset-code"
    sqlite_session.commit()

    assert repository.is_web_app_active(record) is False


def test_resolve_standard_end_user_revalidates_app_in_transaction(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    app, _ = _persist_webapp(sqlite_session)
    repository = _repository(sqlite_session_factory)
    record = repository.get_active_web_app("code")
    assert record is not None

    app.enable_site = False
    sqlite_session.commit()

    resolution = repository.resolve_standard_end_user(record, "session")

    assert resolution.app_active is False
    assert resolution.end_user is None
    assert sqlite_session.scalar(select(EndUser).where(EndUser.session_id == "session")) is None


def test_resolve_standard_end_user_reuses_or_creates_within_webapp(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp(sqlite_session, app_code="one")
    _persist_webapp(sqlite_session, app_code="two")
    repository = _repository(sqlite_session_factory)
    app_one = repository.get_active_web_app("one")
    app_two = repository.get_active_web_app("two")
    assert app_one is not None
    assert app_two is not None

    created = repository.resolve_standard_end_user(app_one, "shared-session")
    reused = repository.resolve_standard_end_user(app_one, "shared-session")
    other_app = repository.resolve_standard_end_user(app_two, "shared-session")
    assert created.app_active is True
    assert created.end_user is not None
    assert reused.end_user == created.end_user
    assert other_app.end_user is not None
    assert other_app.end_user != created.end_user

    sqlite_session.expire_all()
    persisted = sqlite_session.scalar(select(EndUser).where(EndUser.id == created.end_user.id))
    assert persisted is not None
    assert persisted.type == EndUserType.BROWSER
    assert persisted.app_id == app_one.app_id


def test_resolve_authenticated_end_user_prefers_session_identity(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp(sqlite_session)
    repository = _repository(sqlite_session_factory)
    app = repository.get_active_web_app("code")
    assert app is not None
    existing = repository.resolve_standard_end_user(app, "existing-session")
    assert existing.end_user is not None

    resolution = repository.resolve_authenticated_end_user(
        app,
        end_user_id=existing.end_user.id,
        session_id="authenticated-session",
    )

    assert resolution.app_active is True
    assert resolution.end_user is not None
    assert resolution.end_user != existing.end_user
    persisted = sqlite_session.scalar(select(EndUser).where(EndUser.id == resolution.end_user.id))
    assert persisted is not None
    assert persisted.session_id == "authenticated-session"


def test_resolve_authenticated_end_user_scopes_id_to_webapp(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp(sqlite_session, app_code="one")
    _persist_webapp(sqlite_session, app_code="two")
    repository = _repository(sqlite_session_factory)
    app_one = repository.get_active_web_app("one")
    app_two = repository.get_active_web_app("two")
    assert app_one is not None
    assert app_two is not None
    created = repository.resolve_standard_end_user(app_one, "session")
    assert created.end_user is not None

    same_app = repository.resolve_authenticated_end_user(
        app_one,
        end_user_id=created.end_user.id,
        session_id=None,
    )
    other_app = repository.resolve_authenticated_end_user(
        app_two,
        end_user_id=created.end_user.id,
        session_id=None,
    )

    assert same_app.end_user == created.end_user
    assert other_app.app_active is True
    assert other_app.end_user is None


def test_resolve_standard_end_user_retries_generated_session_id_collision(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp(sqlite_session)
    generate_session_id = MagicMock(side_effect=["collision", "available"])
    repository = _repository(sqlite_session_factory, generate_session_id=generate_session_id)
    app = repository.get_active_web_app("code")
    assert app is not None
    repository.resolve_standard_end_user(app, "collision")

    resolution = repository.resolve_standard_end_user(app, None)

    assert resolution.end_user is not None
    assert generate_session_id.call_count == 2
    persisted = sqlite_session.scalar(select(EndUser).where(EndUser.id == resolution.end_user.id))
    assert persisted is not None
    assert persisted.session_id == "available"


def test_resolve_standard_end_user_treats_empty_session_as_missing(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _persist_webapp(sqlite_session)
    generate_session_id = MagicMock(return_value="generated-session")
    repository = _repository(sqlite_session_factory, generate_session_id=generate_session_id)
    app = repository.get_active_web_app("code")
    assert app is not None

    resolution = repository.resolve_standard_end_user(app, "")

    assert resolution.end_user is not None
    generate_session_id.assert_called_once_with()
    persisted = sqlite_session.scalar(select(EndUser).where(EndUser.id == resolution.end_user.id))
    assert persisted is not None
    assert persisted.session_id == "generated-session"


def test_account_mapping_is_stable_across_app_switches_and_redacted(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _persist_webapp(sqlite_session, app_code="one")
    _persist_webapp(sqlite_session, app_code="two")
    repository = _repository(sqlite_session_factory, generate_session_id=lambda: str(uuid4()))
    apps = [repository.get_active_web_app(code) for code in ("one", "two")]
    account_id = str(uuid4())
    ids: list[str] = []
    for app in [*apps, *apps, *apps]:
        assert app is not None
        result = repository.resolve_account_end_user(app, account_id)
        assert result.end_user is not None
        ids.append(result.end_user.id)
    assert ids[0] != ids[1]
    assert ids == ids[:2] * 3
    users = sqlite_session.scalars(select(EndUser).where(EndUser.account_id == account_id)).all()
    assert len(users) == 2
    for user in users:
        assert user._is_anonymous is False
        assert user.session_id != account_id
        assert user.external_user_id is None
        for dto in (EndUserDetail, SimpleEndUser):
            response = dto.model_validate(user, from_attributes=True).model_dump_json()
            assert "account_id" not in response
            assert account_id not in response


def test_anonymous_and_service_api_session_hints_cannot_select_account_users(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _persist_webapp(sqlite_session)
    repository = _repository(sqlite_session_factory, generate_session_id=lambda: str(uuid4()))
    app = repository.get_active_web_app("code")
    assert app is not None
    account_user = repository.resolve_account_end_user(app, str(uuid4())).end_user
    assert account_user is not None
    stored = sqlite_session.get(EndUser, account_user.id)
    assert stored is not None
    assert (
        AppScopedEndUserRepo(session_factory=sqlite_session_factory).find_by_session(
            tenant_id=app.tenant_id, app_id=app.app_id, user_id=stored.session_id
        )
        == []
    )
    assert repository.resolve_authenticated_end_user(app, end_user_id=stored.id, session_id=None).end_user is None
    anonymous = repository.resolve_standard_end_user(app, stored.session_id)
    assert anonymous.end_user is not None
    assert anonymous.end_user.id != stored.id


def test_account_mapping_is_not_created_after_app_is_disabled(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    model, _ = _persist_webapp(sqlite_session)
    repository = _repository(sqlite_session_factory)
    app = repository.get_active_web_app("code")
    assert app is not None
    model.enable_site = False
    sqlite_session.commit()
    result = repository.resolve_account_end_user(app, str(uuid4()))
    assert not result.app_active
    assert result.end_user is None


def test_unique_constraint_rejects_duplicate_account_mapping_without_restricting_guests(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _persist_webapp(sqlite_session)
    repository = _repository(sqlite_session_factory, generate_session_id=lambda: str(uuid4()))
    app = repository.get_active_web_app("code")
    assert app is not None
    account_id = str(uuid4())
    repository.resolve_account_end_user(app, account_id)
    with sqlite_session.begin_nested() as transaction:
        sqlite_session.add(
            EndUser(
                tenant_id=app.tenant_id,
                app_id=app.app_id,
                type=EndUserType.BROWSER,
                account_id=account_id,
                session_id="another-session",
            )
        )
        with pytest.raises(IntegrityError):
            sqlite_session.flush()
        transaction.rollback()
    sqlite_session.rollback()
    assert repository.resolve_standard_end_user(app, "guest-one").end_user is not None
    assert repository.resolve_standard_end_user(app, "guest-two").end_user is not None
