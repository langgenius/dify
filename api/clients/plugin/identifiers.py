"""Validate immutable plugin artifact references before direct dispatch."""

import re

_ARTIFACT = re.compile(
    r"^(?P<plugin>(?:[a-z0-9_-]{1,64}/)?[a-z0-9_-]{1,255}):"
    r"[0-9]{1,4}(?:\.[0-9]{1,4}){1,3}(?:-\w{1,16})?@[a-f0-9]{32,64}$",
    re.ASCII,
)


def plugin_id_from_unique_identifier(identifier: str) -> str:
    match = _ARTIFACT.fullmatch(identifier)
    if match is None:
        raise ValueError("A complete plugin artifact identifier is required.")
    return match.group("plugin")
