from collections.abc import Callable, Mapping
from typing import Any

from opentelemetry.trace import SpanKind, Status, StatusCode
from opentelemetry.util.types import AttributeValue

from core.observability.otel.core.handler import SpanHandler
from models.model import Account


class AppGenerateHandler(SpanHandler):
    """Span handler for ``AppGenerateService.generate``."""

    def wrapper(
        self,
        tracer: Any,
        wrapped: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: Mapping[str, Any],
    ) -> Any:
        if len(args) < 4:
            return wrapped(*args, **kwargs)

        app_model = args[1]
        user = args[2]
        invoke_from_args = args[3] if len(args) > 3 else {}
        invoke_from = args[4] if len(args) > 4 else None
        streaming = args[5] if len(args) > 5 else True

        if not isinstance(invoke_from_args, dict):
            return wrapped(*args, **kwargs)

        attributes: dict[str, AttributeValue] = {
            "app.id": app_model.id,
            "tenant.id": app_model.tenant_id,
            "user.id": user.id,
            "user.type": "Account" if isinstance(user, Account) else "EndUser",
            "streaming": streaming,
        }

        workflow_id = invoke_from_args.get("workflow_id")
        if workflow_id:
            attributes["workflow.id"] = workflow_id

        if invoke_from:
            attributes["invoke_from"] = invoke_from.value if hasattr(invoke_from, "value") else str(invoke_from)

        with tracer.start_as_current_span("app.generate", kind=SpanKind.INTERNAL, attributes=attributes) as span:
            try:
                result = wrapped(*args, **kwargs)
                span.set_status(Status(StatusCode.OK))
                return result
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                raise

