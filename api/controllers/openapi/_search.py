"""Plain-words filtering for list ops whose source returns everything."""


def matches(words: str, *texts: str | None) -> bool:
    if not words:
        return True
    needle = words.casefold()
    return any(needle in text.casefold() for text in texts if text)
