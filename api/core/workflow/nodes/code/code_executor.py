from os import environ

from httpx import post
from pydantic import BaseModel
from yarl import URL

from core.workflow.nodes.code.python_template import PythonTemplateTransformer

# Code Executor
CODE_EXECUTION_ENDPOINT = environ.get('CODE_EXECUTION_ENDPOINT', '')
CODE_EXECUTION_API_KEY = environ.get('CODE_EXECUTION_API_KEY', '')

class CodeExecutionException(Exception):
    pass

class CodeExecutionResponse(BaseModel):
    class Data(BaseModel):
        stdout: str
        stderr: str

    code: int
    message: str
    data: Data

class CodeExecutor:
    @classmethod
    def execute_code(cls, language: str, code: str, inputs: dict) -> dict:
        """
        Execute code
        :param language: code language
        :param code: code
        :param inputs: inputs
        :return:
        """
        runner = PythonTemplateTransformer.transform_caller(code, inputs)

        url = URL(CODE_EXECUTION_ENDPOINT) / 'v1' / 'sandbox' / 'run'
        headers = {
            'X-Api-Key': CODE_EXECUTION_API_KEY
        }
        data = {
            'language': language,
            'code': runner,
        }

        try:
            response = post(str(url), json=data, headers=headers)
            if response.status_code == 503:
                raise CodeExecutionException('Code execution service is unavailable')
            elif response.status_code != 200:
                raise Exception('Failed to execute code')
        except CodeExecutionException as e:
            raise e
        except Exception:
            raise CodeExecutionException('Failed to execute code')

        try:
            response = response.json()
        except:
            raise CodeExecutionException('Failed to parse response')

        response = CodeExecutionResponse(**response)

        if response.code != 0:
            raise CodeExecutionException(response.message)
        
        if response.data.stderr:
            raise CodeExecutionException(response.data.stderr)
        
        return PythonTemplateTransformer.transform_response(response.data.stdout)