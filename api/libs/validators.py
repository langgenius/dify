def validate_description_length(description: str | None) -> str | None:
    """Validate description length."""
    if description and len(description) > 400:
        raise ValueError("描述不能超过 400 个字符。")
    return description
