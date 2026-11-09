from __future__ import annotations

import json
import os
import re
from base64 import b64encode
from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, ClassVar

import httpx

from graphon.nodes.code.entities import CodeLanguage
from graphon.variables.utils import dumps_with_segments

from .entities import DslCodeSettings

_RESULT_TAG = "<<RESULT>>"
_DEFAULT_CODE_EXECUTION_ENDPOINT = "http://127.0.0.1:8194"
_DEFAULT_CODE_EXECUTION_API_KEY = "dify-sandbox"
_SCIENTIFIC_NOTATION = re.compile(r"^-?\d+\.?\d*e[+-]\d+$", re.IGNORECASE)


class SandboxCodeExecutionError(RuntimeError):
    """Raised when the DSL code executor cannot complete sandbox execution."""


@dataclass(frozen=True, slots=True)
class _SandboxProgram:
    language: str
    code: str
    preload: str = ""

    def request_payload(self) -> dict[str, Any]:
        return {
            "language": self.language,
            "code": self.code,
            "preload": self.preload,
            "enable_network": True,
        }


class _DifySandboxClient:
    def __init__(self, settings: DslCodeSettings) -> None:
        self._settings = settings

    def run(self, program: _SandboxProgram) -> str:
        response = self._post(program)
        return self._stdout_from_response(response)

    def _post(self, program: _SandboxProgram) -> httpx.Response:
        timeout = httpx.Timeout(
            connect=self._settings.connect_timeout,
            read=self._settings.read_timeout,
            write=self._settings.write_timeout,
            pool=None,
        )
        try:
            return httpx.post(
                _sandbox_run_url(self._settings),
                json=program.request_payload(),
                headers={"X-Api-Key": _sandbox_api_key(self._settings)},
                timeout=timeout,
                verify=self._settings.ssl_verify,
            )
        except Exception as error:
            msg = (
                "Failed to execute code, which is likely a network issue, "
                "please check if the sandbox service is running. "
                f"( Error: {error} )"
            )
            raise SandboxCodeExecutionError(msg) from error

    @staticmethod
    def _stdout_from_response(response: httpx.Response) -> str:
        if response.status_code == HTTPStatus.SERVICE_UNAVAILABLE:
            msg = "Code execution service is unavailable"
            raise SandboxCodeExecutionError(msg)
        if response.status_code != HTTPStatus.OK:
            msg = (
                f"Failed to execute code, got status code {response.status_code}, "
                "please check if the sandbox service is running"
            )
            raise SandboxCodeExecutionError(msg)

        try:
            response_data = response.json()
        except Exception as error:
            msg = "Failed to parse response"
            raise SandboxCodeExecutionError(msg) from error

        if not isinstance(response_data, Mapping):
            msg = "Code execution response must be a JSON object."
            raise SandboxCodeExecutionError(msg)

        response_code = response_data.get("code")
        if response_code != 0:
            msg = (
                f"Got error code: {response_code}. "
                f"Got error msg: {response_data.get('message')}"
            )
            raise SandboxCodeExecutionError(msg)

        data_payload = response_data.get("data")
        if not isinstance(data_payload, Mapping):
            msg = "Code execution response data must be a JSON object."
            raise SandboxCodeExecutionError(msg)

        runtime_error = data_payload.get("error")
        if runtime_error:
            raise SandboxCodeExecutionError(str(runtime_error))

        stdout = data_payload.get("stdout")
        return stdout if isinstance(stdout, str) else ""


class _TemplateTransformer:
    sandbox_language: ClassVar[str]

    @classmethod
    def build_program(cls, *, code: str, inputs: Mapping[str, Any]) -> _SandboxProgram:
        inputs_payload = cls.serialize_inputs(inputs)
        return _SandboxProgram(
            language=cls.sandbox_language,
            code=cls.runner(code=code, inputs_payload=inputs_payload),
            preload=cls.preload(),
        )

    @classmethod
    def runner(cls, *, code: str, inputs_payload: str) -> str:
        _ = code, inputs_payload
        msg = f"{cls.__name__} does not implement a sandbox runner."
        raise SandboxCodeExecutionError(msg)

    @classmethod
    def preload(cls) -> str:
        return ""

    @classmethod
    def parse_result(cls, stdout: str) -> Mapping[str, Any]:
        return _parse_json_object_result(stdout)

    @staticmethod
    def serialize_inputs(inputs: Mapping[str, Any]) -> str:
        inputs_json = dumps_with_segments(inputs).encode("utf-8")
        return b64encode(inputs_json).decode("utf-8")


