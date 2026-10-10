"""Unit tests for ``clean_embedding_cache_task``.

The task deletes embedding cache rows older than the sandbox clean window.
Sessions are provided by the shared SQLite session factory, which proves the
task no longer depends on the global Flask-SQLAlchemy session.
"""

import datetime
import pickle
import uuid
from collections.abc import Callable

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session, sessionmaker

from models.dataset import Embedding
from schedule.clean_embedding_cache_task import clean_embedding_cache_task

CLEAN_DAYS = 30


def _make_embedding(hash_value: str) -> Embedding:
    return Embedding(
        model_name="text-embedding-test",
        hash=hash_value,
        provider_name="test-provider",
        embedding=pickle.dumps([0.1, 0.2], protocol=pickle.HIGHEST_PROTOCOL),
    )


@pytest.fixture
def seeded_embeddings(
    sqlite_session_factory: sessionmaker[Session], config_overrides: Callable[..., None]
) -> dict[str, str]:
    """Seed one stale and one fresh embedding row and return their ids."""
    config_overrides(PLAN_SANDBOX_CLEAN_DAY_SETTING=CLEAN_DAYS)

    stale_embedding = _make_embedding(uuid.uuid4().hex)
    fresh_embedding = _make_embedding(uuid.uuid4().hex)

    with sqlite_session_factory() as session:
        session.add(stale_embedding)
        session.add(fresh_embedding)
        session.commit()

        # created_at is server-generated; age the stale row past the clean window.
        session.execute(
            update(Embedding)
            .where(Embedding.id == stale_embedding.id)
            .values(created_at=datetime.datetime.now() - datetime.timedelta(days=CLEAN_DAYS + 1))
        )
        session.commit()

    return {"stale": stale_embedding.id, "fresh": fresh_embedding.id}


def test_deletes_only_stale_embedding_rows(
    seeded_embeddings: dict[str, str], sqlite_session_factory: sessionmaker[Session]
) -> None:
    clean_embedding_cache_task()

    with sqlite_session_factory() as session:
        remaining = set(session.scalars(select(Embedding.id)).all())

    assert remaining == {seeded_embeddings["fresh"]}


def test_is_idempotent_when_nothing_is_stale(
    seeded_embeddings: dict[str, str], sqlite_session_factory: sessionmaker[Session]
) -> None:
    clean_embedding_cache_task()
    clean_embedding_cache_task()

    with sqlite_session_factory() as session:
        remaining = set(session.scalars(select(Embedding.id)).all())

    assert remaining == {seeded_embeddings["fresh"]}
