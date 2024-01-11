from core.tools.provider.builtin_tool import BuiltinTool
from core.tools.entities.tool_entities import ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from core.tools.provider.builtin.webscraper.tools.web_reader_tool import get_url
from core.tools.model.tool_model_manager import ToolModelManager
from core.tools.model.entities import ToolModelConfig

from core.model_runtime.entities.message_entities import PromptMessage, SystemPromptMessage, UserPromptMessage

from typing import Any, Dict, List, Union

import re

_SUMMARY_PROMPT = """You are a professional language researcher, you are interested in the language
and you can quickly aimed at the main point of an webpage and reproduce it in your own words but 
retain the original meaning and keep the key points. 
however, the text you got is too long, what you got is possible a part of the text.
Please summarize the text you got.
"""

_THRESHOLD = 1.33

class WebscraperTool(BuiltinTool):
    def _invoke(self,
               user_id: str,
               tool_paramters: Dict[str, Any], 
        ) -> Union[ToolInvokeMessage, List[ToolInvokeMessage]]:
        """
            invoke tools
        """
        try:
            url = tool_paramters.get('url', '')
            user_agent = tool_paramters.get('user_agent', '')
            if not url:
                return self.create_text_message('Please input url')
            
            # get webpage
            result = get_url(url, user_agent=user_agent)

            # summarize and return
            return self.create_text_message(self.summary(user_id=user_id, content=result))
        except Exception as e:
            raise ToolInvokeError(str(e))
        
    def summary(self, user_id: str, content: str) -> str:
        original_max_tokens = self.get_max_tokens()
        max_tokens = original_max_tokens * _THRESHOLD

        if self.get_prompt_tokens(prompt_messages=[
            UserPromptMessage(content=content)
        ]) < original_max_tokens * 0.7:
            return content
        
        def summarize(content: str) -> str:
            summary = self.invoke_model(user_id=user_id, prompt_messages=[
                SystemPromptMessage(content=_SUMMARY_PROMPT),
                UserPromptMessage(content=content)
            ], stop=[])

            return summary.message.content

        lines = content.split('\n')
        new_lines = []
        # split long line into multiple lines
        for i in range(len(lines)):
            line = lines[i]
            if len(line) > max_tokens:
                # split by length
                new_line = ''
                while len(line) > max_tokens:
                    new_line += line[:max_tokens] + '\n'
                    line = line[max_tokens:]
            else:
                new_lines.append(line)

        # merge lines into messages with max tokens
        messages: List[str] = []
        for i in new_lines:
            if len(messages) == 0:
                messages.append(i)
            else:
                if len(messages[-1]) + len(i) > max_tokens:
                    messages.append(i)
                else:
                    messages[-1] += i

        summaries = []
        for i in range(len(messages)):
            message = messages[i]
            summary = summarize(message)
            summaries.append(summary)

        result = '\n'.join(summaries)

        if self.get_prompt_tokens(prompt_messages=[
            UserPromptMessage(content=result)
        ]) > original_max_tokens * 0.7:
            return self.summary(user_id=user_id, content=result)
        
        return result

    def validate_credentials(self, credentails: Dict[str, Any], parameters: Dict[str, Any]) -> None:
        pass