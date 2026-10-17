from __future__ import annotations

from collections.abc import Mapping
from typing import Any, override

from graphon.nodes.code.code_node import CodeExecutorProtocol
from graphon.nodes.code.entities import CodeLanguage
from graphon.template_rendering import Jinja2TemplateRenderer, TemplateRenderError

from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor


class CodeExecutorJinja2TemplateRenderer(Jinja2TemplateRenderer):
    """Sandbox-backed Jinja2 renderer for workflow-owned node composition."""

    def __init__(self, *, executor: CodeExecutorProtocol | None = None):
        # Ordinary callers preserve their existing sandbox path; native callers
        # explicitly inject their actual per-node executor.
        self._executor = executor

    @override
    def render_template(self, template: str, variables: Mapping[str, Any]) -> str:
        try:
            execute = (
                CodeExecutor.execute_workflow_code_template
                if self._executor is None
                else self._executor.execute
            )
            result = execute(
                language=CodeLanguage.JINJA2,
                code=template,
                inputs=variables,
            )
        except Exception as exc:
            if isinstance(exc, CodeExecutionError):
                raise TemplateRenderError(str(exc)) from exc
            raise

        rendered = result.get("result")
        if not isinstance(rendered, str):
            raise TemplateRenderError("Template render result must be a string.")
        return rendered
