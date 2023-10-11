import re
from typing import Any


class PromptTemplateParser:

    def __init__(self, template: str):
        self.template = template
        self.variable_keys = self.extract()

    def extract(self) -> list:
        # Regular expression to match the template rules
        regex = re.compile(r"\{\{([a-zA-Z0-9_]{1,16}|#histories#|#query#|#context#)\}\}")
        return re.findall(regex, self.template)

    def format(self, inputs: dict, remove_template_variables: bool = True) -> str:
        def replacer(match):
            key = match.group(1)
            value = inputs.get(key, match.group(0))  # return original matched string if key not found

            if remove_template_variables:
                return PromptTemplateParser.remove_template_variables(value)
            return value

        return re.sub(r"\{\{([a-zA-Z0-9_]{1,16}|#histories#|#query#|#context#)\}\}", replacer, self.template)

    @classmethod
    def remove_template_variables(cls, text: str):
        return re.sub(r"\{\{([a-zA-Z0-9_]{1,16}|#histories#|#query#|#context#)\}\}", r'{\1}', text)
