from contextlib import contextmanager
from datetime import UTC, datetime
from urllib.parse import urlparse


@contextmanager
def measure_time():
    timing_info: dict[str, datetime | None] = {"start": datetime.now(UTC), "end": None}
    try:
        yield timing_info
    finally:
        timing_info["end"] = datetime.now(UTC)


def validate_url(url: str, default_url: str, allowed_schemes: tuple = ("https", "http")) -> str:
    """
    Validate and normalize URL with proper error handling.

    NOTE: This function does not retain the `path` component of the provided URL.
    In most cases, it is recommended to use `validate_url_with_path` instead.

    This function is deprecated and retained only for compatibility purposes.
    New implementations should use `validate_url_with_path`.

    Args:
        url: The URL to validate
        default_url: Default URL to use if input is None or empty
        allowed_schemes: Tuple of allowed URL schemes (default: https, http)

    Returns:
        Normalized URL string

    Raises:
        ValueError: If URL format is invalid or scheme not allowed
    """
    if not url or url.strip() == "":
        return default_url

    # Parse URL to validate format
    parsed = urlparse(url)

    # Check if scheme is allowed
    if parsed.scheme not in allowed_schemes:
        raise ValueError(f"URL scheme must be one of: {', '.join(allowed_schemes)}")

    # Reconstruct URL with only scheme, netloc (removing path, query, fragment)
    normalized_url = f"{parsed.scheme}://{parsed.netloc}"

    return normalized_url


def validate_url_with_path(
    url: str,
    default_url: str,
    required_suffix: str | None = None,
    *,
    allowed_schemes: tuple[str, ...] = ("https", "http"),
) -> str:
    """
    Validate URL that may include path components

    Args:
        url: The URL to validate
        default_url: Default URL to use if input is None or empty
        required_suffix: Optional suffix that URL must end with
        allowed_schemes: Tuple of allowed URL schemes (default: https, http)

    Returns:
        Validated URL string, returned verbatim so path, query and trailing
        separators survive — `required_suffix` consumers depend on that

    Raises:
        ValueError: If URL format is invalid or doesn't match required suffix
    """
    if not url or url.strip() == "":
        return default_url
    url = url.strip()

    # Parse URL to validate format
    parsed = urlparse(url)

    # Check if scheme is allowed
    if parsed.scheme not in allowed_schemes:
        expected = " or ".join(f"{scheme}://" for scheme in allowed_schemes)
        raise ValueError(f"URL must start with {expected}")

    # Check required suffix if specified
    if required_suffix and not url.endswith(required_suffix):
        raise ValueError(f"URL should end with {required_suffix}")

    return url


def validate_project_name(project: str, default_name: str) -> str:
    """
    Validate and normalize project name

    Args:
        project: Project name to validate
        default_name: Default name to use if input is None or empty

    Returns:
        Normalized project name
    """
    if not project or project.strip() == "":
        return default_name

    return project.strip()


def validate_integer_id(id_str: str) -> str:
    """
    Validate and normalize integer ID
    """
    id_str = id_str.strip()
    if not id_str.isdigit():
        raise ValueError("ID must be a valid integer")

    return id_str
