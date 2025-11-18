from core.observability.otel.core.registry import register_span_handler

from .app_generate import AppGenerateHandler

register_span_handler("app.generate", AppGenerateHandler())

__all__ = ["AppGenerateHandler"]

