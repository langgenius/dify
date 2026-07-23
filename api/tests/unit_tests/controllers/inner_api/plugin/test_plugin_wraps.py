"""
Unit tests for inner_api plugin decorators
"""

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from pydantic import ValidationError
from sqlalchemy import Engine, event, select
from sqlalchemy.orm import Session, scoped_session, sessionmaker

from controllers.inner_api.plugin import wraps as wraps_module
from controllers.inner_api.plugin.wraps import (
    TenantUserPayload,
    get_user,
    get_user_tenant,
    plugin_data,
)
from models.account import Tenant
from models.base import TypeBase
from models.enums import EndUserType
from models.model import DefaultEndUserSessionID, EndUser


@pytest.fixture
def sqlite_plugin_engine(
    sqlite_engine: Engine,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[Engine]:
    tables = [TypeBase.metadata.tables[model.__tablename__] for model in (Tenant, EndUser)]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    session_registry = scoped_session(sessionmaker(bind=sqlite_engine, expire_on_commit=False))
    monkeypatch.setattr(
        wraps_module,
        "db",
        SimpleNamespace(engine=sqlite_engine, session=session_registry),
    )
    try:
        yield sqlite_engine
    finally:
        session_registry.remove()


def _persist_tenant(sqlite_engine: Engine, *, tenant_id: str = "tenant123") -> Tenant:
    tenant = Tenant(name=f"Tenant {tenant_id}")
    tenant.id = tenant_id
    with Session(sqlite_engine) as session, session.begin():
        session.add(tenant)
    return tenant


def _persist_end_user(
    sqlite_engine: Engine,
    *,
    tenant_id: str = "tenant123",
    user_id: str,
    session_id: str,
    is_anonymous: bool = False,
) -> EndUser:
    user = EndUser(
        id=user_id,
        tenant_id=tenant_id,
        type=EndUserType.SERVICE_API,
        is_anonymous=is_anonymous,
        session_id=session_id,
    )
    with Session(sqlite_engine) as session, session.begin():
        session.add(user)
    return user


class TestTenantUserPayload:
    """Test TenantUserPayload Pydantic model"""

    def test_valid_payload(self):
        """Test valid payload passes validation"""
        data = {"tenant_id": "tenant123", "user_id": "user456"}
        payload = TenantUserPayload.model_validate(data)
        assert payload.tenant_id == "tenant123"
        assert payload.user_id == "user456"

    def test_missing_tenant_id(self):
        """Test missing tenant_id raises ValidationError"""
        with pytest.raises(ValidationError):
            TenantUserPayload.model_validate({"user_id": "user456"})

    def test_missing_user_id(self):
        """Test missing user_id raises ValidationError"""
        with pytest.raises(ValidationError):
            TenantUserPayload.model_validate({"tenant_id": "tenant123"})


class TestGetUser:
    """Test get_user function"""

    def test_should_return_existing_user_by_id(self, sqlite_plugin_engine: Engine, app: Flask):
        """Test returning existing user when found by ID"""
        _persist_end_user(
            sqlite_plugin_engine,
            user_id="user123",
            session_id="existing-session",
        )

        with app.app_context():
            result = get_user("tenant123", "user123")

        assert result.id == "user123"
        assert result.tenant_id == "tenant123"

    def test_should_not_resolve_non_anonymous_users_across_tenants(
        self,
        sqlite_plugin_engine: Engine,
        app: Flask,
    ):
        """Test that explicit user IDs remain scoped to the current tenant."""
        _persist_end_user(
            sqlite_plugin_engine,
            tenant_id="tenant-foreign",
            user_id="foreign-user-id",
            session_id="foreign-session",
        )

        with app.app_context():
            result = get_user("tenant-current", "foreign-user-id")

        assert result.id != "foreign-user-id"
        assert result.tenant_id == "tenant-current"
        assert result.session_id == "foreign-user-id"
        with Session(sqlite_plugin_engine) as session:
            current_tenant_users = session.scalars(select(EndUser).where(EndUser.tenant_id == "tenant-current")).all()
        assert [user.id for user in current_tenant_users] == [result.id]

    def test_should_return_existing_user_by_session_id_fallback_for_non_anonymous(
        self,
        sqlite_plugin_engine: Engine,
        app: Flask,
    ):
        """Non-anonymous user_id misses on EndUser.id but hits on
        EndUser.session_id — this is the plugin-daemon Reverse Invocation
        case where the daemon sends a stable session-derived UUID that
        was written into session_id on the first call. See #36736.
        """
        _persist_end_user(
            sqlite_plugin_engine,
            user_id="persisted-user-id",
            session_id="daemon-session-uuid",
        )

        with app.app_context():
            result = get_user("tenant123", "daemon-session-uuid")

        assert result.id == "persisted-user-id"
        with Session(sqlite_plugin_engine) as session:
            users = session.scalars(select(EndUser)).all()
        assert [user.id for user in users] == ["persisted-user-id"]

    def test_should_return_existing_anonymous_user_by_session_id(
        self,
        sqlite_plugin_engine: Engine,
        app: Flask,
    ):
        """Test returning existing anonymous user by session_id"""
        _persist_end_user(
            sqlite_plugin_engine,
            user_id="anonymous-user-id",
            session_id="anonymous_session",
            is_anonymous=True,
        )

        with app.app_context():
            result = get_user("tenant123", "anonymous_session")

        assert result.id == "anonymous-user-id"

    def test_should_create_new_user_when_not_found(
        self,
        sqlite_plugin_engine: Engine,
        app: Flask,
    ):
        """Test creating new user when not found in database"""
        with app.app_context():
            result = get_user("tenant123", "user123")

        assert result.tenant_id == "tenant123"
        assert result.session_id == "user123"
        with Session(sqlite_plugin_engine) as session:
            persisted_user = session.get(EndUser, result.id)
        assert persisted_user is not None
        assert persisted_user.session_id == "user123"

    def test_should_use_default_session_id_when_user_id_none(
        self,
        sqlite_plugin_engine: Engine,
        app: Flask,
    ):
        """Test using default session ID when user_id is None"""
        _persist_end_user(
            sqlite_plugin_engine,
            user_id="default-user-id",
            session_id=DefaultEndUserSessionID.DEFAULT_SESSION_ID,
            is_anonymous=True,
        )

        with app.app_context():
            result = get_user("tenant123", None)

        assert result.id == "default-user-id"
        assert result.session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID

    def test_should_raise_error_on_database_exception(self, sqlite_plugin_engine: Engine, app: Flask):
        """Test raising ValueError when database operation fails"""

        def _raise_database_error(*_args, **_kwargs):
            raise RuntimeError("Database error")

        event.listen(sqlite_plugin_engine, "before_cursor_execute", _raise_database_error)
        try:
            with app.app_context(), pytest.raises(ValueError, match="user not found"):
                get_user("tenant123", "user123")
        finally:
            event.remove(sqlite_plugin_engine, "before_cursor_execute", _raise_database_error)


class TestGetUserTenant:
    """Test get_user_tenant decorator"""

    def test_should_inject_tenant_and_user_models(
        self,
        sqlite_plugin_engine: Engine,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Test that decorator injects tenant_model and user_model into kwargs"""

        # Arrange
        @get_user_tenant
        def protected_view(tenant_model, user_model, **kwargs):
            return {"tenant": tenant_model, "user": user_model}

        _persist_tenant(sqlite_plugin_engine)
        _persist_end_user(
            sqlite_plugin_engine,
            user_id="user456",
            session_id="user-session",
        )

        with app.test_request_context(json={"tenant_id": "tenant123", "user_id": "user456"}):
            monkeypatch.setattr(app, "login_manager", MagicMock(), raising=False)
            with patch("controllers.inner_api.plugin.wraps.user_logged_in"):
                result = protected_view()

        assert result["tenant"].id == "tenant123"
        assert result["user"].id == "user456"

    def test_should_raise_error_when_tenant_id_missing(self, app: Flask):
        """Test that Pydantic ValidationError is raised when tenant_id is missing from payload"""

        # Arrange
        @get_user_tenant
        def protected_view(tenant_model, user_model, **kwargs):
            return "success"

        # Act & Assert - Pydantic validates payload before manual check
        with app.test_request_context(json={"user_id": "user456"}):
            with pytest.raises(ValidationError):
                protected_view()

    def test_should_raise_error_when_tenant_not_found(self, sqlite_plugin_engine: Engine, app: Flask):
        """Test that ValueError is raised when tenant is not found"""

        # Arrange
        @get_user_tenant
        def protected_view(tenant_model, user_model, **kwargs):
            return "success"

        with app.test_request_context(json={"tenant_id": "nonexistent", "user_id": "user456"}):
            with pytest.raises(ValueError, match="tenant not found"):
                protected_view()

    def test_should_use_default_session_id_when_user_id_empty(
        self,
        sqlite_plugin_engine: Engine,
        app: Flask,
        monkeypatch: pytest.MonkeyPatch,
    ):
        """Test that default session ID is used when user_id is empty string"""

        # Arrange
        @get_user_tenant
        def protected_view(tenant_model, user_model, **kwargs):
            return {"tenant": tenant_model, "user": user_model}

        _persist_tenant(sqlite_plugin_engine)
        _persist_end_user(
            sqlite_plugin_engine,
            user_id="default-user-id",
            session_id=DefaultEndUserSessionID.DEFAULT_SESSION_ID,
            is_anonymous=True,
        )

        with app.test_request_context(json={"tenant_id": "tenant123", "user_id": ""}):
            monkeypatch.setattr(app, "login_manager", MagicMock(), raising=False)
            with patch("controllers.inner_api.plugin.wraps.user_logged_in"):
                result = protected_view()

        assert result["tenant"].id == "tenant123"
        assert result["user"].id == "default-user-id"
        assert result["user"].session_id == DefaultEndUserSessionID.DEFAULT_SESSION_ID


class PluginTestPayload:
    """Simple test payload class"""

    def __init__(self, data: dict[str, Any]):
        self.value = data.get("value")

    @classmethod
    def model_validate(cls, data: dict[str, Any]):
        return cls(data)


class TestPluginData:
    """Test plugin_data decorator"""

    def test_should_inject_valid_payload(self, app: Flask):
        """Test that valid payload is injected into kwargs"""

        # Arrange
        @plugin_data(payload_type=PluginTestPayload)
        def protected_view(payload, **kwargs):
            return payload

        # Act
        with app.test_request_context(json={"value": "test_data"}):
            result = protected_view()

        # Assert
        assert result.value == "test_data"

    def test_should_raise_error_on_invalid_json(self, app: Flask):
        """Test that ValueError is raised when JSON parsing fails"""

        # Arrange
        @plugin_data(payload_type=PluginTestPayload)
        def protected_view(payload, **kwargs):
            return payload

        # Act & Assert - Malformed JSON triggers ValueError
        with app.test_request_context(data="not valid json", content_type="application/json"):
            with pytest.raises(ValueError):
                protected_view()

    def test_should_raise_error_on_invalid_payload(self, app: Flask):
        """Test that ValueError is raised when payload validation fails"""

        # Arrange
        class InvalidPayload:
            @classmethod
            def model_validate(cls, data: dict[str, Any]):
                raise Exception("Validation failed")

        @plugin_data(payload_type=InvalidPayload)
        def protected_view(payload, **kwargs):
            return payload

        # Act & Assert
        with app.test_request_context(json={"data": "test"}):
            with pytest.raises(ValueError, match="invalid payload"):
                protected_view()

    def test_should_work_as_parameterized_decorator(self, app: Flask):
        """Test that decorator works when used with parentheses"""

        # Arrange
        @plugin_data(payload_type=PluginTestPayload)
        def protected_view(payload, **kwargs):
            return payload

        # Act
        with app.test_request_context(json={"value": "parameterized"}):
            result = protected_view()

        # Assert
        assert result.value == "parameterized"
