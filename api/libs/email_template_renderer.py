"""
Email template rendering helpers with configurable safety modes.
"""

import time
from collections.abc import Mapping
from typing import Any

from flask import render_template_string
from jinja2.runtime import Context
from jinja2.sandbox import ImmutableSandboxedEnvironment

from configs import dify_config
from configs.feature import TemplateMode


class SandboxedEnvironment(ImmutableSandboxedEnvironment):
    """Sandboxed environment with execution timeout."""

    def __init__(self, timeout: int, *args: Any, **kwargs: Any):
        self._deadline = time.time() + timeout if timeout else None
        super().__init__(*args, **kwargs)

    def call(self, context: Context, obj: Any, *args: Any, **kwargs: Any) -> Any:
        if self._deadline is not None and time.time() > self._deadline:
            raise TimeoutError("Template rendering timeout")
        return super().call(context, obj, *args, **kwargs)


def render_email_template(template: str, substitutions: Mapping[str, str]) -> str:
    """
    Render email template content according to the configured template mode.

    In unsafe mode, Jinja expressions are evaluated directly.
    In sandbox mode, a sandboxed environment with timeout is used.
    In disabled mode, the template is returned without rendering.
    """
    mode = dify_config.MAIL_TEMPLATING_MODE
    timeout = dify_config.MAIL_TEMPLATING_TIMEOUT

    if mode == TemplateMode.UNSAFE:
        return render_template_string(template, **substitutions)
    if mode == TemplateMode.SANDBOX:
        env = SandboxedEnvironment(timeout=timeout)
        tmpl = env.from_string(template)
        return tmpl.render(substitutions)
    if mode == TemplateMode.DISABLED:
        return template
    raise ValueError(f"Unsupported mail templating mode: {mode}")
