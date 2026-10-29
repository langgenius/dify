"""SQLAlchemy persistence adapter for dynamically registered OAuth clients."""

from collections.abc import Sequence

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, sessionmaker

from models.oauth import OpenAPIOAuthClient
from services.oauth_client_metadata import known_grant_types
from services.oauth_clients import ResolvedClient
from services.oauth_token_contracts import GrantType


class SQLAlchemyOAuthClientRepository:
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def resolve(self, client_id: str) -> ResolvedClient | None:
        with self._session_factory() as session:
            row = session.scalar(select(OpenAPIOAuthClient).where(OpenAPIOAuthClient.client_id == client_id))
        if row is None:
            return None
        return ResolvedClient(
            client_id=row.client_id,
            storage_client_id=row.client_id,
            display_name=row.display_name,
            logo_uri=row.logo_uri,
            redirect_uris=tuple(row.redirect_uris),
            grant_types=frozenset(known_grant_types(row.grant_types, allowed=GrantType)),
        )

    def create(
        self,
        *,
        client_id: str,
        display_name: str,
        redirect_uris: Sequence[str],
        grant_types: Sequence[GrantType],
        logo_uri: str | None = None,
    ) -> None:
        row = OpenAPIOAuthClient(
            client_id=client_id,
            display_name=display_name,
            redirect_uris=list(redirect_uris),
            grant_types=[str(grant) for grant in grant_types],
            logo_uri=logo_uri,
        )
        with self._session_factory() as session:
            session.add(row)
            session.commit()

    def mark_token_issued(self, client_id: str) -> None:
        with self._session_factory() as session, session.begin():
            session.execute(
                update(OpenAPIOAuthClient)
                .where(OpenAPIOAuthClient.client_id == client_id, OpenAPIOAuthClient.last_token_at.is_(None))
                .values(last_token_at=func.now())
            )
