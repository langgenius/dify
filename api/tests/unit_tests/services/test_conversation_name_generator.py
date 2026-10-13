"""Real provider resolution keeps naming metadata and the caller's session isolated."""

from collections.abc import Iterator
from uuid import uuid4

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, select
from sqlalchemy.orm import Session, SessionTransaction, sessionmaker

from core.credit_usage import CreditUsageAppType, CreditUsageCreatedBy
from core.model_context import get_credit_usage_metadata, use_credit_usage_metadata
from extensions.ext_database import db
from models import App, AppMode, Tenant
from models.provider import Provider
from services.conversation_name_generator import generate_conversation_name


@pytest.fixture
def naming_app(sqlite_engine: Engine) -> Iterator[Flask]:
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI=str(sqlite_engine.url))
    db.init_app(app)
    yield app
    with app.app_context():
        db.session.remove()
        db.engine.dispose()


@pytest.mark.parametrize(
    ("app_mode", "app_type"),
    [
        (AppMode.CHAT, CreditUsageAppType.CHATBOT),
        (AppMode.AGENT_CHAT, CreditUsageAppType.AGENT),
        (AppMode.ADVANCED_CHAT, CreditUsageAppType.CHATFLOW),
        (AppMode.AGENT, CreditUsageAppType.AGENT_V2),
    ],
)
def test_provider_resolution_failure_closes_inner_session_and_preserves_caller_context(
    naming_app: Flask,
    sqlite_session_factory: sessionmaker[Session],
    app_mode: AppMode,
    app_type: CreditUsageAppType,
) -> None:
    tenant = Tenant(name="Naming workspace")
    target = App(
        id=str(uuid4()),
        tenant_id=tenant.id,
        name="Original app",
        mode=app_mode,
        enable_site=True,
        enable_api=True,
    )
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [tenant, target, Provider(tenant_id=tenant.id, provider_name="invalid/provider", is_valid=True)]
        )

    provider_sessions: list[Session] = []
    metadata: list[dict[str, object]] = []

    def observe_provider_transaction(
        session: Session, _transaction: SessionTransaction, connection: Connection
    ) -> None:
        # Observe real default-model/provider SQL within the nested app context.
        # With no default model, invalid provider config fails before plugin I/O.
        assert session is db.session()
        assert connection.scalar(select(App.name).where(App.id == target.id)) == "Original app"
        provider_sessions.append(session)
        metadata.append(dict(get_credit_usage_metadata() or {}))

    with naming_app.app_context():
        caller_session = db.session()
        caller_app = caller_session.get(App, target.id)
        assert caller_app is not None
        caller_app.name = "Pending caller edit"
        caller_transaction = caller_session.get_transaction()
        original_metadata = get_credit_usage_metadata()
        event.listen(db.session.session_factory, "after_begin", observe_provider_transaction)
        try:
            with use_credit_usage_metadata({"request_id": "name-request"}):
                inherited_metadata = dict(get_credit_usage_metadata() or {})
                with pytest.raises(ValueError, match="^Invalid plugin id invalid/provider$"):
                    generate_conversation_name(
                        tenant_id=target.tenant_id,
                        app_id=target.id,
                        conversation_id=str(uuid4()),
                        query="First query",
                        app_mode=app_mode.value,
                    )
                assert get_credit_usage_metadata() == inherited_metadata
        finally:
            event.remove(db.session.session_factory, "after_begin", observe_provider_transaction)
        assert get_credit_usage_metadata() == original_metadata
        assert provider_sessions
        assert all(
            observed
            == {
                **inherited_metadata,
                "app_type": app_type,
                "created_by": CreditUsageCreatedBy.CONVERSATION_NAME,
            }
            for observed in metadata
        )
        assert db.session() is caller_session
        assert caller_session.get_transaction() is caller_transaction
        assert caller_session.in_transaction()
        assert caller_app in caller_session.dirty
        assert caller_app.name == "Pending caller edit"
        for provider_session in provider_sessions:
            assert provider_session is not caller_session
            assert not provider_session.in_transaction()
            assert not provider_session.identity_map
        with sqlite_session_factory() as session:
            stored_app = session.get(App, target.id)
            assert stored_app is not None
            assert stored_app.name == "Original app"
