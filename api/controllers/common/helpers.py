import urllib.parse


def decode_remote_url(url: str, query_string: bytes | str = b"") -> str:
    # A URL whose "://" separator is still percent-encoded was supplied as
    # one fully encoded path segment and needs a single decoding pass. A URL
    # that already contains "://" is decoded already: unquoting it again
    # corrupts legitimate %XX escapes in its query (%26, %3D, %23) and path.
    decoded_url = urllib.parse.unquote(url) if "://" not in url else url
    raw_query = query_string.decode() if isinstance(query_string, bytes) else query_string
    if not raw_query:
        return decoded_url

    try:
        has_query = bool(urllib.parse.urlsplit(decoded_url).query)
    except ValueError:
        has_query = False

    if decoded_url.endswith(("?", "&")):
        separator = ""
    elif has_query:
        separator = "&"
    else:
        separator = "?"
    return f"{decoded_url}{separator}{raw_query}"
