import base64
import hashlib
import hmac
import os
import time

from configs import dify_config


def sign_tool_file(tool_file_id: str, extension: str) -> str:
    """
    sign file to get a temporary url for plugin access
    """
    # Use internal URL for plugin/tool file access in Docker environments
    base_url = dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL
    file_preview_url = f"{base_url}/files/tools/{tool_file_id}{extension}"

    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    data_to_sign = f"file-preview|{tool_file_id}|{timestamp}|{nonce}"
    secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
    sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(sign).decode()

    return f"{file_preview_url}?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"


def verify_tool_file_signature(file_id: str, timestamp: str, nonce: str, sign: str) -> bool:
    """
    verify signature
    """
    data_to_sign = f"file-preview|{file_id}|{timestamp}|{nonce}"
    secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
    recalculated_sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
    recalculated_encoded_sign = base64.urlsafe_b64encode(recalculated_sign).decode()

    # verify signature
    if sign != recalculated_encoded_sign:
        return False

    current_time = int(time.time())
    return current_time - int(timestamp) <= dify_config.FILES_ACCESS_TIMEOUT
