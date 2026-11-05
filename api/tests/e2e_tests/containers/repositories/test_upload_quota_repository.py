"""CI-owned real-database admission races (never start these services locally)."""

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from threading import Barrier, Lock
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, func, select
from sqlalchemy.orm import sessionmaker
from testcontainers.mysql import MySqlContainer
from testcontainers.postgres import PostgresContainer

from models.account import Tenant
from models.base import TypeBase
from models.model import App, EndUser, UploadFile
from models.upload_quota import UploadQuotaReservation
from repositories.upload_quota_repository import UploadQuotaRepository
from services.end_user_upload_service import (
    EndUserUploadService,
    UploadActor,
    UploadLimits,
    UploadSettings,
    WorkspaceUploadQuotaExceededError,
)
from tests.helpers.unit.model_factories import make_app, make_end_user, make_tenant


@pytest.fixture(scope="module", params=["postgresql", "mysql"])
def quota_engine(request: pytest.FixtureRequest) -> Iterator[Engine]:
    """Use CI containers for the two supported locking/isolation implementations."""
    container = (
        PostgresContainer("postgres:14-alpine") if request.param == "postgresql" else MySqlContainer("mysql:8.4")
    )
    with container:
        engine = create_engine(container.get_connection_url(), pool_size=10, max_overflow=0)
        tables = [
            TypeBase.metadata.tables[model.__tablename__]
            for model in (Tenant, App, EndUser, UploadFile, UploadQuotaReservation)
        ]
        TypeBase.metadata.create_all(engine, tables=tables)
        try:
            yield engine
        finally:
            engine.dispose()


@dataclass
class Objects:
    """Thread-safe external boundary; production DB transactions remain real."""

    values: dict[str, bytes] = field(default_factory=dict)
    lock: Lock = field(default_factory=Lock)

    def save(self, filename: str, data: bytes) -> None:
        """Record one external object, atomically for test observation."""
        with self.lock:
            self.values[filename] = data

    def load_once(self, filename: str) -> bytes:
        """Return immutable stored bytes, or confirmed absence."""
        with self.lock:
            if filename not in self.values:
                raise FileNotFoundError(filename)
            return self.values[filename]


@pytest.mark.parametrize("limits", [UploadLimits(max_files=5), UploadLimits(max_bytes=5)])
def test_concurrent_admission_and_settlement_never_exceed_quota(quota_engine: Engine, limits: UploadLimits) -> None:
    """Eight distinct transactions compete for five slots, including simultaneous finalization."""
    sessions = sessionmaker(bind=quota_engine)
    tenant_id, app_id, user_id = (str(uuid4()) for _ in range(3))
    with sessions.begin() as session:
        session.add(make_tenant(tenant_id=tenant_id))
        session.add(make_app(app_id=app_id, tenant_id=tenant_id))
        session.add(make_end_user(end_user_id=user_id, tenant_id=tenant_id, app_id=app_id))
    objects = Objects()
    service = EndUserUploadService(
        uploads=UploadQuotaRepository(session_factory=sessions),
        objects=objects,
        settings=UploadSettings(
            limits=limits,
            storage_type="local",
            default_size_limit=1024,
            extension_size_limits={},
            blocked_extensions=frozenset(),
            document_extensions=frozenset(),
        ),
    )
    start = Barrier(8, timeout=30)

    def attempt() -> bool:
        """Synchronize entry; quota rejection is the only expected unsuccessful outcome."""
        start.wait()
        try:
            service.upload(UploadActor(tenant_id, user_id), filename="a.txt", content=b"x", mimetype="text/plain")
            return True
        except WorkspaceUploadQuotaExceededError:
            return False

    with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(lambda _: attempt(), range(8)))
    assert sum(results) == 5
    assert len(objects.values) == 5
    with sessions() as session:
        count, size = session.execute(
            select(func.count(), func.sum(UploadFile.size)).where(UploadFile.tenant_id == tenant_id)
        ).one()
        assert (count, size) == (5, 5)
        assert (
            session.scalar(
                select(func.count())
                .select_from(UploadQuotaReservation)
                .where(UploadQuotaReservation.tenant_id == tenant_id)
            )
            == 0
        )
