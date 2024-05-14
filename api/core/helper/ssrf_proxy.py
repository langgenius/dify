"""
Proxy requests to avoid SSRF
"""

import os

from httpx import get as _get
from httpx import head as _head
from httpx import options as _options
from httpx import patch as _patch
from httpx import post as _post
from httpx import put as _put
from requests import delete as _delete

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
    if 'follow_redirects' in kwargs:
        if kwargs['follow_redirects']:
            kwargs['allow_redirects'] = kwargs['follow_redirects']
        kwargs.pop('follow_redirects')
    if 'timeout' in kwargs:
        timeout = kwargs['timeout']
        if timeout is None:
            kwargs.pop('timeout')
        elif isinstance(timeout, tuple):
            # check length of tuple
            if len(timeout) == 2:
                kwargs['timeout'] = timeout
            elif len(timeout) == 1:
                kwargs['timeout'] = timeout[0]
            elif len(timeout) > 2:
                kwargs['timeout'] = (timeout[0], timeout[1])
        else:
            kwargs['timeout'] = (timeout, timeout)
    return _delete(url=url, *args, proxies=requests_proxies, **kwargs)

def head(url, *args, **kwargs):
    return _head(url=url, *args, proxies=httpx_proxies, **kwargs)

def options(url, *args, **kwargs):
    return _options(url=url, *args, proxies=httpx_proxies, **kwargs)
