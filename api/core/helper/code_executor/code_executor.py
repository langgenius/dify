import logging
import os
import time
from enum import Enum
from threading import Lock
from typing import Literal, Optional

from httpx import get, post
from pydantic import BaseModel
from yarl import URL

from core.helper.code_executor.entities import CodeDependency
from core.helper.code_executor.javascript.javascript_transformer import NodeJsTemplateTransformer
from core.helper.code_executor.jinja2.jinja2_transformer import Jinja2TemplateTransformer
from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer
from core.helper.code_executor.template_transformer import TemplateTransformer

logger = logging.getLogger(__name__)

# Code Executor
CODE_EXECUTION_ENDPOINT = os.environ.get('CODE_EXECUTION_ENDPOINT', 'http://sandbox:8194')
CODE_EXECUTION_API_KEY = os.environ.get('CODE_EXECUTION_API_KEY', 'dify-sandbox')

CODE_EXECUTION_TIMEOUT= (10, 60)

class CodeExecutionException(Exception):
    pass

class CodeExecutionResponse(BaseModel):
    class Data(BaseModel):
        stdout: Optional[str] = None
        error: Optional[str] = None

    code: int
    message: str
    data: Data


class CodeLanguage(str, Enum):
    PYTHON3 = 'python3'
    JINJA2 = 'jinja2'
    JAVASCRIPT = 'javascript'


class CodeExecutor:
    dependencies_cache = {}
    dependencies_cache_lock = Lock()

    code_template_transformers: dict[CodeLanguage, type[TemplateTransformer]] = {
        CodeLanguage.PYTHON3: Python3TemplateTransformer,
        CodeLanguage.JINJA2: Jinja2TemplateTransformer,
        CodeLanguage.JAVASCRIPT: NodeJsTemplateTransformer,
    }

    code_language_to_running_language = {
        CodeLanguage.JAVASCRIPT: 'nodejs',
        CodeLanguage.JINJA2: CodeLanguage.PYTHON3,
        CodeLanguage.PYTHON3: CodeLanguage.PYTHON3,
    }

    supported_dependencies_languages: set[CodeLanguage] = {
        CodeLanguage.PYTHON3
    }

    @classmethod
    def execute_code(cls, 
                     language: Literal['python3', 'javascript', 'jinja2'], 
                     preload: str, 
                     code: str, 
                     dependencies: Optional[list[CodeDependency]] = None) -> str:
        """
        Execute code
        :param language: code language
        :param code: code
        :return:
        """
        url = URL(CODE_EXECUTION_ENDPOINT) / 'v1' / 'sandbox' / 'run'

        headers = {
            'X-Api-Key': CODE_EXECUTION_API_KEY
        }

        data = {
            'language': cls.code_language_to_running_language.get(language),
            'code': code,
            'preload': preload,
            'enable_network': True
        }

        if dependencies:
            data['dependencies'] = [dependency.model_dump() for dependency in dependencies]

        try:
            response = post(str(url), json=data, headers=headers, timeout=CODE_EXECUTION_TIMEOUT)
            if response.status_code == 503:
                raise CodeExecutionException('Code execution service is unavailable')
            elif response.status_code != 200:
                raise Exception(f'Failed to execute code, got status code {response.status_code}, please check if the sandbox service is running')
        except CodeExecutionException as e:
            raise e
        except Exception as e:
            raise CodeExecutionException('Failed to execute code, which is likely a network issue,'
                                         ' please check if the sandbox service is running.'
                                         f' ( Error: {str(e)} )')
        
        try:
            response = response.json()
        except:
            raise CodeExecutionException('Failed to parse response')
        
        response = CodeExecutionResponse(**response)

        if response.code != 0:
            raise CodeExecutionException(response.message)
        
        if response.data.error:
            raise CodeExecutionException(response.data.error)
        
        return response.data.stdout

    @classmethod
    def execute_workflow_code_template(cls, language: Literal['python3', 'javascript', 'jinja2'], code: str, inputs: dict, dependencies: Optional[list[CodeDependency]] = None) -> dict:
        """
        Execute code
        :param language: code language
        :param code: code
        :param inputs: inputs
        :return:
        """
        template_transformer = cls.code_template_transformers.get(language)
        if not template_transformer:
            raise CodeExecutionException(f'Unsupported language {language}')

        runner, preload, dependencies = template_transformer.transform_caller(code, inputs, dependencies)

        try:
            response = cls.execute_code(language, preload, runner, dependencies)
        except CodeExecutionException as e:
            raise e

        return template_transformer.transform_response(response)
    
    @classmethod
    def list_dependencies(cls, language: str) -> list[CodeDependency]:
        if language not in cls.supported_dependencies_languages:
            return []

        with cls.dependencies_cache_lock:
            if language in cls.dependencies_cache:
                # check expiration
                dependencies = cls.dependencies_cache[language]
                if dependencies['expiration'] > time.time():
                    return dependencies['data']
                # remove expired cache
                del cls.dependencies_cache[language]
        
        dependencies = cls._get_dependencies(language)
        with cls.dependencies_cache_lock:
            cls.dependencies_cache[language] = {
                'data': dependencies,
                'expiration': time.time() + 60
            }
        
        return dependencies
        
    @classmethod
    def _get_dependencies(cls, language: Literal['python3']) -> list[CodeDependency]:
        """
        List dependencies
        """
        url = URL(CODE_EXECUTION_ENDPOINT) / 'v1' / 'sandbox' / 'dependencies'

        headers = {
            'X-Api-Key': CODE_EXECUTION_API_KEY
        }

        running_language = cls.code_language_to_running_language.get(language)
        if isinstance(running_language, Enum):
            running_language = running_language.value

        data = {
            'language': running_language,
        }

        try:
            response = get(str(url), params=data, headers=headers, timeout=CODE_EXECUTION_TIMEOUT)
            if response.status_code != 200:
                raise Exception(f'Failed to list dependencies, got status code {response.status_code}, please check if the sandbox service is running')
            response = response.json()
            dependencies = response.get('data', {}).get('dependencies', [])
            return [
                CodeDependency(**dependency) for dependency in dependencies
                if dependency.get('name') not in Python3TemplateTransformer.get_standard_packages()
            ]
        except Exception as e:
            logger.exception(f'Failed to list dependencies: {e}')
            return []