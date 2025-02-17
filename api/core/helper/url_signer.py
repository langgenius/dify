import base64
import hashlib
import hmac
import os
import time

from pydantic import BaseModel, Field

from configs import dify_config


class SignedUrlParams(BaseModel):
    sign_key: str = Field(..., description="The sign key")
    timestamp: str = Field(..., description="Timestamp")
    nonce: str = Field(..., description="Nonce")
    sign: str = Field(..., description="Signature")


class UrlSigner:
    @classmethod
    def get_signed_url(cls, url: str, sign_key: str, prefix: str) -> str:
        signed_url_params = cls.get_signed_url_params(sign_key, prefix)
        return (
            f"{url}?timestamp={signed_url_params.timestamp}"
            f"&nonce={signed_url_params.nonce}&sign={signed_url_params.sign}"
        )

    @classmethod
    def get_signed_url_params(cls, sign_key: str, prefix: str) -> SignedUrlParams:
        timestamp = str(int(time.time()))
        nonce = os.urandom(16).hex()
        sign = cls._sign(sign_key, timestamp, nonce, prefix)

        return SignedUrlParams(sign_key=sign_key, timestamp=timestamp, nonce=nonce, sign=sign)

    @classmethod
    def verify(cls, sign_key: str, timestamp: str, nonce: str, sign: str, prefix: str) -> bool:
        recalculated_sign = cls._sign(sign_key, timestamp, nonce, prefix)

        return sign == recalculated_sign

    @classmethod
    def _sign(cls, sign_key: str, timestamp: str, nonce: str, prefix: str) -> str:
        if not dify_config.SECRET_KEY:
            raise Exception("SECRET_KEY is not set")

        data_to_sign = f"{prefix}|{sign_key}|{timestamp}|{nonce}"
        secret_key = dify_config.SECRET_KEY.encode()
        sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
        encoded_sign = base64.urlsafe_b64encode(sign).decode()

        return encoded_sign
