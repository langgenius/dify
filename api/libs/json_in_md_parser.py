import json

from core.llm_generator.output_parser.errors import OutputParserException


def parse_json_markdown(json_string: str) -> dict:
    # Remove the triple backticks if present
    json_string = json_string.strip()
    start_index = json_string.find("```json")
    end_index = json_string.find("```", start_index + len("```json"))

    if start_index != -1 and end_index != -1:
        extracted_content = json_string[start_index + len("```json") : end_index].strip()

        # Parse the JSON string into a Python dictionary
        parsed = json.loads(extracted_content)
    elif start_index != -1 and end_index == -1 and json_string.endswith("``"):
        end_index = json_string.find("``", start_index + len("```json"))
        extracted_content = json_string[start_index + len("```json") : end_index].strip()

        # Parse the JSON string into a Python dictionary
        parsed = json.loads(extracted_content)
    elif json_string.startswith("{"):
        # Parse the JSON string into a Python dictionary
        parsed = json.loads(json_string)
    else:
        raise Exception("Could not find JSON block in the output.")

    return parsed


def parse_and_check_json_markdown(text: str, expected_keys: list[str]) -> dict:
    try:
        json_obj = parse_json_markdown(text)
    except json.JSONDecodeError as e:
        raise OutputParserException(f"Got invalid JSON object. Error: {e}")
    for key in expected_keys:
        if key not in json_obj:
            raise OutputParserException(
                f"Got invalid return object. Expected key `{key}` " f"to be present, but got {json_obj}"
            )
    return json_obj
