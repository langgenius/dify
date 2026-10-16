"""Ordinary sandbox HTTP transport, preserving existing deployment behavior."""

import httpx
from yarl import URL

from configs import dify_config
from core.helper.http_client_pooling import get_pooled_http_client
from services.code_execution.contracts import CodeExecutionError, CodeExecutionResponse

code_execution_endpoint_url = URL(str(dify_config.CODE_EXECUTION_ENDPOINT))
CODE_EXECUTION_SSL_VERIFY = dify_config.CODE_EXECUTION_SSL_VERIFY
_CODE_EXECUTOR_CLIENT_LIMITS = httpx.Limits(
    max_connections=dify_config.CODE_EXECUTION_POOL_MAX_CONNECTIONS,
    max_keepalive_connections=dify_config.CODE_EXECUTION_POOL_MAX_KEEPALIVE_CONNECTIONS,
    keepalive_expiry=dify_config.CODE_EXECUTION_POOL_KEEPALIVE_EXPIRY,
)
_CODE_EXECUTOR_CLIENT_KEY = "code_executor:http_client"


def _build_code_executor_client() -> httpx.Client:
    return httpx.Client(
        verify=CODE_EXECUTION_SSL_VERIFY,
        limits=_CODE_EXECUTOR_CLIENT_LIMITS,
    )


class OrdinaryCodeExecutionTransport:
    def execute(self, *, language: str, preload: str, code: str) -> str:
        """Use the ordinary endpoint with its existing network and response semantics."""
        url = code_execution_endpoint_url / "v1" / "sandbox" / "run"

        headers = {"X-Api-Key": dify_config.CODE_EXECUTION_API_KEY}

        data = {
            "language": language,
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

        try:
            response = client.post(
                str(url),
                json=data,
                headers=headers,
                timeout=timeout,
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
        except Exception as e:
            raise CodeExecutionError("Failed to parse response") from e

        if (code := response_data.get("code")) != 0:
            raise CodeExecutionError(f"Got error code: {code}. Got error msg: {response_data.get('message')}")

        response_code = CodeExecutionResponse.model_validate(response_data)

        if response_code.data.error:
            raise CodeExecutionError(response_code.data.error)

        return response_code.data.stdout or ""
