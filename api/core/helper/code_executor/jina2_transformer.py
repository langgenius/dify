import json
import re

from core.helper.code_executor.template_transformer import TemplateTransformer

PYTHON_RUNNER = """
import jinja2

template = jinja2.Template('''{{code}}''')

def main(**inputs):
    return template.render(**inputs)

# execute main function, and return the result
output = main(**{{inputs}})

result = f'''<<RESULT>>{output}<<RESULT>>'''

print(result)

"""

JINJA2_PRELOAD_TEMPLATE = """{% set fruits = ['Apple'] %}
{{ 'a' }}
{% for fruit in fruits %}
    <li>{{ fruit }}</li>
{% endfor %}
{% if fruits|length > 1 %}
1
{% endif %}
{% for i in range(5) %}
    {% if i == 3 %}{{ i }}{% else %}{% endif %}
{% endfor %}
    {% for i in range(3) %}
        {{ i + 1 }}
    {% endfor %}
{% macro say_hello() %}a{{ 'b' }}{% endmacro %}
{{ s }}{{ say_hello() }}"""

JINJA2_PRELOAD = f"""
import jinja2

def _jinja2_preload_():
    # prepare jinja2 environment, load template and render before to avoid sandbox issue
    template = jinja2.Template('''{JINJA2_PRELOAD_TEMPLATE}''')
    template.render(s='a')

if __name__ == '__main__':
    _jinja2_preload_()

"""

class Jinja2TemplateTransformer(TemplateTransformer):
    @classmethod
    def transform_caller(cls, code: str, inputs: dict) -> tuple[str, str]:
        """
        Transform code to python runner
        :param code: code
        :param inputs: inputs
        :return:
        """

        # transform jinja2 template to python code
        runner = PYTHON_RUNNER.replace('{{code}}', code)
        runner = runner.replace('{{inputs}}', json.dumps(inputs, indent=4, ensure_ascii=False))

        return runner, JINJA2_PRELOAD

    @classmethod
    def transform_response(cls, response: str) -> dict:
        """
        Transform response to dict
        :param response: response
        :return:
        """
        # extract result
        result = re.search(r'<<RESULT>>(.*)<<RESULT>>', response, re.DOTALL)
        if not result:
            raise ValueError('Failed to parse result')
        result = result.group(1)

        return {
            'result': result
        }