class _Python3TemplateTransformer(_TemplateTransformer):
    sandbox_language = "python3"

    @classmethod
    def runner(cls, *, code: str, inputs_payload: str) -> str:
        return "\n".join(
            [
                code.rstrip(),
                "",
                "import json",
                "from base64 import b64decode",
                "",
                (
                    "inputs_obj = json.loads("
                    f"b64decode('{inputs_payload}').decode('utf-8')"
                    ")"
                ),
                "output_obj = main(**inputs_obj)",
                "output_json = json.dumps(output_obj, indent=4)",
                f"result = f'''{_RESULT_TAG}{{output_json}}{_RESULT_TAG}'''",
                "print(result)",
                "",
            ],
        )


class _JavaScriptTemplateTransformer(_TemplateTransformer):
    sandbox_language = "nodejs"

    @classmethod
    def runner(cls, *, code: str, inputs_payload: str) -> str:
        return "\n".join(
            [
                code.rstrip(),
                "",
                "var inputs_obj = JSON.parse(",
                f"    Buffer.from('{inputs_payload}', 'base64').toString('utf-8')",
                ")",
                "var output_obj = main(inputs_obj)",
                "var output_json = JSON.stringify(output_obj)",
                f"var result = `{_RESULT_TAG}${{output_json}}{_RESULT_TAG}`",
                "console.log(result)",
                "",
            ],
        )


class _UnsupportedJinja2TemplateTransformer(_TemplateTransformer):
    sandbox_language = "python3"

    @classmethod
    def build_program(cls, *, code: str, inputs: Mapping[str, Any]) -> _SandboxProgram:
        _ = code, inputs
        msg = "Jinja2 code execution is not supported by Graphon code nodes."
        raise SandboxCodeExecutionError(msg)


_TRANSFORMERS: Mapping[CodeLanguage, type[_TemplateTransformer]] = {
    CodeLanguage.PYTHON3: _Python3TemplateTransformer,
    CodeLanguage.JAVASCRIPT: _JavaScriptTemplateTransformer,
    CodeLanguage.JINJA2: _UnsupportedJinja2TemplateTransformer,
}


class SandboxCodeExecutor:
    """Dify sandbox-compatible code executor used by DSL-imported code nodes."""

    def __init__(self, settings: DslCodeSettings | None = None) -> None:
        self._settings = settings or DslCodeSettings()
        self._client = _DifySandboxClient(self._settings)

    def execute(
        self,
        *,
        language: CodeLanguage,
        code: str,
        inputs: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        transformer = _transformer_for(language)
        program = transformer.build_program(code=code, inputs=inputs)
        stdout = self._client.run(program)
        return transformer.parse_result(stdout)

    def is_execution_error(self, error: Exception) -> bool:
        return isinstance(error, SandboxCodeExecutionError)


def _transformer_for(language: CodeLanguage) -> type[_TemplateTransformer]:
    try:
        return _TRANSFORMERS[language]
    except KeyError:
        msg = f"Unsupported language {language}"
        raise SandboxCodeExecutionError(msg) from None


def _sandbox_run_url(settings: DslCodeSettings) -> str:
    endpoint = (
        settings.execution_endpoint
        or os.environ.get("CODE_EXECUTION_ENDPOINT")
        or _DEFAULT_CODE_EXECUTION_ENDPOINT
    )
    return endpoint.rstrip("/") + "/v1/sandbox/run"


def _sandbox_api_key(settings: DslCodeSettings) -> str:
    return (
        settings.execution_api_key
        or os.environ.get("CODE_EXECUTION_API_KEY")
        or _DEFAULT_CODE_EXECUTION_API_KEY
    )


def _parse_json_object_result(response: str) -> Mapping[str, Any]:
    match = re.search(rf"{_RESULT_TAG}(.*){_RESULT_TAG}", response, re.DOTALL)
    if not match:
        msg = (
            "Failed to parse result: no result tag found in response. "
            f"Response: {response[:200]}..."
        )
        raise SandboxCodeExecutionError(msg)

    try:
        result = json.loads(match.group(1))
    except json.JSONDecodeError as error:
        msg = f"Failed to parse JSON response: {error}."
        raise SandboxCodeExecutionError(msg) from error

    if not isinstance(result, dict):
        msg = f"Result must be a dict, got {type(result).__name__}"
        raise SandboxCodeExecutionError(msg)
    if not all(isinstance(key, str) for key in result):
        msg = "Result keys must be strings"
        raise SandboxCodeExecutionError(msg)

    return _post_process_result(result)


def _post_process_result(result: dict[Any, Any]) -> dict[Any, Any]:
    def convert(value: Any) -> Any:
        if isinstance(value, str) and _SCIENTIFIC_NOTATION.match(value):
            try:
                return float(value)
            except ValueError:
                return value
        if isinstance(value, dict):
            return {key: convert(inner) for key, inner in value.items()}
        if isinstance(value, list):
            return [convert(inner) for inner in value]
        return value

    converted = convert(result)
    if not isinstance(converted, dict):
        msg = "Post-processed code result must remain a dict."
        raise SandboxCodeExecutionError(msg)
    return converted
