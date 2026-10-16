from collections.abc import Mapping
from threading import Lock
from typing import Any

from core.helper.code_executor.javascript.javascript_transformer import NodeJsTemplateTransformer
from core.helper.code_executor.jinja2.jinja2_transformer import Jinja2TemplateTransformer
from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer
from core.helper.code_executor.template_transformer import TemplateTransformer
from graphon.nodes.code.entities import CodeLanguage as CodeLanguage  # noqa: PLC0414
from services.code_execution.contracts import CodeExecutionError as CodeExecutionError  # noqa: PLC0414
from services.code_execution.contracts import CodeExecutionResponse as CodeExecutionResponse  # noqa: PLC0414
from services.code_execution.contracts import CodeExecutionTransport
from services.code_execution.transport import OrdinaryCodeExecutionTransport


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
    def execute_code(
        cls, language: CodeLanguage, preload: str, code: str, *, transport: CodeExecutionTransport | None = None
    ) -> str:
        """
        Execute code
        :param language: code language
        :param preload: the preload script
        :param code: code
        :param transport: explicit transport; None uses the ordinary sandbox endpoint
        :return:
        """
        running_language = cls.code_language_to_running_language.get(language)
        if running_language is None:
            raise CodeExecutionError(f"Unsupported language {language}")

        if transport is None:
            transport = OrdinaryCodeExecutionTransport()
        return transport.execute(language=running_language, preload=preload, code=code)

    @classmethod
    def execute_workflow_code_template(
        cls,
        language: CodeLanguage,
        code: str,
        inputs: Mapping[str, Any],
        *,
        transport: CodeExecutionTransport | None = None,
    ) -> dict[str, Any]:
        """
        Execute code
        :param language: code language
        :param code: code
        :param inputs: inputs
        :param transport: explicit transport; None uses the ordinary sandbox endpoint
        :return:
        """
        template_transformer = cls.code_template_transformers.get(language)
        if not template_transformer:
            raise CodeExecutionError(f"Unsupported language {language}")

        runner, preload = template_transformer.transform_caller(code, inputs)
        if transport is None:
            response = cls.execute_code(language, preload, runner)
        else:
            response = cls.execute_code(language, preload, runner, transport=transport)
        return template_transformer.transform_response(response)
