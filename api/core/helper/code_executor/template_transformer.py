from abc import ABC, abstractmethod
from typing import Optional

from core.helper.code_executor.entities import CodeDependency


class TemplateTransformer(ABC):
    @classmethod
    @abstractmethod
    def transform_caller(cls, code: str, inputs: dict, 
                         dependencies: Optional[list[CodeDependency]] = None) -> tuple[str, str, list[CodeDependency]]:
        """
        Transform code to python runner
        :param code: code
        :param inputs: inputs
        :return: runner, preload
        """
        pass
    
    @classmethod
    @abstractmethod
    def transform_response(cls, response: str) -> dict:
        """
        Transform response to dict
        :param response: response
        :return:
        """
        pass