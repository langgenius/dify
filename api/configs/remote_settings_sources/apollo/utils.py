import hashlib
import socket
from typing import Any

from .python_3x import url_encode

# define constants
CONFIGURATIONS = "configurations"
NOTIFICATION_ID = "notificationId"
NAMESPACE_NAME = "namespaceName"


# add timestamps uris and keys
def signature(timestamp: str, uri: str, secret: str) -> str:
    import base64
    import hmac

    string_to_sign = "" + timestamp + "\n" + uri
    hmac_code = hmac.new(secret.encode(), string_to_sign.encode(), hashlib.sha1).digest()
    return base64.b64encode(hmac_code).decode()


def url_encode_wrapper(params: dict[str, Any]) -> str:
    return url_encode(params)


def no_key_cache_key(namespace: str, key: str) -> str:
    return f"{namespace}{len(namespace)}{key}"


# Returns whether the obtained value is obtained, and None if it does not
def get_value_from_dict(namespace_cache: dict[str, Any] | None, key: str) -> Any:
    if namespace_cache:
        kv_data = namespace_cache.get(CONFIGURATIONS)
        if kv_data is None:
            return None
        if key in kv_data:
            return kv_data[key]
    return None


def init_ip() -> str:
    ip = ""
    s = None
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 53))
        ip = s.getsockname()[0]
    finally:
        if s:
            s.close()
    return ip
