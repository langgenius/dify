"""Compatibility exports for the canonical ordinary code-execution client."""

from clients.code_execution import (
    _CODE_EXECUTOR_CLIENT_KEY,
    _CODE_EXECUTOR_CLIENT_LIMITS,
    CODE_EXECUTION_SSL_VERIFY,
    OrdinaryCodeExecutionTransport,
    _build_code_executor_client,
    code_execution_endpoint_url,
)
from runtime_contracts.code_execution import CodeExecutionError, CodeExecutionResponse

__all__ = [
    "CODE_EXECUTION_SSL_VERIFY",
    "_CODE_EXECUTOR_CLIENT_KEY",
    "_CODE_EXECUTOR_CLIENT_LIMITS",
    "CodeExecutionError",
    "CodeExecutionResponse",
    "OrdinaryCodeExecutionTransport",
    "_build_code_executor_client",
    "code_execution_endpoint_url",
]
