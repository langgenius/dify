"""PostgreSQL usage backfill and concurrent collection writes; CI only."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from importlib import import_module
from threading import Barrier
from uuid import uuid4

from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker

from models.account_webapp import AccountWebApp
from models.enums import CustomizeTokenStrategy
from models.model import AppStar, Site
from repositories.app.console_repository import ConsoleAppRepository
from services.consumer_service import ConsumerIdentity
from tests.helpers.consumer import new_consumer_run
from tests.helpers.end_user_api_key import make_harness


def test_first_usage_and_favorite_preserve_both_updates(db_session_with_containers: Session) -> None:
    engine = db_session_with_containers.get_bind()
    sessions = sessionmaker(bind=engine, expire_on_commit=False)
    base = make_harness(sessions)
    assert base.context.account_id is not None
    identity = ConsumerIdentity(base.context.account_id)
    repository = ConsoleAppRepository(session_factory=sessions)
    with sessions.begin() as session:
        session.add(
            Site(
                app_id=base.context.app_id,
                code=str(uuid4()),
                title="App",
                default_language="en-US",
                customize_token_strategy=CustomizeTokenStrategy.NOT_ALLOW,
            )
        )
    barrier = Barrier(2)

    def after_lookup(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.startswith("SELECT account_webapps.id "):
            barrier.wait(timeout=15)

    event.listen(engine, "after_cursor_execute", after_lookup)
    moment = datetime(2026, 11, 4)
    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            usage = executor.submit(
                repository.record_consumer_usage,
                identity,
                tenant_id=base.context.tenant_id,
                app_id=base.context.app_id,
                end_user_id=base.context.end_user_id,
                used_at=moment,
            )
            favorite = executor.submit(repository.favorite, identity, base.context.app_id, enabled=True)
            usage.result(timeout=30)
            favorite.result(timeout=30)
    finally:
        event.remove(engine, "after_cursor_execute", after_lookup)
    with sessions() as session:
        rows = session.scalars(select(AccountWebApp).where(AccountWebApp.account_id == identity.account_id)).all()
        assert len(rows) == 1
        assert rows[0].last_used_at == moment
        assert rows[0].favorited_at is not None


def test_recent_backfill_does_not_import_console_favorites(db_session_with_containers: Session) -> None:
    sessions = sessionmaker(bind=db_session_with_containers.get_bind(), expire_on_commit=False)
    base = make_harness(sessions)
    assert base.context.account_id is not None
    moment = datetime(2026, 11, 4)
    with sessions.begin() as session:
        session.add(new_consumer_run(base, created_at=moment))
        session.add(
            AppStar(account_id=base.context.account_id, tenant_id=base.context.tenant_id, app_id=base.context.app_id)
        )
    migration = import_module("migrations.versions.2026_11_04_1200-6a1f3e8c2d47_add_account_webapps")
    with sessions.begin() as session:
        migration.backfill_recent_usage(session.connection())
    with sessions() as session:
        state = session.scalar(select(AccountWebApp).where(AccountWebApp.account_id == base.context.account_id))
        assert state is not None
        assert state.last_used_at == moment
        assert state.favorited_at is None
