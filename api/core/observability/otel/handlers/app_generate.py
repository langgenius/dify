from collections.abc import Callable, Mapping
from typing import Any

from opentelemetry.util.types import AttributeValue

from core.observability.otel.core.handler import SpanHandler
from models.model import Account


class AppGenerateHandler(SpanHandler):
    """Span handler for ``AppGenerateService.generate``."""

    def build_attributes(
        self,
        wrapped: Callable[..., Any],
        args: tuple[Any, ...],
        kwargs: Mapping[str, Any],
    ) -> dict[str, AttributeValue]:
        if len(args) < 4:
            return {}

        app_model = args[1]
        user = args[2]
        invoke_from_args = args[3] if len(args) > 3 else {}
        invoke_from = args[4] if len(args) > 4 else None
        streaming = args[5] if len(args) > 5 else True
        root_node_id = args[6] if len(args) > 6 else None

        if not isinstance(invoke_from_args, dict):
            return {}

        attributes: dict[str, AttributeValue] = {
            "app.id": app_model.id,
            "app.mode": app_model.mode.value if hasattr(app_model.mode, "value") else str(app_model.mode),
            "tenant.id": app_model.tenant_id,
            "user.id": user.id,
            "user.type": "Account" if isinstance(user, Account) else "EndUser",
            "streaming": streaming,
        }

        if root_node_id:
            attributes["workflow.root_node_id"] = root_node_id

        workflow_id = invoke_from_args.get("workflow_id")
        if workflow_id:
            attributes["workflow.id"] = workflow_id

        if invoke_from:
            attributes["invoke_from"] = invoke_from.value if hasattr(invoke_from, "value") else str(invoke_from)

        return attributes

