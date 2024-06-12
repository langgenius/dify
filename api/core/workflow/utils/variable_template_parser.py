import re

from core.workflow.entities.variable_entities import VariableSelector

REGEX = re.compile(r"\{\{(#[a-zA-Z0-9_]{1,50}(\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10}#)\}\}")


class VariableTemplateParser:
    """
    Rules:

    1. Template variables must be enclosed in `{{}}`.
    2. The template variable Key can only be: #node_id.var1.var2#.
    3. The template variable Key cannot contain new lines or spaces, and must comply with rule 2.
    """

    def __init__(self, template: str):
        self.template = template
        self.variable_keys = self.extract()

    def extract(self) -> list:
        # Regular expression to match the template rules
        matches = re.findall(REGEX, self.template)

        first_group_matches = [match[0] for match in matches]

        return list(set(first_group_matches))

    def extract_variable_selectors(self) -> list[VariableSelector]:
        variable_selectors = []
        for variable_key in self.variable_keys:
            remove_hash = variable_key.replace('#', '')
            split_result = remove_hash.split('.')
            if len(split_result) < 2:
                continue

            variable_selectors.append(VariableSelector(
                variable=variable_key,
                value_selector=split_result
            ))

        return variable_selectors

    def format(self, inputs: dict, remove_template_variables: bool = True) -> str:
        def replacer(match):
            key = match.group(1)
            value = inputs.get(key, match.group(0))  # return original matched string if key not found
            # convert the value to string
            if isinstance(value, list | dict | bool | int | float):
                value = str(value)
                
            # remove template variables if required
            if remove_template_variables:
                return VariableTemplateParser.remove_template_variables(value)
            return value

        prompt = re.sub(REGEX, replacer, self.template)
        return re.sub(r'<\|.*?\|>', '', prompt)

    @classmethod
    def remove_template_variables(cls, text: str):
        return re.sub(REGEX, r'{\1}', text)
