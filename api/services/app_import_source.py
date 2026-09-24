"""Download URL imports once and detect YAML before falling back to package validation."""

import tempfile
from collections.abc import Generator
from contextlib import contextmanager
from typing import BinaryIO, cast
from urllib.parse import urlsplit, urlunsplit

import httpx
import yaml

from configs import dify_config
from core.file import remote_fetcher
from core.tools.errors import ToolSSRFError
from services.agent.errors import InvalidRosterAgentPackageError, RosterAgentPackageTooLargeError
from services.dsl_content import DSL_MAX_SIZE


@contextmanager
def download_app_import_source(url: str) -> Generator[BinaryIO]:
    """Fetch a bounded source without opening import transactions or creating resources."""
    url = url.strip()
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("An absolute HTTP(S) URL is required")
    except ValueError as exc:
        raise InvalidRosterAgentPackageError("App import URL is invalid") from exc
    if parsed.scheme == "https" and parsed.netloc == "github.com" and "/blob/" in parsed.path:
        url = urlunsplit(
            parsed._replace(netloc="raw.githubusercontent.com", path=parsed.path.replace("/blob/", "/", 1))
        )

    with tempfile.SpooledTemporaryFile(max_size=16 * 1024 * 1024, mode="w+b") as source:
        try:
            response = remote_fetcher.make_request(
                "GET",
                url,
                stream_response=True,
                follow_redirects=True,
                timeout=(10, 10),
                headers={"Accept-Encoding": "identity"},
            )
            try:
                response.raise_for_status()
                # Reject HTTP compression so the byte limit also bounds decompression memory.
                if response.headers.get("content-encoding", "identity").strip().lower() not in {"", "identity"}:
                    raise InvalidRosterAgentPackageError("Compressed HTTP import responses are not supported")
                size = 0
                for chunk in response.iter_bytes(chunk_size=1024 * 1024):
                    size += len(chunk)
                    if size > max(dify_config.AGENT_PACKAGE_MAX_BYTES, DSL_MAX_SIZE):
                        raise RosterAgentPackageTooLargeError("App import download exceeds the size limit")
                    source.write(chunk)
            finally:
                response.close()
        except (httpx.HTTPError, httpx.InvalidURL, remote_fetcher.max_retries_exceeded_error, ToolSSRFError) as exc:
            raise InvalidRosterAgentPackageError("Could not download the App import from URL") from exc
        source.seek(0)
        yield cast(BinaryIO, source)


def try_read_yaml(source: BinaryIO) -> str | None:
    """Recognize a YAML mapping without executing an import; always rewind for the package fallback."""
    try:
        raw = source.read(DSL_MAX_SIZE + 1)
        if len(raw) > DSL_MAX_SIZE:
            return None
        content = raw.decode("utf-8")
        return content if isinstance(yaml.safe_load(content), dict) else None
    except (UnicodeDecodeError, yaml.YAMLError):
        return None
    finally:
        source.seek(0)
