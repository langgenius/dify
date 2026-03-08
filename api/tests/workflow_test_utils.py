from collections.abc import Mapping
from typing import Any

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from dify_graph.entities.graph_init_params import GraphInitParams


def build_test_run_context(
    *,
    tenant_id: str = "tenant",
    app_id: str = "app",
    user_id: str = "user",
    user_from: UserFrom | str = UserFrom.ACCOUNT,
    invoke_from: InvokeFrom | str = InvokeFrom.DEBUGGER,
    extra_context: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_user_from = user_from if isinstance(user_from, UserFrom) else UserFrom(user_from)
    normalized_invoke_from = invoke_from if isinstance(invoke_from, InvokeFrom) else InvokeFrom(invoke_from)
    return build_dify_run_context(
        tenant_id=tenant_id,
        app_id=app_id,
        user_id=user_id,
        user_from=normalized_user_from,
        invoke_from=normalized_invoke_from,
        extra_context=extra_context,
    )


def build_test_graph_init_params(
    *,
    workflow_id: str = "workflow",
    graph_config: Mapping[str, Any] | None = None,
    call_depth: int = 0,
    tenant_id: str = "tenant",
    app_id: str = "app",
    user_id: str = "user",
    user_from: UserFrom | str = UserFrom.ACCOUNT,
    invoke_from: InvokeFrom | str = InvokeFrom.DEBUGGER,
    extra_context: Mapping[str, Any] | None = None,
) -> GraphInitParams:
    return GraphInitParams(
        workflow_id=workflow_id,
        graph_config=graph_config or {},
        run_context=build_test_run_context(
            tenant_id=tenant_id,
            app_id=app_id,
            user_id=user_id,
            user_from=user_from,
            invoke_from=invoke_from,
            extra_context=extra_context,
        ),
        call_depth=call_depth,
    )
