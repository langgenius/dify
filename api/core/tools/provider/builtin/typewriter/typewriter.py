from typing import Any

from core.tools.errors import ToolProviderCredentialValidationError
from core.tools.provider.builtin.typewriter.tools.markdown_to_html import MarkdownToHtmlFile
from core.tools.provider.builtin_tool_provider import BuiltinToolProviderController


class MathsProvider(BuiltinToolProviderController):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            MarkdownToHtmlFile().invoke(
                user_id="",
                tool_parameters={
                    "markdown_text": """
                        # Markdown to HTML
                        This is a markdown text.
                    """,
                },
            )
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))
