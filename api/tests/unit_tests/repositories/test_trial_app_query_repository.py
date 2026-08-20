import uuid
from unittest.mock import MagicMock

from sqlalchemy.orm import Session, sessionmaker

from models.model import TrialApp
from repositories.trial_app_query_repository import TrialAppQueryRepository


def test_existing_ids_returns_only_trial_apps(sqlite_session_factory: sessionmaker[Session]) -> None:
    eligible_id = str(uuid.uuid4())
    other_id = str(uuid.uuid4())
    with sqlite_session_factory() as session:
        session.add(TrialApp(app_id=eligible_id, tenant_id=str(uuid.uuid4())))
        session.commit()

    result = TrialAppQueryRepository(sqlite_session_factory).existing_ids([eligible_id, other_id])

    assert result == frozenset({eligible_id})


def test_existing_ids_skips_session_for_empty_input() -> None:
    session_factory = MagicMock(spec=sessionmaker)

    result = TrialAppQueryRepository(session_factory).existing_ids([])

    assert result == frozenset()
    session_factory.assert_not_called()
