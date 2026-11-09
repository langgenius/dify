from urllib.parse import urlsplit, urlunsplit


def normalize_api_base_url(base_url: str) -> str:
    """Normalize a base URL to always end with /v1, avoiding double /v1 suffixes."""
    return base_url.rstrip("/").removesuffix("/v1").rstrip("/") + "/v1"


def github_blob_to_raw_url(url: str) -> str:
    """Convert a GitHub file-view URL, preserving repository, file, query and fragment parts."""
    parsed = urlsplit(url)
    parts = parsed.path.split("/", 4)
    if (
        parsed.scheme != "https"
        or parsed.netloc != "github.com"
        or len(parts) != 5
        or not parts[1]
        or not parts[2]
        or parts[3] != "blob"
        or not parts[4]
    ):
        return url
    return urlunsplit(parsed._replace(netloc="raw.githubusercontent.com", path=f"/{parts[1]}/{parts[2]}/{parts[4]}"))
