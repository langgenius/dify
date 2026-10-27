"""Seed refresh tokens through the same insert the token issuer uses."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session, sessionmaker

from libs.oauth_bearer import sha256_hex
from repositories.oauth_refresh_token_repository import insert_refresh_token, new_refresh_token
from services.oauth_device_contracts import GrantKey, RefreshTokenWrite


def seed_refresh_token(
    factory: sessionmaker[Session],
    *,
    grant: GrantKey,
    account_id: str,
    workspace_id: str | None,
    lifetime: timedelta,
    family_id: str | None = None,
) -> str:
    token = new_refresh_token()
    write = RefreshTokenWrite(
        token_hash=sha256_hex(token),
        family_id=family_id or str(uuid.uuid4()),
        workspace_id=workspace_id,
        expires_at=datetime.now(UTC) + lifetime,
        presented=None,
    )
    with factory() as session, session.begin():
        insert_refresh_token(session, grant=grant, account_id=account_id, write=write)
    return token
