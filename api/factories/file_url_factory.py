"""Refresh hosted file links in messages and frozen form display content."""

import base64
import hashlib
import hmac
import re
from urllib.parse import parse_qs, parse_qsl, quote, unquote_plus, urlsplit

from configs import dify_config
from core.tools.signature import sign_tool_file, sign_upload_file_preview_url
from graphon.file import helpers as file_helpers

# Agent answers contain Markdown links, backticked links, and bare URLs. Keep
# relative /files/ links too; skipping those formats previously left internal
# file hosts in browser-facing answers. Refs #40788.
_CONTENT_URL = re.compile(r"""https?://[^\s<>"'`()\[\]]+|(?<![\w/])/files/[^\s<>"'`()\[\]]+""")
_FILE_PREVIEW_PATH = re.compile(
    r"/files/(?:(?P<upload_id>[\w-]+)/(?P<preview_kind>file|image)-preview"
    r"|(?P<generated_kind>tools|datasources)/(?P<generated_id>[\w-]+)(?P<extension>\.[^/]+)?)$"
)


def re_sign_file_urls(
    content: str,
    *,
    preserve_url: bool = False,
    replacements: dict[str, str] | None = None,
) -> str:
    """Refresh display links, reusing replacements across related content.

    Messages retain their existing external-host and legacy-preview conversion.
    Frozen forms preserve the original URL and renew only authentic signatures.
    """
    if not content:
        return content
    if replacements is None:
        replacements = {}

    def replace_url(match: re.Match[str]) -> str:
        candidate = match.group()
        url = candidate.rstrip(".,;")
        if url not in replacements:
            replacements[url] = _re_sign_file_url(url, preserve_url=preserve_url)
        return replacements[url] + candidate[len(url) :]

    return _CONTENT_URL.sub(replace_url, content)


def _re_sign_file_url(url: str, *, preserve_url: bool) -> str:
    parsed = urlsplit(url)
    path = _FILE_PREVIEW_PATH.search(parsed.path)
    if path is None:
        return url
    query = parse_qs(parsed.query, keep_blank_values=True)
    if any(len(query.get(key, [])) != 1 for key in ("timestamp", "nonce", "sign")):
        return url
    file_id = path.group("upload_id") or path.group("generated_id")
    preview_kind = path.group("preview_kind") or "file"
    if preserve_url:
        if not any(
            url.startswith(f"{base_url}/files/")
            for base_url in (dify_config.FILES_URL, dify_config.INTERNAL_FILES_URL, "")
        ):
            return url
        # Ignore expiry, but do not grant access to arbitrary paths embedded in
        # user-authored content merely because they resemble hosted file URLs.
        payload = f"{preview_kind}-preview|{file_id}|{query['timestamp'][0]}|{query['nonce'][0]}"
        expected = base64.urlsafe_b64encode(
            hmac.new(dify_config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
        )
        if not hmac.compare_digest(query["sign"][0].encode(), expected):
            return url

    if path.group("generated_id"):
        if not preserve_url and path.group("generated_kind") != "tools":
            return url
        extension = path.group("extension") or ""
        if not preserve_url:
            extension = f".{extension.rsplit('.', 1)[-1]}" if extension else ".bin"
            if len(extension) > 10:
                extension = ".bin"
        signed_url = sign_tool_file(tool_file_id=file_id, extension=extension)
    elif preserve_url and preview_kind == "image":
        signed_url = sign_upload_file_preview_url(upload_file_id=file_id, extension="")
    else:
        # Messages keep converting deprecated image-preview links to file-preview.
        signed_url = file_helpers.get_signed_file_url(file_id)

    if not preserve_url:
        if "as_attachment" in url:
            signed_url += "&as_attachment=true"
        return signed_url

    signature_query = dict(parse_qsl(urlsplit(signed_url).query))
    # Preserve download options and unrelated query encoding in frozen content.
    parameters: list[str] = []
    for parameter in parsed.query.split("&"):
        key = unquote_plus(parameter.partition("=")[0])
        if key in signature_query:
            parameter = f"{key}={quote(signature_query[key], safe='')}"
        parameters.append(parameter)
    return parsed._replace(query="&".join(parameters)).geturl()
