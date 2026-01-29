import json
import re
from collections.abc import Generator
from typing import Any, Union, cast

from core.agent.entities import AgentScratchpadUnit
from core.model_runtime.entities.llm_entities import LLMResultChunk


class CotAgentOutputParser:
    @classmethod
    def handle_react_stream_output(
        cls, llm_response: Generator[LLMResultChunk, None, None], usage_dict: dict[str, Any]
    ) -> Generator[Union[str, AgentScratchpadUnit.Action], None, None]:
        def parse_action(action: Any) -> Union[str, AgentScratchpadUnit.Action]:
            action_name: str | None = None
            action_input: Any | None = None
            parsed_action: Any = action
            if isinstance(parsed_action, str):
                try:
                    parsed_action = json.loads(parsed_action, strict=False)
                except json.JSONDecodeError:
                    return parsed_action or ""

            # cohere always returns a list
            if isinstance(parsed_action, list):
                action_list: list[Any] = cast(list[Any], parsed_action)
                if len(action_list) == 1:
                    parsed_action = action_list[0]

            if isinstance(parsed_action, dict):
                action_dict: dict[str, Any] = cast(dict[str, Any], parsed_action)
                for key, value in action_dict.items():
                    if "input" in key.lower():
                        action_input = value
                    elif isinstance(value, str):
                        action_name = value
            else:
                return json.dumps(parsed_action)

            if action_name is not None and action_input is not None:
                return AgentScratchpadUnit.Action(
                    action_name=action_name,
                    action_input=action_input,
                )
            return json.dumps(parsed_action)

        def extra_json_from_code_block(code_block: str) -> list[dict[str, Any] | list[Any]]:
            blocks = re.findall(r"```[json]*\s*([\[{].*[]}])\s*```", code_block, re.DOTALL | re.IGNORECASE)
            if not blocks:
                return []
            try:
                json_blocks: list[dict[str, Any] | list[Any]] = []
                for block in blocks:
                    json_text = re.sub(r"^[a-zA-Z]+\n", "", block.strip(), flags=re.MULTILINE)
                    json_blocks.append(json.loads(json_text, strict=False))
                return json_blocks
            except Exception:
                return []

        code_block_cache = ""
        code_block_delimiter_count = 0
        in_code_block = False
        json_cache = ""
        json_quote_count = 0
        in_json = False
        got_json = False

        action_cache = ""
        action_str = "action:"
        action_idx = 0

        thought_cache = ""
        thought_str = "thought:"
        thought_idx = 0

        last_character = ""

        for response in llm_response:
            if response.delta.usage:
                usage_dict["usage"] = response.delta.usage
            response_content = response.delta.message.content
            if not isinstance(response_content, str):
                continue

            # stream
            index = 0
            while index < len(response_content):
                steps = 1
                delta = response_content[index : index + steps]
                yield_delta = False

                if not in_json and delta == "`":
                    last_character = delta
                    code_block_cache += delta
                    code_block_delimiter_count += 1
                else:
                    if not in_code_block:
                        if code_block_delimiter_count > 0:
                            last_character = delta
                            yield code_block_cache
                        code_block_cache = ""
                    else:
                        last_character = delta
                        code_block_cache += delta
                    code_block_delimiter_count = 0

                if not in_code_block and not in_json:
                    if delta.lower() == action_str[action_idx] and action_idx == 0:
                        if last_character not in {"\n", " ", ""}:
                            yield_delta = True
                        else:
                            last_character = delta
                            action_cache += delta
                            action_idx += 1
                            if action_idx == len(action_str):
                                action_cache = ""
                                action_idx = 0
                            index += steps
                            continue
                    elif delta.lower() == action_str[action_idx] and action_idx > 0:
                        last_character = delta
                        action_cache += delta
                        action_idx += 1
                        if action_idx == len(action_str):
                            action_cache = ""
                            action_idx = 0
                        index += steps
                        continue
                    else:
                        if action_cache:
                            last_character = delta
                            yield action_cache
                            action_cache = ""
                            action_idx = 0

                    if delta.lower() == thought_str[thought_idx] and thought_idx == 0:
                        if last_character not in {"\n", " ", ""}:
                            yield_delta = True
                        else:
                            last_character = delta
                            thought_cache += delta
                            thought_idx += 1
                            if thought_idx == len(thought_str):
                                thought_cache = ""
                                thought_idx = 0
                            index += steps
                            continue
                    elif delta.lower() == thought_str[thought_idx] and thought_idx > 0:
                        last_character = delta
                        thought_cache += delta
                        thought_idx += 1
                        if thought_idx == len(thought_str):
                            thought_cache = ""
                            thought_idx = 0
                        index += steps
                        continue
                    else:
                        if thought_cache:
                            last_character = delta
                            yield thought_cache
                            thought_cache = ""
                            thought_idx = 0

                    if yield_delta:
                        index += steps
                        last_character = delta
                        yield delta
                        continue

                if code_block_delimiter_count == 3:
                    if in_code_block:
                        last_character = delta
                        action_json_list = extra_json_from_code_block(code_block_cache)
                        if action_json_list:
                            for action_json in action_json_list:
                                yield parse_action(action_json)
                            code_block_cache = ""
                        else:
                            index += steps
                            continue

                    in_code_block = not in_code_block
                    code_block_delimiter_count = 0

                if not in_code_block:
                    # handle single json
                    if delta == "{":
                        json_quote_count += 1
                        in_json = True
                        last_character = delta
                        json_cache += delta
                    elif delta == "}":
                        last_character = delta
                        json_cache += delta
                        if json_quote_count > 0:
                            json_quote_count -= 1
                            if json_quote_count == 0:
                                in_json = False
                                got_json = True
                                index += steps
                                continue
                    else:
                        if in_json:
                            last_character = delta
                            json_cache += delta

                    if got_json:
                        got_json = False
                        last_character = delta
                        yield parse_action(json_cache)
                        json_cache = ""
                        json_quote_count = 0
                        in_json = False

                if not in_code_block and not in_json:
                    last_character = delta
                    yield delta.replace("`", "")

                index += steps

        if code_block_cache:
            yield code_block_cache

        if json_cache:
            yield parse_action(json_cache)
