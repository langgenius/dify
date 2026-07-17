import json

from core.llm_generator.output_parser.errors import OutputParserError


def parse_json_markdown(json_string: str):
    # Get json from the backticks/braces
    json_string = json_string.strip()
    starts = ["```json", "```", "``", "`", "{", "["]
    fence_ends = {"```json": "```", "```": "```", "``": "``", "`": "`"}
    end_index = -1
    start_index = -1
    end_marker = ""
    parsed: dict = {}

    start_matches = [(json_string.find(s), s) for s in starts]
    start_matches = [(index, marker) for index, marker in start_matches if index != -1]
    if start_matches:
        start_index, start_marker = min(start_matches, key=lambda match: match[0])
        if start_marker in fence_ends:
            start_index += len(start_marker)
            end_marker = fence_ends[start_marker]
        else:
            end_marker = "}" if start_marker == "{" else "]"

    if start_index != -1 and end_marker:
        end_index = json_string.rfind(end_marker, start_index)
        if end_index != -1 and end_marker in ("}", "]"):
            end_index += len(end_marker)
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
