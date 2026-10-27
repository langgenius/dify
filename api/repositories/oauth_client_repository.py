"""SQLAlchemy persistence adapter for pre-registered OAuth clients."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from enums.oauth_client import OAuthClientKind
from models.model import OAuthProviderApp
from models.oauth import OpenAPIOAuthClient
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
            kind=row.kind,
            display_name=row.display_name,
            logo_uri=row.logo_uri,
            redirect_uris=tuple(row.redirect_uris),
            grant_types=_known_grant_types(row.grant_types),
            secret_hash=row.client_secret_hash,
        )

    def create(
        self,
        *,
        client_id: str,
        kind: OAuthClientKind,
        display_name: str,
        redirect_uris: Sequence[str],
        grant_types: Sequence[GrantType],
        client_secret_hash: str | None = None,
        logo_uri: str | None = None,
    ) -> OpenAPIOAuthClient:
        row = OpenAPIOAuthClient(
            client_id=client_id,
            kind=kind,
            display_name=display_name,
            redirect_uris=list(redirect_uris),
            grant_types=[str(grant) for grant in grant_types],
            client_secret_hash=client_secret_hash,
            logo_uri=logo_uri,
        )
        with self._session_factory() as session:
            session.add(row)
            session.commit()
            session.refresh(row)
            session.expunge(row)
        return row

    def provider_app_exists(self, client_id: str) -> bool:
        with self._session_factory() as session:
            found = session.scalar(select(OAuthProviderApp.id).where(OAuthProviderApp.client_id == client_id).limit(1))
        return found is not None


def _known_grant_types(raw: Sequence[str]) -> frozenset[GrantType]:
    known = {grant.value: grant for grant in GrantType}
    return frozenset(known[value] for value in raw if value in known)
