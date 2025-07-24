import json
import logging
import re
import secrets
import string
import struct
import subprocess
import time
import uuid
from collections.abc import Generator, Mapping
from datetime import datetime
from hashlib import sha256
from typing import TYPE_CHECKING, Any, Optional, Union, cast
from zoneinfo import available_timezones

from flask import Response, stream_with_context
from flask_restful import fields
from pydantic import BaseModel

from configs import dify_config
from core.app.features.rate_limiting.rate_limit import RateLimitGenerator
from core.file import helpers as file_helpers
from core.model_runtime.utils.encoders import jsonable_encoder
from extensions.ext_redis import redis_client

if TYPE_CHECKING:
    from models.account import Account
    from models.model import EndUser


def extract_tenant_id(user: Union["Account", "EndUser"]) -> str | None:
    """
    Extract tenant_id from Account or EndUser object.

    Args:
        user: Account or EndUser object

    Returns:
        tenant_id string if available, None otherwise

    Raises:
        ValueError: If user is neither Account nor EndUser
    """
    from models.account import Account
    from models.model import EndUser

    if isinstance(user, Account):
        return user.current_tenant_id
    elif isinstance(user, EndUser):
        return user.tenant_id
    else:
        raise ValueError(f"Invalid user type: {type(user)}. Expected Account or EndUser.")


def run(script):
    return subprocess.getstatusoutput("source /root/.bashrc && " + script)


class AppIconUrlField(fields.Raw):
    def output(self, key, obj):
        if obj is None:
            return None

        from models.model import App, IconType, Site

        if isinstance(obj, dict) and "app" in obj:
            obj = obj["app"]

        if isinstance(obj, App | Site) and obj.icon_type == IconType.IMAGE.value:
            return file_helpers.get_signed_file_url(obj.icon)
        return None


class AvatarUrlField(fields.Raw):
    def output(self, key, obj):
        if obj is None:
            return None

        from models.account import Account

        if isinstance(obj, Account) and obj.avatar is not None:
            return file_helpers.get_signed_file_url(obj.avatar)
        return None


class TimestampField(fields.Raw):
    def format(self, value) -> int:
        return int(value.timestamp())


def email(email):
    # Define a regex pattern for email addresses
    pattern = r"^[\w\.!#$%&'*+\-/=?^_`{|}~]+@([\w-]+\.)+[\w-]{2,}$"
    # Check if the email matches the pattern
    if re.match(pattern, email) is not None:
        return email

    error = "{email} is not a valid email.".format(email=email)
    raise ValueError(error)


def uuid_value(value):
    if value == "":
        return str(value)

    try:
        uuid_obj = uuid.UUID(value)
        return str(uuid_obj)
    except ValueError:
        error = "{value} is not a valid uuid.".format(value=value)
        raise ValueError(error)


def alphanumeric(value: str):
    # check if the value is alphanumeric and underlined
    if re.match(r"^[a-zA-Z0-9_]+$", value):
        return value

    raise ValueError(f"{value} is not a valid alphanumeric value")


def timestamp_value(timestamp):
    try:
        int_timestamp = int(timestamp)
        if int_timestamp < 0:
            raise ValueError
        return int_timestamp
    except ValueError:
        error = "{timestamp} is not a valid timestamp.".format(timestamp=timestamp)
        raise ValueError(error)


class StrLen:
    """Restrict input to an integer in a range (inclusive)"""

    def __init__(self, max_length, argument="argument"):
        self.max_length = max_length
        self.argument = argument

    def __call__(self, value):
        length = len(value)
        if length > self.max_length:
            error = "Invalid {arg}: {val}. {arg} cannot exceed length {length}".format(
                arg=self.argument, val=value, length=self.max_length
            )
            raise ValueError(error)

        return value


class DatetimeString:
    def __init__(self, format, argument="argument"):
        self.format = format
        self.argument = argument

    def __call__(self, value):
        try:
            datetime.strptime(value, self.format)
        except ValueError:
            error = "Invalid {arg}: {val}. {arg} must be conform to the format {format}".format(
                arg=self.argument, val=value, format=self.format
            )
            raise ValueError(error)

        return value


def _get_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError("{} is not a valid float".format(value))


def timezone(timezone_string):
    if timezone_string and timezone_string in available_timezones():
        return timezone_string

    error = "{timezone_string} is not a valid timezone.".format(timezone_string=timezone_string)
    raise ValueError(error)


def generate_string(n):
    letters_digits = string.ascii_letters + string.digits
    result = ""
    for i in range(n):
        result += secrets.choice(letters_digits)

    return result


def extract_remote_ip(request) -> str:
    if request.headers.get("CF-Connecting-IP"):
        return cast(str, request.headers.get("CF-Connecting-IP"))
    elif request.headers.getlist("X-Forwarded-For"):
        return cast(str, request.headers.getlist("X-Forwarded-For")[0])
    else:
        return cast(str, request.remote_addr)


def generate_text_hash(text: str) -> str:
    hash_text = str(text) + "None"
    return sha256(hash_text.encode()).hexdigest()


def compact_generate_response(response: Union[Mapping, Generator, RateLimitGenerator]) -> Response:
    if isinstance(response, dict):
        return Response(response=json.dumps(jsonable_encoder(response)), status=200, mimetype="application/json")
    else:

        def generate() -> Generator:
            yield from response

        return Response(stream_with_context(generate()), status=200, mimetype="text/event-stream")


