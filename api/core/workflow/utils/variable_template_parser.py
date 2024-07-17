import re
from collections.abc import Mapping
from typing import Any

from core.workflow.entities.variable_entities import VariableSelector

REGEX = re.compile(r"\{\{(#[a-zA-Z0-9_]{1,50}(\.[a-zA-Z_][a-zA-Z0-9_]{0,29}){1,10}#)\}\}")


class VariableTemplateParser:
    """
    A class for parsing and manipulating template variables in a string.

    Rules:

    1. Template variables must be enclosed in `{{}}`.
    2. The template variable Key can only be: #node_id.var1.var2#.
    3. The template variable Key cannot contain new lines or spaces, and must comply with rule 2.

    Example usage:

    template = "Hello, {{#node_id.query.name#}}! Your age is {{#node_id.query.age#}}."
    parser = VariableTemplateParser(template)

    # Extract template variable keys
    variable_keys = parser.extract()
    print(variable_keys)
    # Output: ['#node_id.query.name#', '#node_id.query.age#']

    # Extract variable selectors
    variable_selectors = parser.extract_variable_selectors()
    print(variable_selectors)
    # Output: [VariableSelector(variable='#node_id.query.name#', value_selector=['node_id', 'query', 'name']),
    #          VariableSelector(variable='#node_id.query.age#', value_selector=['node_id', 'query', 'age'])]

    # Format the template string
    inputs = {'#node_id.query.name#': 'John', '#node_id.query.age#': 25}}
    formatted_string = parser.format(inputs)
    print(formatted_string)
    # Output: "Hello, John! Your age is 25."
    """

    def __init__(self, template: str):
        self.template = template
        self.variable_keys = self.extract()

    def extract(self) -> list:
        """
        Extracts all the template variable keys from the template string.

        Returns:
            A list of template variable keys.
        """
        # Regular expression to match the template rules
        matches = re.findall(REGEX, self.template)

        first_group_matches = [match[0] for match in matches]

        return list(set(first_group_matches))

    def extract_variable_selectors(self) -> list[VariableSelector]:
        """
        Extracts the variable selectors from the template variable keys.

        Returns:
            A list of VariableSelector objects representing the variable selectors.
        """
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

    def format(self, inputs: Mapping[str, Any], remove_template_variables: bool = True) -> str:
        """
        Formats the template string by replacing the template variables with their corresponding values.

        Args:
            inputs: A dictionary containing the values for the template variables.
            remove_template_variables: A boolean indicating whether to remove the template variables from the output.

        Returns:
            The formatted string with template variables replaced by their values.
        """
        def replacer(match):
            key = match.group(1)
            value = inputs.get(key, match.group(0))  # return original matched string if key not found

            if value is None:
                value = ''
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
        """
        Removes the template variables from the given text.

        Args:
            text: The text from which to remove the template variables.

        Returns:
            The text with template variables removed.
        """
        return re.sub(REGEX, r'{\1}', text)
