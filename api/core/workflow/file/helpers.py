from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
import urllib.parse

from .runtime import get_workflow_file_runtime


def get_signed_file_url(upload_file_id: str, as_attachment: bool = False, for_external: bool = True) -> str:
    runtime = get_workflow_file_runtime()
    base_url = runtime.files_url if for_external else (runtime.internal_files_url or runtime.files_url)
    url = f"{base_url}/files/{upload_file_id}/file-preview"

    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    key = runtime.secret_key.encode()
    msg = f"file-preview|{upload_file_id}|{timestamp}|{nonce}"
    sign = hmac.new(key, msg.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(sign).decode()
    query: dict[str, str] = {"timestamp": timestamp, "nonce": nonce, "sign": encoded_sign}
    if as_attachment:
        query["as_attachment"] = "true"
    query_string = urllib.parse.urlencode(query)

    return f"{url}?{query_string}"


def get_signed_file_url_for_plugin(filename: str, mimetype: str, tenant_id: str, user_id: str) -> str:
    runtime = get_workflow_file_runtime()
    # Plugin access should use internal URL for Docker network communication.
    base_url = runtime.internal_files_url or runtime.files_url
    url = f"{base_url}/files/upload/for-plugin"
    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    key = runtime.secret_key.encode()
    msg = f"upload|{filename}|{mimetype}|{tenant_id}|{user_id}|{timestamp}|{nonce}"
    sign = hmac.new(key, msg.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(sign).decode()
    return f"{url}?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}&user_id={user_id}&tenant_id={tenant_id}"


def get_signed_tool_file_url(tool_file_id: str, extension: str, for_external: bool = True) -> str:
    runtime = get_workflow_file_runtime()
    return runtime.sign_tool_file(tool_file_id=tool_file_id, extension=extension, for_external=for_external)


def verify_plugin_file_signature(
    *, filename: str, mimetype: str, tenant_id: str, user_id: str, timestamp: str, nonce: str, sign: str
) -> bool:
    runtime = get_workflow_file_runtime()
    data_to_sign = f"upload|{filename}|{mimetype}|{tenant_id}|{user_id}|{timestamp}|{nonce}"
    secret_key = runtime.secret_key.encode()
    recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
    recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

    if sign != recalculated_encoded_sign:
        return False

    current_time = int(time.time())
    return current_time - int(timestamp) <= runtime.files_access_timeout


def verify_image_signature(*, upload_file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
    runtime = get_workflow_file_runtime()
    data_to_sign = f"image-preview|{upload_file_id}|{timestamp}|{nonce}"
    secret_key = runtime.secret_key.encode()
    recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
    recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

    if sign != recalculated_encoded_sign:
        return False

    current_time = int(time.time())
    return current_time - int(timestamp) <= runtime.files_access_timeout


def verify_file_signature(*, upload_file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
    runtime = get_workflow_file_runtime()
    data_to_sign = f"file-preview|{upload_file_id}|{timestamp}|{nonce}"
    secret_key = runtime.secret_key.encode()
    recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
    recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

    if sign != recalculated_encoded_sign:
        return False

    current_time = int(time.time())
    return current_time - int(timestamp) <= runtime.files_access_timeout
