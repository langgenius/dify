import re
from typing import Any

from langchain import PromptTemplate
from langchain.formatting import StrictFormatter


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
