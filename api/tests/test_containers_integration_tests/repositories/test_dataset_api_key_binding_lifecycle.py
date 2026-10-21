"""MySQL REPEATABLE READ coverage for dataset API-key binding cleanup."""

from __future__ import annotations

from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from threading import Barrier
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from repositories.knowledge import dataset_api_key_bindings


@pytest.fixture(scope="module")
def mysql_engine() -> Generator[Engine]:
    testcontainers_mysql = pytest.importorskip("testcontainers.mysql")
    container = testcontainers_mysql.MySqlContainer("mysql:8.0")
    container.start()
    engine = sa.create_engine(container.get_connection_url().replace("mysql://", "mysql+pymysql://", 1))
    metadata = sa.MetaData()
    sa.Table(
        "api_tokens",
        metadata,
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column("app_id", sa.CHAR(36)),
        sa.Column("tenant_id", sa.CHAR(36)),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("last_used_at", sa.DateTime),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    sa.Table(
        "dataset_api_token_bindings",
        metadata,
        sa.Column("id", sa.CHAR(36), primary_key=True),
        sa.Column("api_token_id", sa.CHAR(36), nullable=False, index=True),
        sa.Column("dataset_id", sa.CHAR(36), nullable=False, index=True),
        sa.Column("created_at", sa.DateTime, nullable=False),
    )
    metadata.create_all(engine)
    try:
        yield engine
    finally:
        engine.dispose()
        container.stop()


def test_concurrent_last_binding_deletes_revoke_token_after_old_snapshot(mysql_engine: Engine) -> None:
    metadata = sa.MetaData()
    metadata.reflect(mysql_engine)
    tokens = metadata.tables["api_tokens"]
    bindings = metadata.tables["dataset_api_token_bindings"]
    tenant_id = str(uuid4())
    token_id = str(uuid4())
    token_value = f"dataset-{uuid4().hex}"
    dataset_ids = (str(uuid4()), str(uuid4()))
    now = datetime(2026, 1, 1)
    with mysql_engine.begin() as connection:
        connection.execute(bindings.delete())
        connection.execute(tokens.delete())
        connection.execute(
            tokens.insert(),
            {
                "id": token_id,
                "tenant_id": tenant_id,
                "type": "dataset",
                "token": token_value,
                "created_at": now,
            },
        )
        connection.execute(
            bindings.insert(),
            [
                {
                    "id": str(uuid4()),
                    "api_token_id": token_id,
                    "dataset_id": dataset_id,
                    "created_at": now,
                }
                for dataset_id in dataset_ids
            ],
        )

    sessions = sessionmaker(bind=mysql_engine, expire_on_commit=False)
    snapshots_ready = Barrier(2)

    def delete_binding(dataset_id: str) -> list[str]:
        with sessions.begin() as session:
            # Establish an old consistent snapshot before either worker waits
            # for the shared token lock. The cleanup recheck must not reuse it.
            assert len(session.execute(select(bindings.c.id)).all()) == 2
            snapshots_ready.wait(timeout=20)
            revoked = dataset_api_key_bindings.delete_keys_scoped_only_to(
                session,
                dataset_id,
                tenant_id=tenant_id,
            )
            session.execute(bindings.delete().where(bindings.c.dataset_id == dataset_id))
            return revoked

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(delete_binding, value) for value in dataset_ids]
        results = [future.result(timeout=30) for future in futures]

    assert sorted(value for result in results for value in result) == [token_value]
    with mysql_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(tokens)) == 0
        assert connection.scalar(select(func.count()).select_from(bindings)) == 0


def test_binding_committed_after_old_snapshot_is_found_by_current_token_lock(mysql_engine: Engine) -> None:
    metadata = sa.MetaData()
    metadata.reflect(mysql_engine)
    tokens = metadata.tables["api_tokens"]
    bindings = metadata.tables["dataset_api_token_bindings"]
    tenant_id = str(uuid4())
    token_id = str(uuid4())
    token_value = f"dataset-{uuid4().hex}"
    dataset_id = str(uuid4())
    now = datetime(2026, 1, 1)
    with mysql_engine.begin() as connection:
        connection.execute(bindings.delete())
        connection.execute(tokens.delete())

    sessions = sessionmaker(bind=mysql_engine, expire_on_commit=False)
    with sessions() as deleting_session:
        deleting_session.begin()
        assert deleting_session.execute(select(bindings.c.id)).all() == []

        with mysql_engine.begin() as creator:
            creator.execute(
                tokens.insert(),
                {
                    "id": token_id,
                    "tenant_id": tenant_id,
                    "type": "dataset",
                    "token": token_value,
                    "created_at": now,
                },
            )
            creator.execute(
                bindings.insert(),
                {
                    "id": str(uuid4()),
                    "api_token_id": token_id,
                    "dataset_id": dataset_id,
                    "created_at": now,
                },
            )

        revoked = dataset_api_key_bindings.delete_keys_scoped_only_to(
            deleting_session,
            dataset_id,
            tenant_id=tenant_id,
        )
        deleting_session.execute(bindings.delete().where(bindings.c.dataset_id == dataset_id))
        deleting_session.commit()

    assert revoked == [token_value]
    with mysql_engine.connect() as connection:
        assert connection.scalar(select(func.count()).select_from(tokens)) == 0
        assert connection.scalar(select(func.count()).select_from(bindings)) == 0
