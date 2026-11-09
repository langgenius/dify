from typing import Any


def download_with_size_limit(url: str, max_download_size: int, **kwargs: Any) -> bytes:
    from core.file import remote_fetcher
    from core.helper.ssrf_proxy import MaxRetriesExceededError

    try:
        response = remote_fetcher.make_request("GET", url, follow_redirects=True, **kwargs)
    except MaxRetriesExceededError as e:
        if e.status_code is None:
            # No response was ever received: keep the transport error as is
            # instead of inventing a status code.
            raise
        # Retries ran out on an explicit error response. Report it through the
        # same message as the non-retried path so the controller mapping shows
        # the upstream status.
        raise ValueError(f"Failed to download file: HTTP {e.status_code}") from e
    if response.status_code == 404:
        raise ValueError("file not found")
    if response.status_code >= 400:
        # The body of a 4xx/5xx response is an error page, not the requested
        # file. Returning it would hand callers an error document as content.
        raise ValueError(f"Failed to download file: HTTP {response.status_code}")

    total_size = 0
    chunks = []
    for chunk in response.iter_bytes():
        total_size += len(chunk)
        if total_size > max_download_size:
            raise ValueError("Max file size reached")
        chunks.append(chunk)
    content = b"".join(chunks)
    return content
