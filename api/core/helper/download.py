from typing import Any


def download_with_size_limit(url: str, max_download_size: int, **kwargs: Any) -> bytes:
    from core.file import remote_fetcher

    response = remote_fetcher.make_request("GET", url, follow_redirects=True, **kwargs)
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
