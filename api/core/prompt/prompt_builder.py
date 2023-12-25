from core.prompt.prompt_template import PromptTemplateParser


class PromptBuilder:
    @classmethod
    def parse_prompt(cls, prompt: str, inputs: dict) -> str:
        prompt_template = PromptTemplateParser(prompt)
        prompt_inputs = {k: inputs[k] for k in prompt_template.variable_keys if k in inputs}
        prompt = prompt_template.format(prompt_inputs)
        return prompt