def length_prefixed_response(magic_number: int, response: Union[Mapping, Generator, RateLimitGenerator]) -> Response:
    """
    This function is used to return a response with a length prefix.
    Magic number is a one byte number that indicates the type of the response.

    For a compatibility with latest plugin daemon https://github.com/langgenius/dify-plugin-daemon/pull/341
    Avoid using line-based response, it leads a memory issue.

    We uses following format:
    | Field         | Size     | Description                     |
    |---------------|----------|---------------------------------|
    | Magic Number  | 1 byte   | Magic number identifier         |
    | Reserved      | 1 byte   | Reserved field                  |
    | Header Length | 2 bytes  | Header length (usually 0xa)    |
    | Data Length   | 4 bytes  | Length of the data              |
    | Reserved      | 6 bytes  | Reserved fields                 |
    | Data          | Variable | Actual data content             |

    | Reserved Fields | Header   | Data     |
    |-----------------|----------|----------|
    | 4 bytes total   | Variable | Variable |

    all data is in little endian
    """

    def pack_response_with_length_prefix(response: bytes) -> bytes:
        header_length = 0xA
        data_length = len(response)
        # | Magic Number 1byte | Reserved 1byte | Header Length 2bytes | Data Length 4bytes | Reserved 6bytes | Data
        return struct.pack("<BBHI", magic_number, 0, header_length, data_length) + b"\x00" * 6 + response

    if isinstance(response, dict):
        return Response(
            response=pack_response_with_length_prefix(json.dumps(jsonable_encoder(response)).encode("utf-8")),
            status=200,
            mimetype="application/json",
        )
    elif isinstance(response, BaseModel):
        return Response(
            response=pack_response_with_length_prefix(response.model_dump_json().encode("utf-8")),
            status=200,
            mimetype="application/json",
        )

    def generate() -> Generator:
        for chunk in response:
            if isinstance(chunk, str):
                yield pack_response_with_length_prefix(chunk.encode("utf-8"))
            else:
                yield pack_response_with_length_prefix(chunk)

    return Response(stream_with_context(generate()), status=200, mimetype="text/event-stream")


class TokenManager:
    @classmethod
    def generate_token(
        cls,
        token_type: str,
        account: Optional["Account"] = None,
        email: Optional[str] = None,
        additional_data: Optional[dict] = None,
    ) -> str:
        if account is None and email is None:
            raise ValueError("Account or email must be provided")

        account_id = account.id if account else None
        account_email = account.email if account else email

        if account_id:
            old_token = cls._get_current_token_for_account(account_id, token_type)
            if old_token:
                if isinstance(old_token, bytes):
                    old_token = old_token.decode("utf-8")
                cls.revoke_token(old_token, token_type)

        token = str(uuid.uuid4())
        token_data = {"account_id": account_id, "email": account_email, "token_type": token_type}
        if additional_data:
            token_data.update(additional_data)

        expiry_minutes = dify_config.model_dump().get(f"{token_type.upper()}_TOKEN_EXPIRY_MINUTES")
        if expiry_minutes is None:
            raise ValueError(f"Expiry minutes for {token_type} token is not set")
        token_key = cls._get_token_key(token, token_type)
        expiry_time = int(expiry_minutes * 60)
        redis_client.setex(token_key, expiry_time, json.dumps(token_data))

        if account_id:
            cls._set_current_token_for_account(account_id, token, token_type, expiry_minutes)

        return token

    @classmethod
    def _get_token_key(cls, token: str, token_type: str) -> str:
        return f"{token_type}:token:{token}"

    @classmethod
    def revoke_token(cls, token: str, token_type: str):
        token_key = cls._get_token_key(token, token_type)
        redis_client.delete(token_key)

    @classmethod
    def get_token_data(cls, token: str, token_type: str) -> Optional[dict[str, Any]]:
        key = cls._get_token_key(token, token_type)
        token_data_json = redis_client.get(key)
        if token_data_json is None:
            logging.warning(f"{token_type} token {token} not found with key {key}")
            return None
        token_data: Optional[dict[str, Any]] = json.loads(token_data_json)
        return token_data

    @classmethod
    def _get_current_token_for_account(cls, account_id: str, token_type: str) -> Optional[str]:
        key = cls._get_account_token_key(account_id, token_type)
        current_token: Optional[str] = redis_client.get(key)
        return current_token

    @classmethod
    def _set_current_token_for_account(
        cls, account_id: str, token: str, token_type: str, expiry_hours: Union[int, float]
    ):
        key = cls._get_account_token_key(account_id, token_type)
        expiry_time = int(expiry_hours * 60 * 60)
        redis_client.setex(key, expiry_time, token)

    @classmethod
    def _get_account_token_key(cls, account_id: str, token_type: str) -> str:
        return f"{token_type}:account:{account_id}"


class RateLimiter:
    def __init__(self, prefix: str, max_attempts: int, time_window: int):
        self.prefix = prefix
        self.max_attempts = max_attempts
        self.time_window = time_window

    def _get_key(self, email: str) -> str:
        return f"{self.prefix}:{email}"

    def is_rate_limited(self, email: str) -> bool:
        key = self._get_key(email)
        current_time = int(time.time())
        window_start_time = current_time - self.time_window

        redis_client.zremrangebyscore(key, "-inf", window_start_time)
        attempts = redis_client.zcard(key)

        if attempts and int(attempts) >= self.max_attempts:
            return True
        return False

    def increment_rate_limit(self, email: str):
        key = self._get_key(email)
        current_time = int(time.time())

        redis_client.zadd(key, {current_time: current_time})
        redis_client.expire(key, self.time_window * 2)
