MAX_APP_NAME_LENGTH = 255
MAX_APP_DESCRIPTION_LENGTH = 400
MAX_APP_ICON_LENGTH = 255


def validate_app_name(name: str) -> str:
    """Validate app name length and visible content."""
    if not name.strip():
        raise ValueError("App name is required.")
    if len(name) > MAX_APP_NAME_LENGTH:
        raise ValueError(f"App name cannot exceed {MAX_APP_NAME_LENGTH} characters.")
    return name


def validate_description_length(description: str | None) -> str | None:
    """Validate description length."""
    if description and len(description) > MAX_APP_DESCRIPTION_LENGTH:
        raise ValueError(f"Description cannot exceed {MAX_APP_DESCRIPTION_LENGTH} characters.")
    return description
