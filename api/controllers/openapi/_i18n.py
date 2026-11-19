"""One string out of a plugin's many-language text, for the account reading it."""

from collections.abc import Mapping
from typing import Final

from pydantic import BaseModel

_FALLBACK: Final = "en_US"


def localized(text: BaseModel | Mapping[str, str] | None, language: str | None) -> str | None:
    """The account's language, else `en_US`, else None. Takes an I18nObject (of any of the
    runtimes) or its dumped mapping. Plugin manifests always carry `en_US`; marketplace text
    may not, and then nothing is guessed."""
    if text is None:
        return None
    values = text.model_dump() if isinstance(text, BaseModel) else text
    keys = (language.replace("-", "_"), _FALLBACK) if language else (_FALLBACK,)
    for key in keys:
        value = values.get(key)
        if value:
            return value
    return None
