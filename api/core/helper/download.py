from core.helper import ssrf_proxy


def download_with_size_limit(url, max_download_size: int, **kwargs):
    response = ssrf_proxy.get(url, follow_redirects=True, **kwargs)
    if response.status_code == 404:
        raise ValueError("file not found")

    total_size = 0
    chunks = []
    for chunk in response.iter_bytes():
        total_size += len(chunk)
        if total_size > max_download_size:
            raise ValueError("Max file size reached")
        chunks.append(chunk)
    content = b"".join(chunks)
    return content
