"""Cross-database concurrency coverage for resource-token lifecycle locks."""

from __future__ import annotations

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event, Lock, current_thread
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import event, func, select
from sqlalchemy.engine import Connection, Engine, ExecutionContext
from sqlalchemy.orm import sessionmaker

from constants.resource_access_token import ResourceAccessTokenResourceType
from libs.datetime_utils import naive_utc_now
from models.types import StringUUID
from repositories.resource_access_token_repository import (
    ResourceAccessTokenCleanupRepository,
    ResourceAccessTokenRepository,
)
from services.auth.resource_access_token_contracts import ResourceAccessTokenResource


@pytest.fixture(params=("postgresql", "mysql"), scope="module")
def lifecycle_engine(request: pytest.FixtureRequest) -> Generator[Engine]:
    if request.param == "postgresql":
        testcontainers_postgres = pytest.importorskip("testcontainers.postgres")
        container = testcontainers_postgres.PostgresContainer("postgres:15-alpine")
    else:
        testcontainers_mysql = pytest.importorskip("testcontainers.mysql")
        container = testcontainers_mysql.MySqlContainer("mysql:8.0")

    container.start()
    engine = sa.create_engine(container.get_connection_url().replace("mysql://", "mysql+pymysql://", 1))
    metadata = sa.MetaData()
    sa.Table(
        "apps",
        metadata,
        sa.Column("id", StringUUID, primary_key=True),
        sa.Column("tenant_id", StringUUID, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("enable_api", sa.Boolean, nullable=False),
    )
    sa.Table(
        "datasets",
        metadata,
        sa.Column("id", StringUUID, primary_key=True),
        sa.Column("tenant_id", StringUUID, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("enable_api", sa.Boolean, nullable=False),
    )
    sa.Table(
        "resource_access_tokens",
        metadata,
        sa.Column("id", StringUUID, primary_key=True),
        sa.Column("tenant_id", StringUUID, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("track_id", sa.String(32), nullable=False, unique=True),
        sa.Column("token", sa.String(255), nullable=False, unique=True),
        sa.Column("created_by", StringUUID, nullable=False),
        sa.Column("last_used_at", sa.DateTime),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    sa.Table(
        "resource_access_tokens_relation",
        metadata,
        sa.Column("id", StringUUID, primary_key=True),
        sa.Column("token_id", StringUUID, nullable=False, index=True),
        sa.Column("resource_type", sa.String(16), nullable=False),
        sa.Column("app_id", StringUUID, index=True),
        sa.Column("dataset_id", StringUUID, index=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()
        container.stop()


@pytest.fixture
def lifecycle_tables(lifecycle_engine: Engine) -> sa.MetaData:
    metadata = sa.MetaData()
    metadata.reflect(lifecycle_engine)
    with lifecycle_engine.begin() as connection:
        connection.execute(metadata.tables["resource_access_tokens_relation"].delete())
        connection.execute(metadata.tables["resource_access_tokens"].delete())
        connection.execute(metadata.tables["apps"].delete())
        connection.execute(metadata.tables["datasets"].delete())
    return metadata


def _normalize_sql(statement: str) -> str:
    return " ".join(statement.lower().replace("`", "").replace('"', "").split())


def test_concurrent_last_resource_deletes_revoke_shared_token(
    lifecycle_engine: Engine, lifecycle_tables: sa.MetaData
) -> None:
    apps = lifecycle_tables.tables["apps"]
    tokens = lifecycle_tables.tables["resource_access_tokens"]
    relations = lifecycle_tables.tables["resource_access_tokens_relation"]
    tenant_id = str(uuid4())
    token_id = str(uuid4())
    app_ids = (str(uuid4()), str(uuid4()))
    with lifecycle_engine.begin() as connection:
        connection.execute(
            apps.insert(),
            [
                {"id": app_id, "tenant_id": tenant_id, "name": app_id, "status": "normal", "enable_api": True}
                for app_id in app_ids
            ],
        )
        connection.execute(
            tokens.insert(),
            {
                "id": token_id,
                "tenant_id": tenant_id,
                "name": "shared",
                "track_id": uuid4().hex,
                "token": f"sk-{uuid4()}",
                "created_by": str(uuid4()),
                "created_at": naive_utc_now(),
            },
        )
        connection.execute(
            relations.insert(),
            [
                {
                    "id": str(uuid4()),
                    "token_id": token_id,
                    "resource_type": ResourceAccessTokenResourceType.APP.value,
                    "app_id": app_id,
                    "created_at": naive_utc_now(),
                }
                for app_id in app_ids
            ],
        )

    ready_to_lock_token = Barrier(2)
    seen_threads: set[int] = set()
    seen_lock = Lock()

    def align_token_locks(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        sql = _normalize_sql(statement)
        thread_id = current_thread().ident
        if (
            thread_id is not None
            and current_thread().name.startswith("resource-cleanup")
            and "from resource_access_tokens" in sql
            and "resource_access_tokens_relation" in sql
            and "for update" in sql
        ):
            with seen_lock:
                first_visit = thread_id not in seen_threads
                seen_threads.add(thread_id)
            if first_visit:
                ready_to_lock_token.wait(timeout=20)

    sessions = sessionmaker(bind=lifecycle_engine, expire_on_commit=False)
    event.listen(lifecycle_engine, "before_cursor_execute", align_token_locks)

    def delete_resource(app_id: str) -> None:
        with sessions.begin() as session:
            ResourceAccessTokenCleanupRepository(session=session).delete_resource_relations(
                tenant_id=tenant_id,
                resource_type=ResourceAccessTokenResourceType.APP,
                resource_id=app_id,
            )
            session.execute(apps.delete().where(apps.c.id == app_id))

    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="resource-cleanup") as executor:
            futures = [executor.submit(delete_resource, app_id) for app_id in app_ids]
            for future in futures:
                future.result(timeout=30)
    finally:
        event.remove(lifecycle_engine, "before_cursor_execute", align_token_locks)

    assert len(seen_threads) == 2
    with lifecycle_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(tokens)) == 0
        assert connection.scalar(select(func.count()).select_from(relations)) == 0


def test_resource_delete_waits_for_validated_binding_and_removes_it(
    lifecycle_engine: Engine, lifecycle_tables: sa.MetaData
) -> None:
    apps = lifecycle_tables.tables["apps"]
    tokens = lifecycle_tables.tables["resource_access_tokens"]
    relations = lifecycle_tables.tables["resource_access_tokens_relation"]
    tenant_id = str(uuid4())
    app_id = str(uuid4())
    with lifecycle_engine.begin() as connection:
        connection.execute(
            apps.insert(),
            {"id": app_id, "tenant_id": tenant_id, "name": "app", "status": "normal", "enable_api": True},
        )

    binding_validated = Event()
    allow_binding_insert = Event()
    deletion_waiting_for_parent = Event()

    def pause_after_parent_validation(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        sql = _normalize_sql(statement)
        if current_thread().name.startswith("binding-create") and "insert into resource_access_tokens " in sql:
            binding_validated.set()
            assert allow_binding_insert.wait(timeout=20)
        elif current_thread().name.startswith("parent-delete") and "from apps" in sql and "for update" in sql:
            deletion_waiting_for_parent.set()

    sessions = sessionmaker(bind=lifecycle_engine, expire_on_commit=False)
    repository = ResourceAccessTokenRepository(session_factory=sessions)

    def create_binding() -> None:
        repository.create(
            tenant_id,
            str(uuid4()),
            "concurrent binding",
            (ResourceAccessTokenResource(ResourceAccessTokenResourceType.APP, app_id),),
        )

    def delete_parent() -> None:
        with sessions.begin() as session:
            ResourceAccessTokenCleanupRepository(session=session).delete_resource_relations(
                tenant_id=tenant_id,
                resource_type=ResourceAccessTokenResourceType.APP,
                resource_id=app_id,
            )
            session.execute(apps.delete().where(apps.c.id == app_id))

    event.listen(lifecycle_engine, "before_cursor_execute", pause_after_parent_validation)
    creator_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="binding-create")
    deleter_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="parent-delete")
    try:
        creator = creator_executor.submit(create_binding)
        assert binding_validated.wait(timeout=20)
        deleter = deleter_executor.submit(delete_parent)
        assert deletion_waiting_for_parent.wait(timeout=20)
        assert not deleter.done()
        allow_binding_insert.set()
        creator.result(timeout=30)
        deleter.result(timeout=30)
    finally:
        allow_binding_insert.set()
        creator_executor.shutdown(wait=True, cancel_futures=True)
        deleter_executor.shutdown(wait=True, cancel_futures=True)
        event.remove(lifecycle_engine, "before_cursor_execute", pause_after_parent_validation)

    with lifecycle_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(apps)) == 0
        assert connection.scalar(select(func.count()).select_from(tokens)) == 0
        assert connection.scalar(select(func.count()).select_from(relations)) == 0
