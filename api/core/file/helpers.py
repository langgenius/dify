import base64
import hashlib
import hmac
import os
import time

from configs import dify_config


def get_signed_file_url(upload_file_id: str) -> str:
    url = f"{dify_config.FILES_URL}/files/{upload_file_id}/file-preview"

    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    key = dify_config.SECRET_KEY.encode()
    msg = f"file-preview|{upload_file_id}|{timestamp}|{nonce}"
    sign = hmac.new(key, msg.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(sign).decode()

    return f"{url}?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"


def get_signed_file_url_for_plugin(filename: str, mimetype: str, tenant_id: str, user_id: str) -> str:
    url = f"{dify_config.FILES_URL}/files/upload/for-plugin"

    if user_id is None:
        user_id = "DEFAULT-USER"

    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    key = dify_config.SECRET_KEY.encode()
    msg = f"upload|{filename}|{mimetype}|{tenant_id}|{user_id}|{timestamp}|{nonce}"
    sign = hmac.new(key, msg.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(sign).decode()

    return f"{url}?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}&user_id={user_id}&tenant_id={tenant_id}"


def verify_plugin_file_signature(
    *, filename: str, mimetype: str, tenant_id: str, user_id: str | None, timestamp: str, nonce: str, sign: str
) -> bool:
    if user_id is None:
        user_id = "DEFAULT-USER"

    data_to_sign = f"upload|{filename}|{mimetype}|{tenant_id}|{user_id}|{timestamp}|{nonce}"
    secret_key = dify_config.SECRET_KEY.encode()
    recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
    recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

    # verify signature
    if sign != recalculated_encoded_sign:
        return False

    current_time = int(time.time())
    return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT


def verify_image_signature(*, upload_file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
    data_to_sign = f"image-preview|{upload_file_id}|{timestamp}|{nonce}"
    secret_key = dify_config.SECRET_KEY.encode()
    recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
    recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

    # verify signature
    if sign != recalculated_encoded_sign:
        return False

    current_time = int(time.time())
    return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT


def verify_file_signature(*, upload_file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
    data_to_sign = f"file-preview|{upload_file_id}|{timestamp}|{nonce}"
    secret_key = dify_config.SECRET_KEY.encode()
    recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
    recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

    # verify signature
    if sign != recalculated_encoded_sign:
        return False

    current_time = int(time.time())
    return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT
