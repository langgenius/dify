from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums.oauth_client import OAuthClientKind
from models.oauth import OpenAPIOAuthClient
from repositories.oauth_client_repository import SQLAlchemyOAuthClientRepository
from services.oauth_token_contracts import GrantType


def _create(repository: SQLAlchemyOAuthClientRepository, client_id: str) -> None:
    repository.create(
        client_id=client_id,
        kind=OAuthClientKind.PUBLIC,
        display_name="Agent",
        redirect_uris=["http://127.0.0.1/callback"],
        grant_types=[GrantType.AUTHORIZATION_CODE],
    )


def _last_token_at(session: Session, client_id: str) -> datetime | None:
    session.expire_all()
    return session.scalar(select(OpenAPIOAuthClient.last_token_at).where(OpenAPIOAuthClient.client_id == client_id))


def test_mark_token_issued_sets_the_time_once(sqlite_session_factory: sessionmaker[Session]) -> None:
    repository = SQLAlchemyOAuthClientRepository(session_factory=sqlite_session_factory)
    _create(repository, "dcr_a")

    repository.mark_token_issued("dcr_a")
    with sqlite_session_factory() as session:
        first = _last_token_at(session, "dcr_a")
    assert first is not None

    repository.mark_token_issued("dcr_a")
    repository.mark_token_issued("https://agent.example/client.json")
    with sqlite_session_factory() as session:
        assert _last_token_at(session, "dcr_a") == first
