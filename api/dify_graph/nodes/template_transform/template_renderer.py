from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Protocol

from dify_graph.nodes.code.code_node import WorkflowCodeExecutor
from dify_graph.nodes.code.entities import CodeLanguage


class TemplateRenderError(ValueError):
    """Raised when rendering a Jinja2 template fails."""


class Jinja2TemplateRenderer(Protocol):
    """Render Jinja2 templates for template transform nodes."""

    def render_template(self, template: str, variables: Mapping[str, Any]) -> str:
        """Render a Jinja2 template with provided variables."""
        raise NotImplementedError


class CodeExecutorJinja2TemplateRenderer(Jinja2TemplateRenderer):
    """Adapter that renders Jinja2 templates via CodeExecutor."""

    _code_executor: WorkflowCodeExecutor

    def __init__(self, code_executor: WorkflowCodeExecutor) -> None:
        self._code_executor = code_executor

    def render_template(self, template: str, variables: Mapping[str, Any]) -> str:
        try:
            result = self._code_executor.execute(language=CodeLanguage.JINJA2, code=template, inputs=variables)
        except Exception as exc:
            if self._code_executor.is_execution_error(exc):
                raise TemplateRenderError(str(exc)) from exc
            raise

        rendered = result.get("result")
        if not isinstance(rendered, str):
            raise TemplateRenderError("Template render result must be a string.")
        return rendered
