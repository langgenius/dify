"""One string out of a plugin's many-language text, for the account reading it."""

from collections.abc import Mapping
from typing import Final

_FALLBACK: Final = "en_US"


def localized(text: Mapping[str, str] | None, language: str | None) -> str | None:
    """The account's language, else `en_US`, else None. Plugin manifests always carry `en_US`;
    marketplace text may not, and then nothing is guessed."""
    if not text:
        return None
    keys = (language.replace("-", "_"), _FALLBACK) if language else (_FALLBACK,)
    for key in keys:
        value = text.get(key)
        if value:
            return value
    return None
