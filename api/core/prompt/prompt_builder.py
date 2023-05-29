import re

from langchain.prompts import SystemMessagePromptTemplate, HumanMessagePromptTemplate, AIMessagePromptTemplate
from langchain.schema import BaseMessage

from core.prompt.prompt_template import OutLinePromptTemplate


class PromptBuilder:
    @classmethod
    def to_system_message(cls, prompt_content: str, inputs: dict) -> BaseMessage:
        prompt_template = OutLinePromptTemplate.from_template(prompt_content)
        system_prompt_template = SystemMessagePromptTemplate(prompt=prompt_template)
        prompt_inputs = {k: inputs[k] for k in system_prompt_template.input_variables if k in inputs}
        system_message = system_prompt_template.format(**prompt_inputs)
        return system_message

    @classmethod
    def to_ai_message(cls, prompt_content: str, inputs: dict) -> BaseMessage:
        prompt_template = OutLinePromptTemplate.from_template(prompt_content)
        ai_prompt_template = AIMessagePromptTemplate(prompt=prompt_template)
        prompt_inputs = {k: inputs[k] for k in ai_prompt_template.input_variables if k in inputs}
        ai_message = ai_prompt_template.format(**prompt_inputs)
        return ai_message

    @classmethod
    def to_human_message(cls, prompt_content: str, inputs: dict) -> BaseMessage:
        prompt_template = OutLinePromptTemplate.from_template(prompt_content)
        human_prompt_template = HumanMessagePromptTemplate(prompt=prompt_template)
        human_message = human_prompt_template.format(**inputs)
        return human_message

    @classmethod
    def process_template(cls, template: str):
        processed_template = re.sub(r'\{([a-zA-Z_]\w+?)\}', r'\1', template)
        processed_template = re.sub(r'\{\{([a-zA-Z_]\w+?)\}\}', r'{\1}', processed_template)
        return processed_template
