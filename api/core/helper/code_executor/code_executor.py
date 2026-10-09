import logging
import time
from collections.abc import Mapping
from threading import Lock
from typing import Any

import httpx
from pydantic import BaseModel
from yarl import URL

from configs import dify_config
from core.helper.code_executor.javascript.javascript_transformer import NodeJsTemplateTransformer
from core.helper.code_executor.jinja2.jinja2_transformer import Jinja2TemplateTransformer
from core.helper.code_executor.python3.python3_transformer import Python3TemplateTransformer
from core.helper.code_executor.template_transformer import TemplateTransformer
from core.helper.http_client_pooling import get_pooled_http_client
from graphon.nodes.code.entities import CodeLanguage as CodeLanguage  # noqa: PLC0414

logger = logging.getLogger(__name__)
code_execution_endpoint_url = URL(str(dify_config.CODE_EXECUTION_ENDPOINT))
CODE_EXECUTION_SSL_VERIFY = dify_config.CODE_EXECUTION_SSL_VERIFY
_CODE_EXECUTOR_CLIENT_LIMITS = httpx.Limits(
    max_connections=dify_config.CODE_EXECUTION_POOL_MAX_CONNECTIONS,
    max_keepalive_connections=dify_config.CODE_EXECUTION_POOL_MAX_KEEPALIVE_CONNECTIONS,
    keepalive_expiry=dify_config.CODE_EXECUTION_POOL_KEEPALIVE_EXPIRY,
)
_CODE_EXECUTOR_CLIENT_KEY = "code_executor:http_client"


class CodeExecutionError(Exception):
    pass


class CodeExecutionResponse(BaseModel):
    class Data(BaseModel):
        stdout: str | None = None
        error: str | None = None

    code: int
    message: str
    data: Data


def _build_code_executor_client() -> httpx.Client:
    return httpx.Client(
        verify=CODE_EXECUTION_SSL_VERIFY,
        limits=_CODE_EXECUTOR_CLIENT_LIMITS,
    )


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
        :param preload: the preload script
        :param code: code
        :return:
        """
        running_language = cls.code_language_to_running_language.get(language)
        if running_language is None:
            raise CodeExecutionError(f"Unsupported language {language}")

        url = code_execution_endpoint_url / "v1" / "sandbox" / "run"

        headers = {"X-Api-Key": dify_config.CODE_EXECUTION_API_KEY}

        data = {
            "language": running_language,
            "code": code,
            "preload": preload,
            "enable_network": True,
        }

        timeout = httpx.Timeout(
            connect=dify_config.CODE_EXECUTION_CONNECT_TIMEOUT,
            read=dify_config.CODE_EXECUTION_READ_TIMEOUT,
            write=dify_config.CODE_EXECUTION_WRITE_TIMEOUT,
            pool=None,
        )

        client = get_pooled_http_client(_CODE_EXECUTOR_CLIENT_KEY, _build_code_executor_client)

        # Retry transient upstream failures (502/503/504) so a single
        # bad request doesn't kill the entire workflow. 502 in particular
        # surfaces as "sandbox is down" even though the sandbox is fine
        # and the proxy (typically nginx in front of the sandbox) is
        # the actual culprit — see #40603. A brief retry masks the
        # transient case and the user can diagnose the real cause
        # from the persistent one.
        response = None
        last_exc: Exception | None = None
        # Coerce the typed-but-env-loaded config values into the
        # concrete numeric types the retry loop needs. Pydantic
        # validation guarantees runtime types, but type-checkers see
        # the env-loader return type as `int | None` / `float | None`,
        # so \`attempts + 1\` and \`time.sleep(delay)\` would both fail
        # without a narrowing step here.
        retry_count = int(dify_config.CODE_EXECUTION_PROXY_RETRY_COUNT or 0)
        retry_delay: float = (
            dify_config.CODE_EXECUTION_PROXY_RETRY_DELAY
            if dify_config.CODE_EXECUTION_PROXY_RETRY_DELAY is not None
            else 0.0
        )
        attempts = retry_count + 1
        for attempt in range(attempts):
            try:
                response = client.post(
                    str(url),
                    json=data,
                    headers=headers,
                    timeout=timeout,
                )
                if response.status_code not in (502, 503, 504):
                    break
                response = None
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout, httpx.RequestError) as e:
                last_exc = e
                response = None
            except Exception as e:
                # Non-httpx errors don't trigger retries — surface them
                # directly so callers get a meaningful traceback.
                raise CodeExecutionError(
                    "Failed to execute code, which is likely a network issue,"
                    " please check if the sandbox service is running."
                    f" ( Error: {str(e)} )"
                ) from e
            if attempt + 1 < attempts and retry_delay > 0:
                time.sleep(retry_delay)

        if response is None:
            if last_exc is not None:
                raise CodeExecutionError(
                    "Failed to execute code, which is likely a network issue,"
                    " please check if the sandbox service is running."
                    f" ( Error: {str(last_exc)} )"
                )
            raise CodeExecutionError(
                "Code execution service is unavailable after"
                f" {attempts} attempts; please check if the sandbox service is running."
            )

        if response.status_code == 503:
            raise CodeExecutionError("Code execution service is unavailable")
        elif response.status_code != 200:
            # Surface non-transient non-200 errors with the original
            # "likely a network issue" wording so existing call-sites that
            # pattern-match on the message keep working. Transient
            # 502/503/504 are exhausted via the retry loop above, so the
            # message here covers only the persistent case.
            raise CodeExecutionError(
                "Failed to execute code, which is likely a network issue,"
                " please check if the sandbox service is running."
                f" (status {response.status_code} from sandbox)"
            )

        try:
            response_data = response.json()
        except Exception as e:
            raise CodeExecutionError("Failed to parse response") from e

        if (code := response_data.get("code")) != 0:
            raise CodeExecutionError(f"Got error code: {code}. Got error msg: {response_data.get('message')}")

        response_code = CodeExecutionResponse.model_validate(response_data)

        if response_code.data.error:
            raise CodeExecutionError(response_code.data.error)

        return response_code.data.stdout or ""

    @classmethod
    def execute_workflow_code_template(
        cls, language: CodeLanguage, code: str, inputs: Mapping[str, Any]
    ) -> dict[str, Any]:
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
        response = cls.execute_code(language, preload, runner)
        return template_transformer.transform_response(response)
