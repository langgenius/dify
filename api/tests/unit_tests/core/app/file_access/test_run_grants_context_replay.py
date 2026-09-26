from __future__ import annotations

import contextvars
import threading

from context.execution_context import ExecutionContext
from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.app.file_access import (
    FileAccessScope,
    bind_file_access_run_grants,
    bind_file_access_scope,
    grant_retriever_segment_access,
    is_retriever_segment_access_granted,
    reset_file_access_run_grants,
)
from core.app.file_access.run_grants import FileAccessRunGrants


def _replay_node_boundary(execution_context: ExecutionContext) -> None:
    with execution_context:
        pass


def test_end_user_grants_survive_execution_context_replay_across_threads() -> None:
    """Mirrors graphon workers replaying a frozen contextvars snapshot between nodes."""
    run_grants = FileAccessRunGrants()
    scope = FileAccessScope(
        tenant_id="tenant",
        user_id="user",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.SERVICE_API,
    )

    with bind_file_access_scope(scope):
        grants_token = bind_file_access_run_grants(run_grants)
        try:
            snapshot = contextvars.copy_context()
            execution_context = ExecutionContext(context_vars=snapshot)

            def retrieval_node() -> None:
                with execution_context:
                    grant_retriever_segment_access(["seg-1", "seg-2", "seg-3"])

            retrieval_node()
            _replay_node_boundary(execution_context)

            gate_results: list[bool] = []

            def llm_node() -> None:
                with execution_context:
                    gate_results.append(is_retriever_segment_access_granted("seg-1"))

            llm_thread = threading.Thread(target=llm_node)
            llm_thread.start()
            llm_thread.join()

            assert gate_results == [True]
        finally:
            reset_file_access_run_grants(grants_token)


def test_account_bypasses_gate_without_run_grants() -> None:
    scope = FileAccessScope(
        tenant_id="tenant",
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
    )
    with bind_file_access_scope(scope):
        assert is_retriever_segment_access_granted("any-segment") is True
