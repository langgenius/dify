import base64
import hashlib
import hmac
import os
import re
import time
import urllib.parse

from configs import dify_config


def get_signed_file_url(upload_file_id: str, as_attachment=False) -> str:
    url = f"{dify_config.FILES_URL}/files/{upload_file_id}/file-preview"

    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    key = dify_config.SECRET_KEY.encode()
    msg = f"file-preview|{upload_file_id}|{timestamp}|{nonce}"
    sign = hmac.new(key, msg.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(sign).decode()
    query = {"timestamp": timestamp, "nonce": nonce, "sign": encoded_sign}
    if as_attachment:
        query["as_attachment"] = "true"
    query_string = urllib.parse.urlencode(query)

    return f"{url}?{query_string}"


def get_signed_file_url_for_plugin(filename: str, mimetype: str, tenant_id: str, user_id: str) -> str:
    # Plugin access should use internal URL for Docker network communication
    base_url = dify_config.INTERNAL_FILES_URL or dify_config.FILES_URL
    url = f"{base_url}/files/upload/for-plugin"
    timestamp = str(int(time.time()))
    nonce = os.urandom(16).hex()
    key = dify_config.SECRET_KEY.encode()
    msg = f"upload|{filename}|{mimetype}|{tenant_id}|{user_id}|{timestamp}|{nonce}"
    sign = hmac.new(key, msg.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(sign).decode()
    return f"{url}?timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}&user_id={user_id}&tenant_id={tenant_id}"


def verify_plugin_file_signature(
    *, filename: str, mimetype: str, tenant_id: str, user_id: str, timestamp: str, nonce: str, sign: str
) -> bool:
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


def _generate_signed_url(
    upload_file_id: str, sign_type: str, base_url: str
) -> str:
    """
    Generate a signed URL for file preview.
    
    Args:
        upload_file_id: The file ID
        sign_type: Type of signature (e.g., "image-preview", "file-preview")
        base_url: Base URL path (e.g., "/files/{id}/file-preview")
        
    Returns:
        Signed URL with timestamp, nonce, and signature parameters
    """
    nonce = os.urandom(16).hex()
    timestamp = str(int(time.time()))
    data_to_sign = f"{sign_type}|{upload_file_id}|{timestamp}|{nonce}"
    secret_key = dify_config.SECRET_KEY.encode() if dify_config.SECRET_KEY else b""
    sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
    encoded_sign = base64.urlsafe_b64encode(sign).decode()
    
    params = f"timestamp={timestamp}&nonce={nonce}&sign={encoded_sign}"
    return f"{base_url}?{params}"


def sign_file_urls_in_text(text: str) -> str:
    """
    Core function to sign file URLs in text content.
    This is the core implementation reused by both DocumentSegment.get_sign_content()
    and sign_file_urls_in_content() to avoid code duplication.
    
    Args:
        text: Text content that may contain file URLs
        
    Returns:
        Text with signed file URLs
    """
    signed_urls: list[tuple[int, int, str]] = []

    # For data before v0.10.0 - image-preview
    pattern = r"/files/([a-f0-9\-]+)/image-preview(?:\?.*?)?"
    matches = re.finditer(pattern, text)
    for match in matches:
        upload_file_id = match.group(1)
        base_url = f"/files/{upload_file_id}/image-preview"
        signed_url = _generate_signed_url(upload_file_id, "image-preview", base_url)
        signed_urls.append((match.start(), match.end(), signed_url))

    # For data after v0.10.0 - file-preview
    pattern = r"/files/([a-f0-9\-]+)/file-preview(?:\?.*?)?"
    matches = re.finditer(pattern, text)
    for match in matches:
        upload_file_id = match.group(1)
        base_url = f"/files/{upload_file_id}/file-preview"
        signed_url = _generate_signed_url(upload_file_id, "file-preview", base_url)
        signed_urls.append((match.start(), match.end(), signed_url))

    # For tools directory - direct file formats (e.g., .png, .jpg, etc.)
    # Match URL including any query parameters up to common URL boundaries (space, parenthesis, quotes)
    pattern = r"/files/tools/([a-f0-9\-]+)\.([a-zA-Z0-9]+)(?:\?[^\s\)\"\']*)?"
    matches = re.finditer(pattern, text)
    for match in matches:
        upload_file_id = match.group(1)
        file_extension = match.group(2)
        base_url = f"/files/tools/{upload_file_id}.{file_extension}"
        signed_url = _generate_signed_url(upload_file_id, "file-preview", base_url)
        signed_urls.append((match.start(), match.end(), signed_url))

    # Reconstruct the text with signed URLs
    offset = 0
    for start, end, signed_url in signed_urls:
        text = text[: start + offset] + signed_url + text[end + offset :]
        offset += len(signed_url) - (end - start)

    return text


def sign_file_urls_in_content(content: str) -> str:
    """
    Sign file URLs in content text.
    This function signs file preview URLs (file-preview, image-preview, and tools/*) 
    found in the content text by adding timestamp, nonce, and signature parameters.
    
    This function reuses the core implementation from sign_file_urls_in_text()
    which is also used by DocumentSegment.get_sign_content() to maintain consistency.
    
    Args:
        content: Text content that may contain file URLs
        
    Returns:
        Content with signed file URLs
    """
    if not content:
        return content
    
    return sign_file_urls_in_text(content)
