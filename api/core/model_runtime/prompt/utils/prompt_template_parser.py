import re
from collections.abc import Mapping

REGEX = re.compile(r"\{\{([a-zA-Z_][a-zA-Z0-9_]{0,29}|#histories#|#query#|#context#)\}\}")
WITH_VARIABLE_TMPL_REGEX = re.compile(
    r"\{\{([a-zA-Z_][a-zA-Z0-9_]{0,29}|#[a-zA-Z0-9_]{1,50}\.[a-zA-Z0-9_\.]{1,100}#|#histories#|#query#|#context#)\}\}"
)


class PromptTemplateParser:
    """
    Rules:

    1. Template variables must be enclosed in `{{}}`.
    2. The template variable Key can only be: letters + numbers + underscore, with a maximum length of 16 characters,
       and can only start with letters and underscores.
    3. The template variable Key cannot contain new lines or spaces, and must comply with rule 2.
    4. In addition to the above, 3 types of special template variable Keys are accepted:
       `{{#histories#}}` `{{#query#}}` `{{#context#}}`. No other `{{##}}` template variables are allowed.
    """

    def __init__(self, template: str, with_variable_tmpl: bool = False):
        self.template = template
        self.with_variable_tmpl = with_variable_tmpl
        self.regex = WITH_VARIABLE_TMPL_REGEX if with_variable_tmpl else REGEX
        self.variable_keys = self.extract()

    def extract(self):
        # Regular expression to match the template rules
        return re.findall(self.regex, self.template)

    def format(self, inputs: Mapping[str, str], remove_template_variables: bool = True) -> str:
        def replacer(match):
            key = match.group(1)
            value = inputs.get(key, match.group(0))  # return original matched string if key not found

            if remove_template_variables and isinstance(value, str):
                return PromptTemplateParser.remove_template_variables(value, self.with_variable_tmpl)
            return value

        prompt = re.sub(self.regex, replacer, self.template)
        return re.sub(r"<\|.*?\|>", "", prompt)

    @classmethod
    def remove_template_variables(cls, text: str, with_variable_tmpl: bool = False):
        return re.sub(WITH_VARIABLE_TMPL_REGEX if with_variable_tmpl else REGEX, r"{\1}", text)
