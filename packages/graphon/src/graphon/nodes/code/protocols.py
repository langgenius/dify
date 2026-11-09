from __future__ import annotations

from abc import abstractmethod
from collections.abc import Mapping
from typing import Any, Protocol

from .entities import CodeLanguage


class CodeExecutorProtocol(Protocol):
    @abstractmethod
    def execute(
        self,
        *,
        language: CodeLanguage,
        code: str,
        inputs: Mapping[str, Any],
    ) -> Mapping[str, Any]: ...

    @abstractmethod
    def is_execution_error(self, error: Exception) -> bool: ...
