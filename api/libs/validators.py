def validate_description_length(description: str | None) -> str | None:
    """Validate description length."""
    if description and len(description) > 400:
        raise ValueError("Description cannot exceed 400 characters.")
    return description
