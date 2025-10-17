from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from typing import TypedDict

from pydantic import BaseModel


class VariableConfig(TypedDict):
    variable: str
    value_selector: Sequence[str | int]


class OutputConfig(TypedDict):
    type: str
    children: None


class CodeConfig(TypedDict):
    variables: Sequence[VariableConfig]
    code_language: str
    code: str
    outputs: Mapping[str, OutputConfig]


class DefaultConfig(TypedDict):
    type: str
    config: CodeConfig


class CodeNodeProvider(BaseModel, ABC):
    @staticmethod
    @abstractmethod
    def get_language() -> str:
        pass

    @classmethod
    def is_accept_language(cls, language: str) -> bool:
        return language == cls.get_language()

    @classmethod
    @abstractmethod
    def get_default_code(cls) -> str:
        """
        get default code in specific programming language for the code node
        """
        pass

    @classmethod
    def get_default_config(cls) -> DefaultConfig:
        return {
            "type": "code",
            "config": {
                "variables": [
                    {"variable": "arg1", "value_selector": []},
                    {"variable": "arg2", "value_selector": []},
                ],
                "code_language": cls.get_language(),
                "code": cls.get_default_code(),
                "outputs": {"result": {"type": "string", "children": None}},
            },
        }
