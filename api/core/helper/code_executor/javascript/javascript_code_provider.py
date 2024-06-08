from textwrap import dedent

from core.helper.code_executor.code_executor import CodeLanguage
from core.helper.code_executor.code_node_provider import CodeNodeProvider


class JavascriptCodeProvider(CodeNodeProvider):
    @staticmethod
    def get_language() -> str:
        return CodeLanguage.JAVASCRIPT

    @classmethod
    def get_default_code(cls) -> str:
        return dedent(
            """
            function main({arg1, arg2}) {
                return {
                    result: arg1 + arg2
                }
            }
            """)
