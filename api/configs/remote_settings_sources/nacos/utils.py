import re

_SIMPLE_ESCAPES = {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", "=": "=", ":": ":"}


def _decode_escapes(value: str) -> str:
    """Decode backslash escapes while preserving literal non-ASCII text.

    ``unicode_escape`` decodes the whole value as Latin-1, which corrupts literal
    UTF-8 characters such as Chinese text, accented letters and emoji. Only
    explicit escape tokens are decoded here; everything else is kept as written.

    Preconditions: ``value`` is the raw value that followed the key separator,
    already stripped of surrounding whitespace.

    Postconditions: each escape is decoded exactly once, so a doubled backslash
    yields a literal backslash and does not begin a new escape. Supported tokens
    are ``\\n``, ``\\r``, ``\\t``, ``\\\\``, ``\\=``, ``\\:``, ``\\uXXXX`` and ``\\xXX``.
    An unrecognised or malformed escape is preserved verbatim.

    Invariants: total (never raises); the result contains no character that was
    not already present in the input or produced by a decoded escape.
    """
    out: list[str] = []
    i = 0
    n = len(value)
    while i < n:
        ch = value[i]
        nxt = value[i + 1] if i + 1 < n else ""
        consumed = 1
        if ch == "\\" and nxt:
            if nxt in _SIMPLE_ESCAPES:
                out.append(_SIMPLE_ESCAPES[nxt])
                consumed = 2
            elif nxt == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", value[i + 2 : i + 6]):
                out.append(chr(int(value[i + 2 : i + 6], 16)))
                consumed = 6
            elif nxt == "x" and re.fullmatch(r"[0-9a-fA-F]{2}", value[i + 2 : i + 4]):
                out.append(chr(int(value[i + 2 : i + 4], 16)))
                consumed = 4
            else:
                out.append(ch)
        else:
            out.append(ch)
        i += consumed
    return "".join(out)


def parse_config(content: str) -> dict[str, str]:
    config: dict[str, str] = {}
    if not content:
        return config

    for line in content.splitlines():
        cleaned_line = line.strip()
        if not cleaned_line or cleaned_line.startswith(("#", "!")):
            continue

        separator_index = -1
        for i, c in enumerate(cleaned_line):
            if c in ("=", ":") and (i == 0 or cleaned_line[i - 1] != "\\"):
                separator_index = i
                break

        if separator_index == -1:
            continue

        key = cleaned_line[:separator_index].strip()
        raw_value = cleaned_line[separator_index + 1 :].strip()

        try:
            decoded_value = _decode_escapes(raw_value)
        except UnicodeDecodeError:
            decoded_value = raw_value

        config[key] = decoded_value

    return config
