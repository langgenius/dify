from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor, CodeLanguage


class TemplateRenderError(ValueError):
    """Raised when rendering a Jinja2 template fails."""


class Jinja2TemplateRenderer(Protocol):
    """Render Jinja2 templates for template transform nodes."""

    def render_template(self, template: str, variables: Mapping[str, Any]) -> str:
        """Render a Jinja2 template with provided variables."""
        raise NotImplementedError


class CodeExecutorJinja2TemplateRenderer(Jinja2TemplateRenderer):
    """Adapter that renders Jinja2 templates via CodeExecutor."""

    _code_executor: type[CodeExecutor]

    def __init__(self, code_executor: type[CodeExecutor] | None = None) -> None:
        self._code_executor = code_executor or CodeExecutor

    def render_template(self, template: str, variables: Mapping[str, Any]) -> str:
        try:
            result = self._code_executor.execute_workflow_code_template(
                language=CodeLanguage.JINJA2, code=template, inputs=variables
            )
        except CodeExecutionError as exc:
            raise TemplateRenderError(str(exc)) from exc

        rendered = result.get("result")
        if not isinstance(rendered, str):
            raise TemplateRenderError("Template render result must be a string.")
        return rendered
