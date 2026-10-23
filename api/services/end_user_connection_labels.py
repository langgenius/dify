"""Display policy for provider-supplied OAuth account identities."""

from libs.helper import email


def mask_account_label(label: str | None) -> str | None:
    """Mask an explicitly selected account identity before persistence.

    None or an empty string means the provider supplied no account identity.
    Only a valid bare email retains its domain; other identities are masked in
    full. Callers select an allowlisted metadata field, never credentials or an
    arbitrary metadata payload. This policy does not apply to editable names.
    """
    if not label:
        return None

    try:
        email(label)
    except ValueError:
        identity, suffix = label, ""
    else:
        identity, domain = label.rsplit("@", 1)
        suffix = f"@{domain}"

    visible = 2 if len(identity) >= 3 else max(len(identity) - 1, 0)
    return f"{identity[:visible]}{'*' * (len(identity) - visible)}{suffix}"
