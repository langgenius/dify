from textwrap import dedent
from typing import override

from core.helper.code_executor.code_executor import CodeLanguage
from core.helper.code_executor.code_node_provider import CodeNodeProvider


class Python3CodeProvider(CodeNodeProvider):
    @staticmethod
    @override
    def get_language() -> str:
        return CodeLanguage.PYTHON3

    @classmethod
    @override
    def get_default_code(cls) -> str:
        return dedent(
            """
            def main(arg1: str, arg2: str):
                return {
                    "result": arg1 + arg2,
                }
            """
        )
