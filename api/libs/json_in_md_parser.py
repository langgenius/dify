import json

from core.llm_generator.output_parser.errors import OutputParserError


def parse_json_markdown(json_string: str) -> dict:
    # Get json from the backticks/braces
    json_string = json_string.strip()
    starts = ["```json", "```", "``", "`", "{"]
    ends = ["```", "``", "`", "}"]
    end_index = -1
    start_index = 0
    for s in starts:
        start_index = json_string.find(s)
        if start_index != -1:
            if json_string[start_index] != "{":
                start_index += len(s)
            break
    if start_index != -1:
        for e in ends:
            end_index = json_string.rfind(e, start_index)
            if end_index != -1:
                if json_string[end_index] == "}":
                    end_index += 1
                break
    if start_index != -1 and end_index != -1 and start_index < end_index:
        extracted_content = json_string[start_index:end_index].strip()
        parsed = json.loads(extracted_content)
    else:
        raise Exception("Could not find JSON block in the output.")

    return parsed


def parse_and_check_json_markdown(text: str, expected_keys: list[str]) -> dict:
    try:
        json_obj = parse_json_markdown(text)
    except json.JSONDecodeError as e:
        raise OutputParserError(f"Got invalid JSON object. Error: {e}")
    for key in expected_keys:
        if key not in json_obj:
            raise OutputParserError(
                f"Got invalid return object. Expected key `{key}` to be present, but got {json_obj}"
            )
    return json_obj
