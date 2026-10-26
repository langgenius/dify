from typing import cast

from sqlalchemy import Table, create_engine, select
from sqlalchemy.orm import Session

from enums.oauth_client import OAuthClientKind
from models.oauth import OAuthClient


def test_oauth_client_round_trips_list_fields() -> None:
    engine = create_engine("sqlite:///:memory:")
    cast(Table, OAuthClient.__table__).create(engine)
    client = OAuthClient(
        client_id="nango",
        kind=OAuthClientKind.CONFIDENTIAL,
        display_name="Nango",
        redirect_uris=["https://api.nango.dev/oauth/callback", "http://127.0.0.1/callback"],
        grant_types=["authorization_code", "refresh_token"],
        client_secret_hash="a" * 64,
    )
    with Session(engine) as session:
        session.add(client)
        session.commit()
        client_pk = client.id

    with Session(engine) as session:
        loaded = session.scalars(select(OAuthClient).where(OAuthClient.id == client_pk)).one()
        assert loaded.kind is OAuthClientKind.CONFIDENTIAL
        assert loaded.redirect_uris == ["https://api.nango.dev/oauth/callback", "http://127.0.0.1/callback"]
        assert loaded.grant_types == ["authorization_code", "refresh_token"]
        assert loaded.logo_uri is None
        assert loaded.created_at is not None


def test_public_client_has_no_secret() -> None:
    engine = create_engine("sqlite:///:memory:")
    cast(Table, OAuthClient.__table__).create(engine)
    with Session(engine) as session:
        session.add(
            OAuthClient(
                client_id="difyctl",
                kind=OAuthClientKind.PUBLIC,
                display_name="difyctl",
                redirect_uris=[],
                grant_types=["authorization_code"],
            )
        )
        session.commit()
        loaded = session.scalars(select(OAuthClient)).one()
        assert loaded.client_secret_hash is None
        assert loaded.kind is OAuthClientKind.PUBLIC
