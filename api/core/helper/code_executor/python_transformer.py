import json
import re
from base64 import b64encode
from typing import Optional

from core.helper.code_executor.entities import CodeDependency
from core.helper.code_executor.template_transformer import TemplateTransformer

PYTHON_RUNNER = """# declare main function here
{{code}}

from json import loads, dumps
from base64 import b64decode

# execute main function, and return the result
# inputs is a dict, and it
inputs = b64decode('{{inputs}}').decode('utf-8')
output = main(**json.loads(inputs))

# convert output to json and print
output = dumps(output, indent=4)

result = f'''<<RESULT>>
{output}
<<RESULT>>'''

print(result)
"""

PYTHON_PRELOAD = """"""

PYTHON_STANDARD_PACKAGES = set([
    'json', 'datetime', 'math', 'random', 're', 'string', 'sys', 'time', 'traceback', 'uuid', 'os', 'base64',
    'hashlib', 'hmac', 'binascii', 'collections', 'functools', 'operator', 'itertools', 'uuid', 
])

class PythonTemplateTransformer(TemplateTransformer):
    @classmethod
    def transform_caller(cls, code: str, inputs: dict, 
                         dependencies: Optional[list[CodeDependency]] = None) -> tuple[str, str, list[CodeDependency]]:
        """
        Transform code to python runner
        :param code: code
        :param inputs: inputs
        :return:
        """
        
        # transform inputs to json string
        inputs_str = b64encode(json.dumps(inputs, ensure_ascii=False).encode()).decode('utf-8')

        # replace code and inputs
        runner = PYTHON_RUNNER.replace('{{code}}', code)
        runner = runner.replace('{{inputs}}', inputs_str)

        # add standard packages
        if dependencies is None:
            dependencies = []

        for package in PYTHON_STANDARD_PACKAGES:
            if package not in dependencies:
                dependencies.append(CodeDependency(name=package, version=''))

        # deduplicate
        dependencies = list({dep.name: dep for dep in dependencies if dep.name}.values())

        return runner, PYTHON_PRELOAD, dependencies
    
    @classmethod
    def transform_response(cls, response: str) -> dict:
        """
        Transform response to dict
        :param response: response
        :return:
        """
        # extract result
        result = re.search(r'<<RESULT>>(.*?)<<RESULT>>', response, re.DOTALL)
        if not result:
            raise ValueError('Failed to parse result')
        result = result.group(1)
        return json.loads(result)
