from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from graphon.nodes.code.entities import CodeLanguage
from graphon.template_rendering import Jinja2TemplateRenderer, TemplateRenderError

from core.helper.code_executor.code_executor import CodeExecutionError, CodeExecutor


class CodeExecutorJinja2TemplateRenderer(Jinja2TemplateRenderer):
    """Sandbox-backed Jinja2 renderer for workflow-owned node composition."""

    def render_template(self, template: str, variables: Mapping[str, Any]) -> str:
        try:
            result = CodeExecutor.execute_workflow_code_template(
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
