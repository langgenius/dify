import logging
from collections.abc import Mapping
from enum import StrEnum
from threading import Lock
from typing import Any, Optional

from httpx import Timeout, post
from pydantic import BaseModel
from yarl import URL

from configs import dify_config
from core.helper.code_executor.javascript.javascript_transformer import NodeJsTemplateTransformer
from core.helper.code_executor.jinja2.jinja2_transformer import Jinja2TemplateTransformer
from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer
from core.helper.code_executor.template_transformer import TemplateTransformer

logger = logging.getLogger(__name__)


class CodeExecutionError(Exception):
    pass


class CodeExecutionResponse(BaseModel):
    class Data(BaseModel):
        stdout: Optional[str] = None
        error: Optional[str] = None

    code: int
    message: str
    data: Data


class CodeLanguage(StrEnum):
    PYTHON3 = "python3"
    JINJA2 = "jinja2"
    JAVASCRIPT = "javascript"


class CodeExecutor:
    dependencies_cache: dict[str, str] = {}
    dependencies_cache_lock = Lock()

    code_template_transformers: dict[CodeLanguage, type[TemplateTransformer]] = {
        CodeLanguage.PYTHON3: Python3TemplateTransformer,
        CodeLanguage.JINJA2: Jinja2TemplateTransformer,
        CodeLanguage.JAVASCRIPT: NodeJsTemplateTransformer,
    }

    code_language_to_running_language = {
        CodeLanguage.JAVASCRIPT: "nodejs",
        CodeLanguage.JINJA2: CodeLanguage.PYTHON3,
        CodeLanguage.PYTHON3: CodeLanguage.PYTHON3,
    }

    supported_dependencies_languages: set[CodeLanguage] = {CodeLanguage.PYTHON3}

    @classmethod
    def execute_code(cls, language: CodeLanguage, preload: str, code: str) -> str:
        """
        Execute code
        :param language: code language
        :param code: code
        :return:
        """
        url = URL(str(dify_config.CODE_EXECUTION_ENDPOINT)) / "v1" / "sandbox" / "run"

        headers = {"X-Api-Key": dify_config.CODE_EXECUTION_API_KEY}

        data = {
            "language": cls.code_language_to_running_language.get(language),
            "code": code,
            "preload": preload,
            "enable_network": True,
        }

        try:
            response = post(
                str(url),
                json=data,
                headers=headers,
                timeout=Timeout(
                    connect=dify_config.CODE_EXECUTION_CONNECT_TIMEOUT,
                    read=dify_config.CODE_EXECUTION_READ_TIMEOUT,
                    write=dify_config.CODE_EXECUTION_WRITE_TIMEOUT,
                    pool=None,
                ),
            )
            if response.status_code == 503:
                raise CodeExecutionError("Code execution service is unavailable")
            elif response.status_code != 200:
                raise Exception(
                    f"Failed to execute code, got status code {response.status_code},"
                    f" please check if the sandbox service is running"
                )
        except CodeExecutionError as e:
            raise e
        except Exception as e:
            raise CodeExecutionError(
                "Failed to execute code, which is likely a network issue,"
                " please check if the sandbox service is running."
                f" ( Error: {str(e)} )"
            )

        try:
            response_data = response.json()
        except:
            raise CodeExecutionError("Failed to parse response")

        if (code := response_data.get("code")) != 0:
            raise CodeExecutionError(f"Got error code: {code}. Got error msg: {response_data.get('message')}")

        response_code = CodeExecutionResponse(**response_data)

        if response_code.data.error:
            raise CodeExecutionError(response_code.data.error)

        return response_code.data.stdout or ""

    @classmethod
    def execute_workflow_code_template(cls, language: CodeLanguage, code: str, inputs: Mapping[str, Any]):
        """
        Execute code
        :param language: code language
        :param code: code
        :param inputs: inputs
        :return:
        """
        template_transformer = cls.code_template_transformers.get(language)
        if not template_transformer:
            raise CodeExecutionError(f"Unsupported language {language}")

        runner, preload = template_transformer.transform_caller(code, inputs)

        try:
            response = cls.execute_code(language, preload, runner)
        except CodeExecutionError as e:
            raise e

        return template_transformer.transform_response(response)
