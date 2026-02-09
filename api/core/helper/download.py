from core.helper import ssrf_proxy


def download_with_size_limit(url, max_download_size: int, **kwargs):
    response = ssrf_proxy.get(url, follow_redirects=True, **kwargs)
    if response.status_code == 404:
        raise ValueError("文件未找到")

    total_size = 0
    chunks = []
    for chunk in response.iter_bytes():
        total_size += len(chunk)
        if total_size > max_download_size:
            raise ValueError("已达到最大文件大小")
        chunks.append(chunk)
    content = b"".join(chunks)
    return content
