def normalize_api_base_url(base_url: str) -> str:
    """Normalize a base URL to always end with /v1, avoiding double /v1 suffixes."""
    return base_url.rstrip("/").removesuffix("/v1").rstrip("/") + "/v1"
