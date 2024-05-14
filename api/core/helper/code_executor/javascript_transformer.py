import json
import re
from typing import Optional

from core.helper.code_executor.entities import CodeDependency
from core.helper.code_executor.template_transformer import TemplateTransformer

NODEJS_RUNNER = """// declare main function here
{{code}}

// execute main function, and return the result
// inputs is a dict, unstructured inputs
output = main({{inputs}})

// convert output to json and print
output = JSON.stringify(output)

result = `<<RESULT>>${output}<<RESULT>>`

console.log(result)
"""

NODEJS_PRELOAD = """"""

class NodeJsTemplateTransformer(TemplateTransformer):
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
        inputs_str = json.dumps(inputs, indent=4, ensure_ascii=False)

        # replace code and inputs
        runner = NODEJS_RUNNER.replace('{{code}}', code)
        runner = runner.replace('{{inputs}}', inputs_str)

        return runner, NODEJS_PRELOAD, []

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
        return json.loads(result)
