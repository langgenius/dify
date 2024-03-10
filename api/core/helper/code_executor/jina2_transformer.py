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

class Jinja2TemplateTransformer(TemplateTransformer):
    @classmethod
    def transform_caller(cls, code: str, inputs: dict) -> str:
        """
        Transform code to python runner
        :param code: code
        :param inputs: inputs
        :return:
        """

        # transform jinja2 template to python code
        runner = PYTHON_RUNNER.replace('{{code}}', code)
        runner = runner.replace('{{inputs}}', json.dumps(inputs, indent=4))

        return runner
    
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