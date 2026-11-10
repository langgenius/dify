"""Finding text in a row's fields, for list ops whose source returns every row."""


def matches(text: str | None, *fields: str | None) -> bool:
    """Whether `text` is in any of `fields`, ignoring case; every row matches when there is no text."""
    if not text:
        return True
    needle = text.casefold()
    return any(needle in field.casefold() for field in fields if field)
