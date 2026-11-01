import json
import re
from collections.abc import Generator
from typing import Any

from core.agent.entities import AgentScratchpadUnit
from graphon.model_runtime.entities.llm_entities import LLMResultChunk


class CotAgentOutputParser:
    @classmethod
    def handle_react_stream_output(
        cls, llm_response: Generator[LLMResultChunk], usage_dict: dict[str, Any]
    ) -> Generator[str | AgentScratchpadUnit.Action]:
        def _is_callable_action(action_name: Any, action_input: Any) -> bool:
            # AgentScratchpadUnit.Action requires a str name and a dict/str
            # input; anything else cannot be dispatched as a tool call.
            return (
                action_name is not None
                and isinstance(action_name, str)
                and action_input is not None
                and isinstance(action_input, dict | str)
            )

        def _split_action_fields(action: dict) -> tuple[Any, Any]:
            action_name = None
            action_input = None
            for key, value in action.items():
                if "input" in key.lower():
                    action_input = value
                elif action_name is None:
                    # The first non-input key names the action. Extra keys
                    # added after it (e.g. a trailing "reason") must not
                    # override the tool the agent is about to call.
                    action_name = value
            return action_name, action_input

        def parse_action(action) -> str | AgentScratchpadUnit.Action:
            if isinstance(action, str):
                try:
                    action = json.loads(action, strict=False)
                except json.JSONDecodeError:
                    return action or ""

            # cohere always returns a list
            if isinstance(action, list):
                # The prompt allows exactly one action per turn, so a list of
                # actions runs its first action-shaped item. A list without
                # one (a direct answer that happens to be JSON data, or
                # non-object items like [1]) is not an action and is kept as
                # text - iterating it raised AttributeError on .items().
                for item in action:
                    if not isinstance(item, dict):
                        continue
                    action_name, action_input = _split_action_fields(item)
                    if _is_callable_action(action_name, action_input):
                        return AgentScratchpadUnit.Action(
                            action_name=action_name,
                            action_input=action_input,
                        )
                return json.dumps(action, ensure_ascii=False)

            if not isinstance(action, dict):
                return json.dumps(action, ensure_ascii=False)

            action_name, action_input = _split_action_fields(action)
            if _is_callable_action(action_name, action_input):
                return AgentScratchpadUnit.Action(
                    action_name=action_name,
                    action_input=action_input,
                )
            else:
                # A non-string action name (e.g. {"action": ["search"]}) or a
                # non-dict/str action input is not callable; keep the payload
                # as text instead of raising a validation error from
                # AgentScratchpadUnit.Action.
                return json.dumps(action, ensure_ascii=False)

        def extra_json_from_code_block(code_block) -> list[list | dict]:
            blocks = re.findall(r"```[json]*\s*([\[{].*[]}])\s*```", code_block, re.DOTALL | re.IGNORECASE)
            if not blocks:
                return []
            try:
                json_blocks = []
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

        # Flush a trailing incomplete "action:"/"thought:" prefix so ordinary
        # text at the end of the stream is not silently dropped (issue #43350).
        if action_cache:
            yield action_cache

        if thought_cache:
            yield thought_cache
