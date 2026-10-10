import re


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


def _decode_escapes(value: str) -> str:
    """Decode escape sequences while preserving literal Unicode text.

    ``unicode_escape`` decodes the whole value as Latin-1, which corrupts
    literal UTF-8 characters (e.g. Chinese text, accented letters, emoji).
    Instead, only decode explicit escape tokens and leave non-ASCII text
    untouched.
    """
    decoded = re.sub(
        r"\\([nrt\\=:])",
        lambda m: {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", "=": "=", ":": ":"}[m.group(1)],
        value,
    )
    return re.sub(
        r"\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})",
        lambda m: chr(int(m.group(1) or m.group(2), 16)),
        decoded,
    )
