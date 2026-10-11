import urllib.parse


def decode_remote_url(url: str, query_string: bytes | str = b"") -> str:
    decoded_url = urllib.parse.unquote(url)
    if isinstance(query_string, bytes):
        raw_query = query_string.decode()
    else:
        raw_query = query_string
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
