"""Database-enforced account mapping races; run with the CI PostgreSQL fixture."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.enums import CustomizeTokenStrategy
from models.model import App, AppMode, EndUser, Site
from repositories.web_passport_repository import WebPassportRepository


def test_concurrent_first_visits_create_one_account_mapping(db_session_with_containers: Session) -> None:
    session = db_session_with_containers
    app = App(tenant_id=str(uuid4()), name="Consumer App", mode=AppMode.CHAT, enable_site=True, enable_api=False)
    session.add(app)
    session.flush()
    site = Site(
        app_id=app.id,
        code=str(uuid4()),
        title="Consumer App",
        default_language="en-US",
        customize_token_strategy=CustomizeTokenStrategy.UUID,
    )
    session.add(site)
    session.commit()
    factory = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
    barrier = Barrier(2)

    def generate_session_id() -> str:
        # Both transactions have already observed the missing account mapping.
        barrier.wait(timeout=10)
        return str(uuid4())

    repository = WebPassportRepository(session_factory=factory, generate_session_id=generate_session_id)
    assert site.code is not None
    record = repository.get_active_web_app(site.code)
    assert record is not None
    account_id = str(uuid4())
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(repository.resolve_account_end_user, record, account_id) for _ in range(2)]
        results = [future.result(timeout=20) for future in futures]
    assert results[0].end_user is not None
    assert results[0].end_user == results[1].end_user
    users = session.scalars(select(EndUser).where(EndUser.account_id == account_id)).all()
    assert len(users) == 1
