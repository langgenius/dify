from __future__ import annotations

import json


class OutputParserError(ValueError):
    """Raised when a markdown-wrapped JSON payload cannot be parsed or validated."""


_JSON_START_CHARS = frozenset(("{", "["))
_JSON_END_CHARS = frozenset(("}", "]"))


def parse_json_markdown(json_string: str) -> dict | list:
    """Extract and parse the first JSON object or array embedded in markdown text."""
    json_string = json_string.strip()
    starts = ["```json", "```", "``", "`", "{", "["]
    ends = ["```", "``", "`", "}", "]"]
    end_index = -1
    start_index = 0

    for start_marker in starts:
        start_index = json_string.find(start_marker)
        if start_index != -1:
            if json_string[start_index] not in _JSON_START_CHARS:
                start_index += len(start_marker)
            break

    if start_index != -1:
        for end_marker in ends:
            end_index = json_string.rfind(end_marker, start_index)
            if end_index != -1:
                if json_string[end_index] in _JSON_END_CHARS:
                    end_index += 1
                break

    if start_index == -1 or end_index == -1 or start_index >= end_index:
        msg = "could not find json block in the output."
        raise ValueError(msg)

    extracted_content = json_string[start_index:end_index].strip()
    return json.loads(extracted_content)


def parse_and_check_json_markdown(text: str, expected_keys: list[str]) -> dict:
    try:
        json_obj = parse_json_markdown(text)
    except json.JSONDecodeError as exc:
        msg = f"got invalid json object. error: {exc}"
        raise OutputParserError(msg) from exc

    if isinstance(json_obj, list):
        if len(json_obj) == 1 and isinstance(json_obj[0], dict):
            json_obj = json_obj[0]
        else:
            msg = f"got invalid return object. obj:{json_obj}"
            raise OutputParserError(msg)

    for key in expected_keys:
        if key not in json_obj:
            msg = (
                f"got invalid return object. expected key `{key}` to be present, "
                f"but got {json_obj}"
            )
            raise OutputParserError(msg)

    return json_obj
