from contextlib import contextmanager
from datetime import datetime
from typing import Union
from urllib.parse import urlparse

from sqlalchemy import select

from extensions.ext_database import db
from models.model import Message


def filter_none_values(data: dict):
    new_data = {}
    for key, value in data.items():
        if value is None:
            continue
        if isinstance(value, datetime):
            new_data[key] = value.isoformat()
        else:
            new_data[key] = value
    return new_data


def get_message_data(message_id: str):
    return db.session.scalar(select(Message).where(Message.id == message_id))


@contextmanager
def measure_time():
    timing_info = {"start": datetime.now(), "end": None}
    try:
        yield timing_info
    finally:
        timing_info["end"] = datetime.now()


def replace_text_with_content(data):
    if isinstance(data, dict):
        new_data = {}
        for key, value in data.items():
            if key == "text":
                new_data["content"] = value
            else:
                new_data[key] = replace_text_with_content(value)
        return new_data
    elif isinstance(data, list):
        return [replace_text_with_content(item) for item in data]
    else:
        return data


def generate_dotted_order(run_id: str, start_time: Union[str, datetime], parent_dotted_order: str | None = None) -> str:
    """
    generate dotted_order for langsmith
    """
    start_time = datetime.fromisoformat(start_time) if isinstance(start_time, str) else start_time
    timestamp = start_time.strftime("%Y%m%dT%H%M%S%f") + "Z"
    current_segment = f"{timestamp}{run_id}"

    if parent_dotted_order is None:
        return current_segment

    return f"{parent_dotted_order}.{current_segment}"


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


def validate_url_with_path(url: str, default_url: str, required_suffix: str | None = None) -> str:
    """
    Validate URL that may include path components

    Args:
        url: The URL to validate
        default_url: Default URL to use if input is None or empty
        required_suffix: Optional suffix that URL must end with

    Returns:
        Validated URL string

    Raises:
        ValueError: If URL format is invalid or doesn't match required suffix
    """
    if not url or url.strip() == "":
        return default_url

    # Parse URL to validate format
    parsed = urlparse(url)

    # Check if scheme is allowed
    if parsed.scheme not in ("https", "http"):
        raise ValueError("URL must start with https:// or http://")

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
