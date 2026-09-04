"""Account email normalization rules."""


def normalize_email(email: str) -> str:
    """Normalize an account email for identity comparisons."""
    normalized_email = email.lower()
    local_part, separator, domain = normalized_email.rpartition("@")
    if separator and domain in {"gmail.com", "googlemail.com"}:
        local_part = local_part.split("+", 1)[0].replace(".", "")
        return f"{local_part}@gmail.com"
    return normalized_email
