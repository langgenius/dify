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
            decoded_value = bytes(raw_value, "utf-8").decode("unicode_escape")
            decoded_value = decoded_value.replace(r"\=", "=").replace(r"\:", ":")
        except UnicodeDecodeError:
            decoded_value = raw_value

        config[key] = decoded_value

    return config
