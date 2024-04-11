import json
import re
from collections.abc import Generator
from typing import Union

from core.agent.entities import AgentScratchpadUnit
from core.model_runtime.entities.llm_entities import LLMResultChunk


class CotAgentOutputParser:
    @classmethod
    def handle_react_stream_output(cls, llm_response: Generator[LLMResultChunk, None, None]) -> \
        Generator[Union[str, AgentScratchpadUnit.Action], None, None]:
        def parse_action(json_str):
            try:
                action = json.loads(json_str)
                if 'action' in action and 'action_input' in action:
                    return AgentScratchpadUnit.Action(
                        action_name=action['action'],
                        action_input=action['action_input'],
                    )
            except:
                return json_str
            
        def extra_json_from_code_block(code_block) -> Generator[Union[dict, str], None, None]:
            code_blocks = re.findall(r'```(.*?)```', code_block, re.DOTALL)
            if not code_blocks:
                return
            for block in code_blocks:
                json_text = re.sub(r'^[a-zA-Z]+\n', '', block.strip(), flags=re.MULTILINE)
                yield parse_action(json_text)
            
        code_block_cache = ''
        code_block_delimiter_count = 0
        in_code_block = False
        json_cache = ''
        json_quote_count = 0
        in_json = False
        got_json = False

        for response in llm_response:
            response = response.delta.message.content
            if not isinstance(response, str):
                continue

            # stream
            index = 0
            while index < len(response):
                steps = 1
                delta = response[index:index+steps]
                if delta == '`':
                    code_block_cache += delta
                    code_block_delimiter_count += 1
                else:
                    if not in_code_block:
                        if code_block_delimiter_count > 0:
                            yield code_block_cache
                        code_block_cache = ''
                    else:
                        code_block_cache += delta
                    code_block_delimiter_count = 0

                if code_block_delimiter_count == 3:
                    if in_code_block:
                        yield from extra_json_from_code_block(code_block_cache)
                        code_block_cache = ''
                        
                    in_code_block = not in_code_block
                    code_block_delimiter_count = 0

                if not in_code_block:
                    # handle single json
                    if delta == '{':
                        json_quote_count += 1
                        in_json = True
                        json_cache += delta
                    elif delta == '}':
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
                            json_cache += delta

                    if got_json:
                        got_json = False
                        yield parse_action(json_cache)
                        json_cache = ''
                        json_quote_count = 0
                        in_json = False
                    
                if not in_code_block and not in_json:
                    yield delta.replace('`', '')

                index += steps

        if code_block_cache:
            yield code_block_cache

        if json_cache:
            yield parse_action(json_cache)

