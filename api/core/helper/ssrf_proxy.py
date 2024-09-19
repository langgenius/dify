"""
Proxy requests to avoid SSRF
"""

import logging
import os
import time
import httpx

SSRF_PROXY_ALL_URL = os.getenv("SSRF_PROXY_ALL_URL", "")
SSRF_PROXY_HTTP_URL = os.getenv("SSRF_PROXY_HTTP_URL", "")
SSRF_PROXY_HTTPS_URL = os.getenv("SSRF_PROXY_HTTPS_URL", "")
SSRF_DEFAULT_MAX_RETRIES = int(os.getenv("SSRF_DEFAULT_MAX_RETRIES", "3"))

default_proxies = {}
if SSRF_PROXY_HTTP_URL:
    default_proxies["http://"] = SSRF_PROXY_HTTP_URL
if SSRF_PROXY_HTTPS_URL:
    default_proxies["https://"] = SSRF_PROXY_HTTPS_URL

if not default_proxies:
    default_proxies = None

BACKOFF_FACTOR = 0.5
STATUS_FORCELIST = [429, 500, 502, 503, 504]


def make_request(method, url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    if "allow_redirects" in kwargs:
        allow_redirects = kwargs.pop("allow_redirects")
        if "follow_redirects" not in kwargs:
            kwargs["follow_redirects"] = allow_redirects

    retries = 0
    proxies_attempted = [kwargs.get("proxies", default_proxies), SSRF_PROXY_ALL_URL, None]  # proxy list
    proxies_index = 0  # Try it from the first proxy

    while retries <= max_retries:
        try:
            proxy = proxies_attempted[proxies_index]
            if proxy:
                if isinstance(proxy, str):
                    response = httpx.request(method=method, url=url, proxy=proxy, **kwargs)
                else:
                    response = httpx.request(method=method, url=url, proxies=proxy, **kwargs)
            else:
                response = httpx.request(method=method, url=url, **kwargs)  # no proxy

            
            if response.status_code == 200:
                return response

            # If the status code is not 200 and not in STATUS_FORCELIST, switch the next agent
            logging.warning(f"Received status code {response.status_code} for URL {url}. Trying next proxy.")

        except httpx.RequestError as e:
            logging.warning(f"Request to URL {url} failed on attempt {retries + 1} with proxy: {proxy}. Error: {e}")

        retries += 1
        if retries <= max_retries:
            time.sleep(BACKOFF_FACTOR * (2 ** (retries - 1)))

        # next proxy
        proxies_index = (proxies_index + 1) % len(proxies_attempted)

    # Throws an exception if the maximum number of retries is reached
    raise Exception(f"Reached maximum retries ({max_retries}) for URL {url}")


# Implementation of various HTTP methods, using the generic make_request
def get(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("GET", url, max_retries=max_retries, **kwargs)

def post(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("POST", url, max_retries=max_retries, **kwargs)

def put(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("PUT", url, max_retries=max_retries, **kwargs)

def patch(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("PATCH", url, max_retries=max_retries, **kwargs)

def delete(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("DELETE", url, max_retries=max_retries, **kwargs)

def head(url, max_retries=SSRF_DEFAULT_MAX_RETRIES, **kwargs):
    return make_request("HEAD", url, max_retries=max_retries, **kwargs)
