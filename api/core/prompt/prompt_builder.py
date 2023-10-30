from langchain.schema import BaseMessage, SystemMessage, AIMessage, HumanMessage

from core.prompt.prompt_template import PromptTemplateParser


class PromptBuilder:
    @classmethod
    def parse_prompt(cls, prompt: str, inputs: dict) -> str:
        prompt_template = PromptTemplateParser(prompt)
        prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}
        prompt = prompt_template.format(prompt_inputs)
        return prompt

    @classmethod
    def to_system_message(cls, prompt_content: str, inputs: dict) -> BaseMessage:
        return SystemMessage(content=cls.parse_prompt(prompt_content, inputs))

    @classmethod
    def to_ai_message(cls, prompt_content: str, inputs: dict) -> BaseMessage:
        return AIMessage(content=cls.parse_prompt(prompt_content, inputs))

    @classmethod
    def to_human_message(cls, prompt_content: str, inputs: dict) -> BaseMessage:
        return HumanMessage(content=cls.parse_prompt(prompt_content, inputs))
