import json

from core.llm_generator.output_parser.errors import OutputParserError


def parse_json_markdown(json_string: str):
    # Get json from the backticks/braces
    json_string = json_string.strip()
    end_index = -1
    start_index = 0
    parsed: dict = {}

    # Try markdown fences first (explicit delimiters)
    for s in ["```json", "```", "``", "`"]:
        idx = json_string.find(s)
        if idx != -1:
            start_index = idx + len(s)
            break

    # If no fence found, find the earliest opening bracket
    if start_index == 0:
        bracket_candidates = [(json_string.find("["), "["), (json_string.find("{"), "{")]
        bracket_candidates = [(i, c) for i, c in bracket_candidates if i != -1]
        if bracket_candidates:
            start_index = min(bracket_candidates)[0]

    if start_index != -1:
        # Try markdown fences first
        for e in ["```", "``", "`"]:
            end_index = json_string.rfind(e, start_index)
            if end_index != -1:
                if json_string[end_index] in ("}", "]"):
                    end_index += 1
                break

        # If no fence found, find the latest closing bracket
        if end_index == -1:
            bracket_ends = [json_string.rfind(e, start_index) for e in ("]", "}")]
            bracket_ends = [i for i in bracket_ends if i != -1]
            if bracket_ends:
                end_index = max(bracket_ends) + 1

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
