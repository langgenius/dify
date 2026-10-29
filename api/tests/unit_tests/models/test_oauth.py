from typing import cast

from sqlalchemy import Table, create_engine, select
from sqlalchemy.orm import Session

from models.oauth import OpenAPIOAuthClient


def test_oauth_client_round_trips_list_fields() -> None:
    engine = create_engine("sqlite:///:memory:")
    cast(Table, OpenAPIOAuthClient.__table__).create(engine)
    with Session(engine) as session:
        session.add(
            OpenAPIOAuthClient(
                client_id="nango",
                display_name="Nango",
                redirect_uris=["https://api.nango.dev/oauth/callback", "http://127.0.0.1/callback"],
                grant_types=["authorization_code", "refresh_token"],
            )
        )
        session.commit()

    with Session(engine) as session:
        loaded = session.scalars(select(OpenAPIOAuthClient)).one()
        assert loaded.redirect_uris == ["https://api.nango.dev/oauth/callback", "http://127.0.0.1/callback"]
        assert loaded.grant_types == ["authorization_code", "refresh_token"]
