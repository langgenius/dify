from collections.abc import Mapping
from typing import Any

from graphon.entities import GraphInitParams
from graphon.runtime import VariablePool
from graphon.variables.variables import Variable

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.workflow.variable_pool_initializer import add_node_inputs_to_pool, add_variables_to_pool


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


def build_test_variable_pool(
    *,
    variables: list[Variable] | tuple[Variable, ...] = (),
    node_id: str | None = None,
    inputs: Mapping[str, Any] | None = None,
) -> VariablePool:
    variable_pool = VariablePool()
    add_variables_to_pool(variable_pool, variables)
    if node_id is not None and inputs is not None:
        add_node_inputs_to_pool(variable_pool, node_id=node_id, inputs=inputs)
    return variable_pool
