"""Persistence adapters for OAuth authorization-server state."""

import uuid
from typing import override

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_redis import RedisClientWrapper
from models import Account
from models.model import OAuthProviderApp
from services.entities.oauth_server_entities import (
    OAuthProviderAccountRecord,
    OAuthProviderAccountStatus,
    OAuthProviderAppRecord,
)
from services.oauth_server_service import (
    OAUTH_ACCESS_TOKEN_EXPIRES_IN,
    OAUTH_AUTHORIZATION_CODE_EXPIRES_IN,
    OAUTH_REFRESH_TOKEN_EXPIRES_IN,
    OAuthServerRepository,
    OAuthServerRequestError,
    OAuthServerTokenRepository,
)

_APP_LABEL_ADAPTER = TypeAdapter(dict[str, object])
_REDIRECT_URIS_ADAPTER = TypeAdapter(list[str])

_AUTHORIZATION_CODE_KEY = "oauth_provider:{client_id}:authorization_code:{code}"
_ACCESS_TOKEN_KEY = "oauth_provider:{client_id}:access_token:{token}"
_REFRESH_TOKEN_KEY = "oauth_provider:{client_id}:refresh_token:{token}"


class SQLAlchemyOAuthServerRepository(OAuthServerRepository):
    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_provider_app_by_client_id(self, client_id: str) -> OAuthProviderAppRecord | None:
        stmt = select(
            OAuthProviderApp.app_icon,
            OAuthProviderApp.client_id,
            OAuthProviderApp.client_secret,
            OAuthProviderApp.app_label,
            OAuthProviderApp.redirect_uris,
            OAuthProviderApp.scope,
            OAuthProviderApp.auto_authorize,
        ).where(OAuthProviderApp.client_id == client_id)

        with self._session_factory() as session:
            row = session.execute(stmt).one_or_none()
            if row is None:
                return None
            return OAuthProviderAppRecord(
                app_icon=row.app_icon,
                client_id=row.client_id,
                client_secret=row.client_secret,
                app_label=_APP_LABEL_ADAPTER.validate_python(row.app_label),
                redirect_uris=tuple(_REDIRECT_URIS_ADAPTER.validate_python(row.redirect_uris)),
                scope=row.scope,
                auto_authorize=row.auto_authorize,
            )

    @override
    def get_account_by_id(self, account_id: str) -> OAuthProviderAccountRecord | None:
        stmt = select(
            Account.id,
            Account.name,
            Account.email,
            Account.avatar,
            Account.interface_language,
            Account.timezone,
            Account.status,
        ).where(Account.id == account_id)

        with self._session_factory() as session:
            row = session.execute(stmt).one_or_none()
            if row is None:
                return None
            return OAuthProviderAccountRecord(
                id=row.id,
                name=row.name,
                email=row.email,
                avatar=row.avatar,
                interface_language=row.interface_language,
                timezone=row.timezone,
                status=OAuthProviderAccountStatus(row.status.value),
            )


class RedisOAuthServerTokenRepository(OAuthServerTokenRepository):
    def __init__(self, redis: RedisClientWrapper) -> None:
        self._redis = redis

    @override
    def issue_authorization_code(self, client_id: str, account_id: str) -> str:
        code = str(uuid.uuid4())
        key = _AUTHORIZATION_CODE_KEY.format(client_id=client_id, code=code)
        self._redis.set(key, account_id, ex=OAUTH_AUTHORIZATION_CODE_EXPIRES_IN)
        return code

    @override
    def exchange_authorization_code(self, client_id: str, code: str) -> tuple[str, str]:
        key = _AUTHORIZATION_CODE_KEY.format(client_id=client_id, code=code)
        account_id = self._redis.getdel(key)
        if not account_id:
            raise OAuthServerRequestError("invalid code")

        normalized_account_id = self._decode(account_id)
        return (
            self._issue_access_token(client_id, normalized_account_id),
            self._issue_refresh_token(client_id, normalized_account_id),
        )

    @override
    def refresh_access_token(self, client_id: str, refresh_token: str) -> tuple[str, str]:
        key = _REFRESH_TOKEN_KEY.format(client_id=client_id, token=refresh_token)
        account_id = self._redis.get(key)
        if not account_id:
            raise OAuthServerRequestError("invalid refresh token")

        access_token = self._issue_access_token(client_id, self._decode(account_id))
        return access_token, refresh_token

    @override
    def resolve_account_id(self, client_id: str, access_token: str) -> str | None:
        key = _ACCESS_TOKEN_KEY.format(client_id=client_id, token=access_token)
        account_id = self._redis.get(key)
        return self._decode(account_id) if account_id else None

    def _issue_access_token(self, client_id: str, account_id: str) -> str:
        token = str(uuid.uuid4())
        key = _ACCESS_TOKEN_KEY.format(client_id=client_id, token=token)
        self._redis.set(key, account_id, ex=OAUTH_ACCESS_TOKEN_EXPIRES_IN)
        return token

    def _issue_refresh_token(self, client_id: str, account_id: str) -> str:
        token = str(uuid.uuid4())
        key = _REFRESH_TOKEN_KEY.format(client_id=client_id, token=token)
        self._redis.set(key, account_id, ex=OAUTH_REFRESH_TOKEN_EXPIRES_IN)
        return token

    @staticmethod
    def _decode(value: str | bytes) -> str:
        return value.decode("utf-8") if isinstance(value, bytes) else value
