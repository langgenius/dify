import json

from core.llm_generator.output_parser.errors import OutputParserError


def parse_json_markdown(json_string: str):
    # Get json from the backticks/braces
    json_string = json_string.strip()
    end_by_start = {
        "```json": "```",
        "```": "```",
        "``": "``",
        "`": "`",
        "{": "}",
        "[": "]",
    }
    end_index = -1
    start_index = 0
    parsed: dict = {}
    start_token = ""
    for s in ["```json", "```", "``", "`"]:
        start_index = json_string.find(s)
        if start_index != -1:
            start_token = s
            start_index += len(s)
            break
    if start_index == -1:
        raw_starts = [(index, token) for token in ("{", "[") if (index := json_string.find(token)) != -1]
        if raw_starts:
            start_index, start_token = min(raw_starts)
    if start_index != -1:
        end = end_by_start[start_token]
        end_index = json_string.rfind(end, start_index)
        if end_index != -1 and end in ("}", "]"):
            end_index += 1
    if start_index != -1 and end_index != -1 and start_index < end_index:
        extracted_content = json_string[start_index:end_index].strip()
        parsed = json.loads(extracted_content)
    else:
        raise ValueError("could not find json block in the output.")

    return parsed


def parse_and_check_json_markdown(text: str, expected_keys: list[str]):
    try:
        json_obj = parse_json_markdown(text)
    except json.JSONDecodeError as e:
        raise OutputParserError(f"got invalid json object. error: {e}")

    if isinstance(json_obj, list):
        if len(json_obj) == 1 and isinstance(json_obj[0], dict):
            json_obj = json_obj[0]
        else:
            raise OutputParserError(f"got invalid return object. obj:{json_obj}")
    for key in expected_keys:
        if key not in json_obj:
            raise OutputParserError(
                f"got invalid return object. expected key `{key}` to be present, but got {json_obj}"
            )
    return json_obj
