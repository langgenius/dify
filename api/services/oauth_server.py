import enum
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session
from werkzeug.exceptions import BadRequest

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import Account
from models.model import OAuthProviderApp
from services.account_service import AccountService


class OAuthGrantType(enum.StrEnum):
    AUTHORIZATION_CODE = "authorization_code"
    REFRESH_TOKEN = "refresh_token"


OAUTH_AUTHORIZATION_CODE_REDIS_KEY = "oauth_provider:{client_id}:authorization_code:{code}"
OAUTH_ACCESS_TOKEN_REDIS_KEY = "oauth_provider:{client_id}:access_token:{token}"
OAUTH_ACCESS_TOKEN_EXPIRES_IN = 60 * 60 * 12  # 12 hours
OAUTH_REFRESH_TOKEN_REDIS_KEY = "oauth_provider:{client_id}:refresh_token:{token}"
OAUTH_REFRESH_TOKEN_EXPIRES_IN = 60 * 60 * 24 * 30  # 30 days


class OAuthServerService:
    @staticmethod
    def get_oauth_provider_app(client_id: str) -> OAuthProviderApp | None:
        query = select(OAuthProviderApp).where(OAuthProviderApp.client_id == client_id)

        with Session(db.engine) as session:
            return session.execute(query).scalar_one_or_none()

    @staticmethod
    def sign_oauth_authorization_code(client_id: str, user_account_id: str) -> str:
        code = str(uuid.uuid4())
        redis_key = OAUTH_AUTHORIZATION_CODE_REDIS_KEY.format(client_id=client_id, code=code)
        redis_client.set(redis_key, user_account_id, ex=60 * 10)  # 10 minutes
        return code

    @staticmethod
    def sign_oauth_access_token(
        grant_type: OAuthGrantType,
        code: str = "",
        client_id: str = "",
        refresh_token: str = "",
    ) -> tuple[str, str]:
        match grant_type:
            case OAuthGrantType.AUTHORIZATION_CODE:
                redis_key = OAUTH_AUTHORIZATION_CODE_REDIS_KEY.format(client_id=client_id, code=code)
                user_account_id = redis_client.get(redis_key)
                if not user_account_id:
                    raise BadRequest("invalid code")

                # delete code
                redis_client.delete(redis_key)

                access_token = OAuthServerService._sign_oauth_access_token(client_id, user_account_id)
                refresh_token = OAuthServerService._sign_oauth_refresh_token(client_id, user_account_id)
                return access_token, refresh_token
            case OAuthGrantType.REFRESH_TOKEN:
                redis_key = OAUTH_REFRESH_TOKEN_REDIS_KEY.format(client_id=client_id, token=refresh_token)
                user_account_id = redis_client.get(redis_key)
                if not user_account_id:
                    raise BadRequest("invalid refresh token")

                access_token = OAuthServerService._sign_oauth_access_token(client_id, user_account_id)
                return access_token, refresh_token

    @staticmethod
    def _sign_oauth_access_token(client_id: str, user_account_id: str) -> str:
        token = str(uuid.uuid4())
        redis_key = OAUTH_ACCESS_TOKEN_REDIS_KEY.format(client_id=client_id, token=token)
        redis_client.set(redis_key, user_account_id, ex=OAUTH_ACCESS_TOKEN_EXPIRES_IN)
        return token

    @staticmethod
    def _sign_oauth_refresh_token(client_id: str, user_account_id: str) -> str:
        token = str(uuid.uuid4())
        redis_key = OAUTH_REFRESH_TOKEN_REDIS_KEY.format(client_id=client_id, token=token)
        redis_client.set(redis_key, user_account_id, ex=OAUTH_REFRESH_TOKEN_EXPIRES_IN)
        return token

    @staticmethod
    def validate_oauth_access_token(client_id: str, token: str) -> Account | None:
        redis_key = OAUTH_ACCESS_TOKEN_REDIS_KEY.format(client_id=client_id, token=token)
        user_account_id = redis_client.get(redis_key)
        if not user_account_id:
            return None

        user_id_str = user_account_id.decode("utf-8")

        return AccountService.load_user(user_id_str)
