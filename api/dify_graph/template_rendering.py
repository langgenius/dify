from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping
from typing import Any


class TemplateRenderError(ValueError):
    """Raised when rendering a template fails."""


class Jinja2TemplateRenderer(ABC):
    """Nominal renderer contract for Jinja2 template rendering in graph nodes."""

    @abstractmethod
    def render_template(self, template: str, variables: Mapping[str, Any]) -> str:
        """Render the template into plain text."""
        raise NotImplementedError
