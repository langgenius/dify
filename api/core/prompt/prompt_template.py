import re
from typing import Any

from jinja2 import Environment, meta
from langchain import PromptTemplate
from langchain.formatting import StrictFormatter


class JinjaPromptTemplate(PromptTemplate):
    template_format: str = "jinja2"
    """The format of the prompt template. Options are: 'f-string', 'jinja2'."""

    @classmethod
    def from_template(cls, template: str, **kwargs: Any) -> PromptTemplate:
        """Load a prompt template from a template."""
        env = Environment()
        template = template.replace("{{}}", "{}")
        ast = env.parse(template)
        input_variables = meta.find_undeclared_variables(ast)

        if "partial_variables" in kwargs:
            partial_variables = kwargs["partial_variables"]
            input_variables = {
                var for var in input_variables if var not in partial_variables
            }

        return cls(
            input_variables=list(sorted(input_variables)), template=template, **kwargs
        )


class OutLinePromptTemplate(PromptTemplate):
    @classmethod
    def from_template(cls, template: str, **kwargs: Any) -> PromptTemplate:
        """Load a prompt template from a template."""
        input_variables = {
            v for _, v, _, _ in OneLineFormatter().parse(template) if v is not None
        }
        return cls(
            input_variables=list(sorted(input_variables)), template=template, **kwargs
        )

    def format(self, **kwargs: Any) -> str:
        """Format the prompt with the inputs.

        Args:
            kwargs: Any arguments to be passed to the prompt template.

        Returns:
            A formatted string.

        Example:

        .. code-block:: python

            prompt.format(variable1="foo")
        """
        kwargs = self._merge_partial_and_user_variables(**kwargs)
        return OneLineFormatter().format(self.template, **kwargs)


class OneLineFormatter(StrictFormatter):
    def parse(self, format_string):
        last_end = 0
        results = []
        for match in re.finditer(r"{([a-zA-Z_]\w*)}", format_string):
            field_name = match.group(1)
            start, end = match.span()

            literal_text = format_string[last_end:start]
            last_end = end

            results.append((literal_text, field_name, '', None))

        remaining_literal_text = format_string[last_end:]
        if remaining_literal_text:
            results.append((remaining_literal_text, None, None, None))

        return results
