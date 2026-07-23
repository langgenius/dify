from __future__ import annotations

from unittest.mock import patch
from uuid import NAMESPACE_URL, UUID, uuid5

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import NotFound, Unauthorized

from controllers.web.error import WebAppAuthRequiredError
from controllers.web.passport import (
    PassportService,
    decode_enterprise_webapp_user_id,
    exchange_token_for_existing_web_user,
    generate_session_id,
)
from models.enums import CustomizeTokenStrategy, EndUserType
from models.model import App, AppMode, EndUser, IconType, Site
from services.webapp_auth_service import WebAppAuthType


def _stable_uuid(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, value))


def _persist_webapp(session: Session, *, app_code: str = "code") -> tuple[App, Site]:
    tenant_id = _stable_uuid(f"tenant:{app_code}")
    app_model = App(
        id=_stable_uuid(f"app:{app_code}"),
        tenant_id=tenant_id,
        name="Web App",
        mode=AppMode.CHAT,
        icon_type=IconType.EMOJI,
        icon="chat",
        icon_background="#FFFFFF",
        enable_site=True,
        enable_api=False,
    )
    site = Site(
        id=_stable_uuid(f"site:{app_code}"),
        app_id=app_model.id,
        title="Web App Site",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
        code=app_code,
    )
    session.add_all([app_model, site])
    session.commit()
    return app_model, site


def test_decode_enterprise_webapp_user_id_none() -> None:
    assert decode_enterprise_webapp_user_id(None) is None


def test_decode_enterprise_webapp_user_id_invalid_source(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(PassportService, "verify", lambda *_args, **_kwargs: {"token_source": "bad"})
    with pytest.raises(Unauthorized):
        decode_enterprise_webapp_user_id("token")


def test_decode_enterprise_webapp_user_id_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    decoded = {"token_source": "webapp_login_token", "user_id": "u1"}
    monkeypatch.setattr(PassportService, "verify", lambda *_args, **_kwargs: decoded)
    assert decode_enterprise_webapp_user_id("token") == decoded


@pytest.mark.parametrize("sqlite_session", [(App, Site)], indirect=True)
def test_exchange_token_public_flow(sqlite_session: Session) -> None:
    app_model, site = _persist_webapp(sqlite_session)

    decoded = {"auth_type": "public"}
    with (
        patch("controllers.web.passport.db.session", sqlite_session),
        patch("controllers.web.passport._exchange_for_public_app_token", return_value="resp") as exchange_mock,
    ):
        result = exchange_token_for_existing_web_user("code", decoded, WebAppAuthType.PUBLIC)

    assert result == "resp"
    exchange_mock.assert_called_once_with(app_model, site, decoded)


@pytest.mark.parametrize("sqlite_session", [(App, Site)], indirect=True)
def test_exchange_token_requires_external(sqlite_session: Session) -> None:
    _persist_webapp(sqlite_session)

    decoded = {"auth_type": "internal"}
    with (
        patch("controllers.web.passport.db.session", sqlite_session),
        pytest.raises(WebAppAuthRequiredError),
    ):
        exchange_token_for_existing_web_user("code", decoded, WebAppAuthType.EXTERNAL)


@pytest.mark.parametrize("sqlite_session", [(App, Site, EndUser)], indirect=True)
def test_exchange_token_missing_session_id(sqlite_session: Session) -> None:
    _persist_webapp(sqlite_session)

    decoded = {"auth_type": "internal"}
    with (
        patch("controllers.web.passport.db.session", sqlite_session),
        pytest.raises(NotFound),
    ):
        exchange_token_for_existing_web_user("code", decoded, WebAppAuthType.INTERNAL)
    assert sqlite_session.scalars(select(EndUser)).all() == []


@pytest.mark.parametrize("sqlite_session", [(EndUser,)], indirect=True)
def test_generate_session_id(sqlite_session: Session) -> None:
    collision_id = _stable_uuid("session:collision")
    generated_id = _stable_uuid("session:generated")
    sqlite_session.add(
        EndUser(
            id=_stable_uuid("end-user:collision"),
            tenant_id=_stable_uuid("tenant:collision"),
            type=EndUserType.BROWSER,
            name="Existing User",
            session_id=collision_id,
        )
    )
    sqlite_session.commit()

    with (
        patch("controllers.web.passport.db.session", sqlite_session),
        patch(
            "controllers.web.passport.uuid.uuid4",
            side_effect=[UUID(collision_id), UUID(generated_id)],
        ),
    ):
        session_id = generate_session_id()

    assert session_id == generated_id
