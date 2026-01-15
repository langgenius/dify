import json
import re
from collections.abc import Generator
from typing import Union

from pydantic_core import from_json

from core.agent.entities import AgentScratchpadUnit
from core.model_runtime.entities.llm_entities import LLMResultChunk


class CotAgentOutputParser:
    @classmethod
    def handle_react_stream_output(
        cls, llm_response: Generator[LLMResultChunk, None, None], usage_dict: dict
    ) -> Generator[Union[str, AgentScratchpadUnit.Action], None, None]:
        def parse_action(action) -> Union[str, AgentScratchpadUnit.Action]:
            action_name = None
            action_input = None
            if isinstance(action, str):
                try:
                    action = json.loads(action, strict=False)
                except json.JSONDecodeError:
                    return action or ""

            # cohere always returns a list
            if isinstance(action, list) and len(action) == 1:
                action = action[0]

            for key, value in action.items():
                if "input" in key.lower():
                    action_input = value
                else:
                    action_name = value

            if action_name is not None and action_input is not None:
                return AgentScratchpadUnit.Action(
                    action_name=action_name,
                    action_input=action_input,
                )
            else:
                return json.dumps(action)

        def extra_json_from_code_block(code_block) -> list[Union[list, dict]]:
            blocks = re.findall(r"```[json]*\s*([\[{].*[]}])\s*```", code_block, re.DOTALL | re.IGNORECASE)
            if not blocks:
                return []
            try:
                json_blocks = []
                for block in blocks:
                    json_text = re.sub(r"^[a-zA-Z]+\n", "", block.strip(), flags=re.MULTILINE)
                    json_blocks.append(json.loads(json_text, strict=False))
                return json_blocks
            except:
                return []

        def _maybe_mark_final_action(action_json: str) -> bool:
            """
            Best-effort detection of whether the current (possibly partial) JSON indicates
            a `Final Answer` action.

            We intentionally use Pydantic's partial JSON parsing (jiter) so we can identify
            the `action` field early even when `action_input` hasn't finished streaming.
            Ref: https://docs.pydantic.dev/latest/concepts/json/#partial-json-parsing
            """
            try:
                data = from_json(action_json, allow_partial=True)
            except ValueError:
                # Fallback for non-strict JSON (e.g. literal newlines inside strings) where
                # the model output is still parseable later via `json.loads(..., strict=False)`.
                return bool(
                    re.search(
                        r'"action"\s*:\s*"final answer"',
                        action_json,
                        flags=re.IGNORECASE,
                    )
                )

            if isinstance(data, dict):
                for k, v in data.items():
                    if isinstance(k, str) and k.lower() in {"action", "tool", "name"} and isinstance(v, str):
                        return v.strip().lower() == "final answer"
            return False

        def _stream_action_input_incrementally(
            *,
            action_json: str,
            prev_cursor: int,
            pending_raw: str,
        ) -> tuple[str, int, str]:
            """
            Stream the `action_input` JSON string value as it is being produced.

            Returns:
              - text to emit (decoded as a JSON string, best-effort)
              - new cursor position
              - pending raw buffer (for partial escape sequences at chunk boundary)
            """
            # Find `"action_input": "` prefix first.
            m = re.search(r'"action_input"\s*:\s*"', action_json, flags=re.IGNORECASE)
            if not m:
                return "", prev_cursor, pending_raw

            start = m.end()
            # Ensure cursor starts from the value start.
            cursor = max(prev_cursor, start)

            def _decode_safe_json_string_prefix(raw: str) -> tuple[str, str]:
                """
                Decode the longest *safe* prefix of a JSON string body.

                Instead of manually decoding escapes, we delegate to `json.loads(..., strict=False)`,
                but only for a prefix that doesn't end in the middle of an escape sequence.
                """
                if not raw:
                    return "", raw

                i = 0
                while i < len(raw):
                    if raw[i] != "\\":
                        i += 1
                        continue
                    # Need at least one more character for any escape
                    if i + 1 >= len(raw):
                        break
                    if raw[i + 1] == "u":
                        # Need \uXXXX (6 chars total: \ u 0 0 0 0)
                        if i + 6 > len(raw):
                            break
                        i += 6
                        continue
                    i += 2

                safe_end = i
                prefix = raw[:safe_end]
                remainder = raw[safe_end:]
                if not prefix:
                    return "", remainder

                try:
                    decoded = json.loads(f'"{prefix}"', strict=False)
                    return decoded, remainder
                except Exception:
                    # If model output is malformed JSON, pass through raw prefix.
                    return prefix, remainder

            i = cursor
            # Find the first unescaped closing quote for the JSON string value.
            while i < len(action_json):
                if action_json[i] == '"':
                    backslashes = 0
                    j = i - 1
                    while j >= cursor and action_json[j] == "\\":
                        backslashes += 1
                        j -= 1
                    if backslashes % 2 == 0:
                        break
                i += 1

            raw_delta = action_json[cursor:i]
            cursor = i

            pending_raw += raw_delta
            decoded, pending_raw = _decode_safe_json_string_prefix(pending_raw)
            return decoded, cursor, pending_raw

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

        # Streaming state for Final Answer in ReAct JSON
        final_action_detected = False
        streamed_cursor = 0
        pending_raw = ""
        code_block_action_detected = False
        code_streamed_cursor = 0
        code_pending_raw = ""

        # Track JSON text inside ```json ...``` code blocks incrementally (partial)
        code_json_cache = ""
        code_in_json = False

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

                # If we are inside a code block, try to parse the JSON object incrementally
                # and stream Final Answer's action_input as it is produced.
                if in_code_block:
                    # Start capturing JSON text once we see an object/array start.
                    if not code_in_json and delta in {"{", "["}:
                        code_in_json = True
                        code_json_cache = delta
                    elif code_in_json:
                        code_json_cache += delta

                    # While JSON is streaming in the code block, detect Final Answer early
                    # and stream `action_input` incrementally.
                    if code_in_json and code_json_cache:
                        if not code_block_action_detected:
                            code_block_action_detected = _maybe_mark_final_action(code_json_cache)
                            if code_block_action_detected:
                                usage_dict["final_answer_streamed"] = True

                        if code_block_action_detected:
                            emitted, code_streamed_cursor, code_pending_raw = _stream_action_input_incrementally(
                                action_json=code_json_cache,
                                prev_cursor=code_streamed_cursor,
                                pending_raw=code_pending_raw,
                            )
                            if emitted:
                                yield emitted

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
                    if in_code_block:
                        # entering a new code block: reset per-block JSON streaming state
                        code_block_action_detected = False
                        code_streamed_cursor = 0
                        code_pending_raw = ""
                        code_json_cache = ""
                        code_in_json = False
                    else:
                        # leaving a code block: clear any leftover state
                        code_block_action_detected = False
                        code_streamed_cursor = 0
                        code_pending_raw = ""
                        code_json_cache = ""
                        code_in_json = False
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

                    # While the JSON is still streaming, try to detect Final Answer early
                    # and stream `action_input` as it is produced.
                    if in_json and json_cache:
                        if not final_action_detected:
                            final_action_detected = _maybe_mark_final_action(json_cache)
                            if final_action_detected:
                                usage_dict["final_answer_streamed"] = True

                        if final_action_detected:
                            emitted, streamed_cursor, pending_raw = _stream_action_input_incrementally(
                                action_json=json_cache,
                                prev_cursor=streamed_cursor,
                                pending_raw=pending_raw,
                            )
                            if emitted:
                                # Emit the final answer text as plain stream output.
                                # This allows the agent UI to render it token-by-token.
                                yield emitted

                    if got_json:
                        got_json = False
                        last_character = delta
                        yield parse_action(json_cache)
                        json_cache = ""
                        json_quote_count = 0
                        in_json = False
                        final_action_detected = False
                        streamed_cursor = 0
                        pending_raw = ""

                if not in_code_block and not in_json:
                    last_character = delta
                    yield delta.replace("`", "")

                index += steps

        if code_block_cache:
            yield code_block_cache

        if json_cache:
            yield parse_action(json_cache)
