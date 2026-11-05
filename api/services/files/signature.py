"""Sign an upload reference after its caller has checked access."""

import urllib.parse

from configs import dify_config
from core.tools.signature import bind_file_uri
from libs.signed_query import sign_query


def sign_upload_file_uri(*, upload_file_id: str, as_attachment: bool = False) -> str:
    query = sign_query(payload=f"file-preview|{upload_file_id}", key=dify_config.SECRET_KEY.encode())
    if as_attachment:
        query["as_attachment"] = "true"
    return f"/files/{upload_file_id}/file-preview?{urllib.parse.urlencode(query)}"


def sign_upload_file_url(*, upload_file_id: str) -> str:
    return bind_file_uri(sign_upload_file_uri(upload_file_id=upload_file_id), dify_config.FILES_URL)
