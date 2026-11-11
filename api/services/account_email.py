"""Account email normalization rules."""

# Microsoft documents +site delivery to the original inbox, not dot removal
# or automatic equivalence between domains:
# https://support.microsoft.com/en-us/outlook/send-email-from-a-different-address-in-outlook-com
# Consumer mailbox domains:
# https://support.microsoft.com/en-us/outlook/premium-features-in-outlook-com-for-microsoft-365-subscribers
_MICROSOFT_DOMAINS = frozenset({"outlook.com", "hotmail.com", "live.com", "msn.com"})
# Apple documents matching legacy domains for eligible migrated accounts:
# https://support.apple.com/en-us/118230
# +tag delivery was manually verified by linw1995 on 2026-09-10;
# the official source above covers legacy domains, not +tag delivery.
_APPLE_DOMAINS = frozenset({"icloud.com", "me.com", "mac.com"})
# Proton documents automatic +aliases and its four consumer domains:
# https://proton.me/support/addresses-and-aliases
_PROTON_DOMAINS = frozenset({"protonmail.com", "proton.me", "pm.me", "protonmail.ch"})


def normalize_email(email: str) -> str:
    """Normalize a validated account email for new-account collision checks.

    Provider rules apply only to explicitly listed consumer domains. Yahoo's
    configured disposable addresses cannot be resolved to their owner from the
    address alone, so they retain the default lowercase-only normalization.
    Yahoo documents a separately chosen nickname and keyword:
    https://en-global.help.yahoo.com/kb/SLN36718.html
    """
    normalized_email = email.lower()
    local_part, separator, domain = normalized_email.rpartition("@")
    if separator and domain in {"gmail.com", "googlemail.com"}:
        # Dot equivalence applies to consumer Gmail, not Workspace domains:
        # https://support.google.com/mail/answer/7436150?hl=en
        # Google documents +tag variants and continued delivery to googlemail:
        # https://blog.google/products-and-platforms/products/gmail/gmail-inbox-organizing-tips/
        # https://blog.google/intl/de-de/produkte/smartes-arbeiten/willkommen-bei-gmail-deutschland/
        local_part = local_part.split("+", 1)[0].replace(".", "")
        return f"{local_part}@gmail.com"
    if separator and domain in _MICROSOFT_DOMAINS | _APPLE_DOMAINS | _PROTON_DOMAINS:
        local_part = local_part.split("+", 1)[0]
        if domain in _APPLE_DOMAINS:
            domain = "icloud.com"
        elif domain in _PROTON_DOMAINS:
            # Proton treats these characters as transparent within a username:
            # https://proton.me/support/change-username
            local_part = local_part.replace(".", "").replace("_", "").replace("-", "")
        return f"{local_part}@{domain}"
    return normalized_email
