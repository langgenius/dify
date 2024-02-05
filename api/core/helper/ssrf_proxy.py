"""
Proxy requests to avoid SSRF
"""

from httpx import get as _get, post as _post, put as _put, patch as _patch, head as _head, options as _options
from requests import delete as _delete

import os

SSRF_PROXY_HTTP_URL = os.getenv('SSRF_PROXY_HTTP_URL', '')
SSRF_PROXY_HTTPS_URL = os.getenv('SSRF_PROXY_HTTPS_URL', '')

requests_proxies = {
    'http': SSRF_PROXY_HTTP_URL,
    'https': SSRF_PROXY_HTTPS_URL
} if SSRF_PROXY_HTTP_URL and SSRF_PROXY_HTTPS_URL else None

httpx_proxies = {
    'http://': SSRF_PROXY_HTTP_URL,
    'https://': SSRF_PROXY_HTTPS_URL
} if SSRF_PROXY_HTTP_URL and SSRF_PROXY_HTTPS_URL else None

def get(url, *args, **kwargs):
    return _get(url=url, *args, proxies=httpx_proxies, **kwargs)

def post(url, *args, **kwargs):
    return _post(url=url, *args, proxies=httpx_proxies, **kwargs)

def put(url, *args, **kwargs):
    return _put(url=url, *args, proxies=httpx_proxies, **kwargs)

def patch(url, *args, **kwargs):
    return _patch(url=url, *args, proxies=httpx_proxies, **kwargs)

def delete(url, *args, **kwargs):
    return _delete(url=url, *args, proxies=requests_proxies, **kwargs)

def head(url, *args, **kwargs):
    return _head(url=url, *args, proxies=httpx_proxies, **kwargs)

def options(url, *args, **kwargs):
    return _options(url=url, *args, proxies=httpx_proxies, **kwargs)
