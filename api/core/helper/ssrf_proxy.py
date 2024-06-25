"""
Proxy requests to avoid SSRF
"""
import os

import httpx

SSRF_PROXY_ALL_URL = os.getenv('SSRF_PROXY_ALL_URL', '')
SSRF_PROXY_HTTP_URL = os.getenv('SSRF_PROXY_HTTP_URL', '')
SSRF_PROXY_HTTPS_URL = os.getenv('SSRF_PROXY_HTTPS_URL', '')

proxies = {
    'http://': SSRF_PROXY_HTTP_URL,
    'https://': SSRF_PROXY_HTTPS_URL
} if SSRF_PROXY_HTTP_URL and SSRF_PROXY_HTTPS_URL else None


def make_request(method, url, **kwargs):
    if SSRF_PROXY_ALL_URL:
        return httpx.request(method=method, url=url, proxy=SSRF_PROXY_ALL_URL, **kwargs)
    elif proxies:
        return httpx.request(method=method, url=url, proxies=proxies, **kwargs)
    else:
        return httpx.request(method=method, url=url, **kwargs)


def get(url, **kwargs):
    return make_request('GET', url, **kwargs)


def post(url, **kwargs):
    return make_request('POST', url, **kwargs)


def put(url, **kwargs):
    return make_request('PUT', url, **kwargs)


def patch(url, **kwargs):
    return make_request('PATCH', url, **kwargs)


def delete(url, **kwargs):
    return make_request('DELETE', url, **kwargs)


def head(url, **kwargs):
    return make_request('HEAD', url, **kwargs)
