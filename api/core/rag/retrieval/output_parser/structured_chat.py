import json
import re
from typing import Union

from core.rag.retrieval.output_parser.react_output import ReactAction, ReactFinish


class StructuredChatOutputParser:
    def parse(self, text: str) -> Union[ReactAction, ReactFinish]:
        try:
            action_match = re.search(r"```(\w*)\n?({.*?)```", text, re.DOTALL)
            if action_match is not None:
                response = json.loads(action_match.group(2).strip(), strict=False)
                if isinstance(response, list):
                    response = response[0]
                if response["action"] == "Final Answer":
                    return ReactFinish({"output": response["action_input"]}, text)
                else:
                    return ReactAction(response["action"], response.get("action_input", {}), text)
            else:
                return ReactFinish({"output": text}, text)
        except Exception as e:
            raise ValueError(f"Could not parse LLM output: {text}")
