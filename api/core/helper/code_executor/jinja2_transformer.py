import json
import re
from base64 import b64encode
from typing import Optional

from core.helper.code_executor.entities import CodeDependency
from core.helper.code_executor.python_transformer import PYTHON_STANDARD_PACKAGES
from core.helper.code_executor.template_transformer import TemplateTransformer

PYTHON_RUNNER = """
import jinja2
from json import loads
from base64 import b64decode

template = jinja2.Template('''{{code}}''')

def main(**inputs):
    return template.render(**inputs)

# execute main function, and return the result
inputs = b64decode('{{inputs}}').decode('utf-8')
output = main(**loads(inputs))

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
from base64 import b64decode

def _jinja2_preload_():
    # prepare jinja2 environment, load template and render before to avoid sandbox issue
    template = jinja2.Template('''{JINJA2_PRELOAD_TEMPLATE}''')
    template.render(s='a')

if __name__ == '__main__':
    _jinja2_preload_()

"""


class Jinja2TemplateTransformer(TemplateTransformer):
    @classmethod
    def transform_caller(cls, code: str, inputs: dict, 
                         dependencies: Optional[list[CodeDependency]] = None) -> tuple[str, str, list[CodeDependency]]:
        """
        Transform code to python runner
        :param code: code
        :param inputs: inputs
        :return:
        """

        inputs_str = b64encode(json.dumps(inputs, ensure_ascii=False).encode()).decode('utf-8')

        # transform jinja2 template to python code
        runner = PYTHON_RUNNER.replace('{{code}}', code)
        runner = runner.replace('{{inputs}}', inputs_str)

        if not dependencies:
            dependencies = []

        # add native packages and jinja2
        for package in PYTHON_STANDARD_PACKAGES.union(['jinja2']):
            dependencies.append(CodeDependency(name=package, version=''))

        # deduplicate
        dependencies = list({
            dep.name: dep for dep in dependencies if dep.name
        }.values())

        return runner, JINJA2_PRELOAD, dependencies

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
