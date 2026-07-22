from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import DifyRunContext, InvokeFrom, UserFrom
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.builtin_tool.providers.knowledge_fs.knowledge_fs import KnowledgeFSProvider
from core.tools.builtin_tool.providers.knowledge_fs.tools.create_research_task import (
    KnowledgeFSCreateResearchTaskTool,
)
from core.tools.entities.tool_entities import ToolInvokeFrom, ToolInvokeMessage
from core.tools.errors import ToolInvokeError
from models.knowledge_fs import KnowledgeFSAppSpaceJoinType
from services.knowledge_fs.app_execution_capability import KnowledgeResourceRef
from services.knowledge_fs.product_dto import (
    KnowledgeFSResearchTaskCreatePayload,
    KnowledgeFSResearchTaskResponse,
)


class AppCapabilities:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def create_research_task(self, **kwargs: object) -> KnowledgeFSResearchTaskResponse:
        self.calls.append(kwargs)
        return KnowledgeFSResearchTaskResponse.model_validate(
            {
                "id": "task-1",
                "knowledgeSpaceId": "space-1",
                "query": "question",
                "cost": {},
                "stage": "queued",
                "metadata": {},
                "createdAt": 1.0,
                "updatedAt": 1.0,
            }
        )


def _run_context() -> DifyRunContext:
    return DifyRunContext(
        tenant_id="tenant-from-context",
        app_id="app-from-context",
        user_id="user-1",
        user_from=UserFrom.END_USER,
        invoke_from=InvokeFrom.WEB_APP,
        trace_session_id="trace-1",
    )


def _tool(*, tool_invoke_from: ToolInvokeFrom, run_context: DifyRunContext | None):
    provider = KnowledgeFSProvider()
    base_tool = provider.get_tool("create_research_task")
    assert base_tool is not None
    return KnowledgeFSCreateResearchTaskTool(
        provider="knowledge_fs",
        entity=base_tool.entity.model_copy(),
        runtime=ToolRuntime(
            tenant_id="tenant-from-context",
            user_id="user-1",
            invoke_from=InvokeFrom.WEB_APP,
            tool_invoke_from=tool_invoke_from,
            dify_run_context=run_context,
        ),
    )


def test_trusted_run_context_is_runtime_only_and_does_not_change_serialized_tool_config() -> None:
    runtime = ToolRuntime(
        tenant_id="tenant-from-context",
        user_id="user-1",
        invoke_from=InvokeFrom.WEB_APP,
        tool_invoke_from=ToolInvokeFrom.AGENT,
    )

    with_context = runtime.model_copy(update={"dify_run_context": _run_context()})

    assert with_context.model_dump(mode="json") == runtime.model_dump(mode="json")


def test_control_space_resource_ref_is_app_configured_and_hidden_from_the_model() -> None:
    tool = _tool(tool_invoke_from=ToolInvokeFrom.AGENT, run_context=_run_context())

    schema = tool.get_llm_parameters_json_schema()

    assert set(schema["properties"]) == {"query", "mode"}
    assert "resource" not in schema["required"]


@pytest.mark.parametrize(
    ("tool_invoke_from", "caller_kind"),
    [
        (ToolInvokeFrom.AGENT, KnowledgeFSAppSpaceJoinType.AGENT),
        (ToolInvokeFrom.WORKFLOW, KnowledgeFSAppSpaceJoinType.WORKFLOW),
    ],
)
def test_tool_is_a_real_agent_and_workflow_consumer_using_run_context_identity(
    tool_invoke_from: ToolInvokeFrom,
    caller_kind: KnowledgeFSAppSpaceJoinType,
) -> None:
    capabilities = AppCapabilities()
    runtime = SimpleNamespace(app_capabilities=capabilities)
    tool = _tool(tool_invoke_from=tool_invoke_from, run_context=_run_context())
    engine = create_engine("sqlite://")

    with (
        Session(engine) as session,
        patch(
            "core.tools.builtin_tool.providers.knowledge_fs.tools.create_research_task.create_knowledge_fs_runtime",
            return_value=runtime,
        ),
    ):
        messages = list(
            tool.invoke(
                session=session,
                user_id="spoof-user",
                app_id="spoof-app",
                tool_parameters={
                    "resource": {
                        "kind": "knowledge_fs",
                        "control_space_id": "control-1",
                    },
                    "query": "question",
                    "mode": "deep",
                },
            )
        )

    assert len(capabilities.calls) == 1
    call = capabilities.calls[0]
    assert call["run_context"] == _run_context()
    assert call["caller_kind"] is caller_kind
    resource = call["resource"]
    payload = call["payload"]
    assert isinstance(resource, KnowledgeResourceRef)
    assert isinstance(payload, KnowledgeFSResearchTaskCreatePayload)
    assert resource.model_dump(mode="json") == {
        "kind": "knowledge_fs",
        "control_space_id": "control-1",
    }
    assert payload.model_dump(mode="json", exclude_none=True, by_alias=True) == {
        "query": "question",
        "mode": "deep",
        "metadata": {},
    }
    assert len(messages) == 1
    assert messages[0].type is ToolInvokeMessage.MessageType.JSON
    message = messages[0].message
    assert isinstance(message, ToolInvokeMessage.JsonMessage)
    assert message.json_object["id"] == "task-1"


def test_tool_fails_closed_without_a_dify_run_context_before_runtime_io() -> None:
    tool = _tool(tool_invoke_from=ToolInvokeFrom.AGENT, run_context=None)
    engine = create_engine("sqlite://")

    with (
        Session(engine) as session,
        patch(
            "core.tools.builtin_tool.providers.knowledge_fs.tools.create_research_task.create_knowledge_fs_runtime"
        ) as create_runtime,
        pytest.raises(ToolInvokeError),
    ):
        list(
            tool.invoke(
                session=session,
                user_id="user-1",
                app_id="app-1",
                tool_parameters={
                    "resource": {
                        "kind": "knowledge_fs",
                        "control_space_id": "control-1",
                    },
                    "query": "question",
                },
            )
        )

    create_runtime.assert_not_called()


def test_tool_rejects_cross_tenant_and_non_application_callers_before_runtime_io() -> None:
    mismatched_context = _run_context().model_copy(update={"tenant_id": "another-tenant"})
    engine = create_engine("sqlite://")

    for tool in (
        _tool(tool_invoke_from=ToolInvokeFrom.AGENT, run_context=mismatched_context),
        _tool(tool_invoke_from=ToolInvokeFrom.PLUGIN, run_context=_run_context()),
    ):
        with (
            Session(engine) as session,
            patch(
                "core.tools.builtin_tool.providers.knowledge_fs.tools.create_research_task.create_knowledge_fs_runtime"
            ) as create_runtime,
            pytest.raises(ToolInvokeError),
        ):
            list(
                tool.invoke(
                    session=session,
                    user_id="user-1",
                    tool_parameters={"query": "question"},
                )
            )

        create_runtime.assert_not_called()


def test_tool_omits_unspecified_mode_and_maps_invalid_model_input_to_tool_error() -> None:
    capabilities = AppCapabilities()
    runtime = SimpleNamespace(app_capabilities=capabilities)
    tool = _tool(tool_invoke_from=ToolInvokeFrom.AGENT, run_context=_run_context())
    engine = create_engine("sqlite://")

    with (
        Session(engine) as session,
        patch(
            "core.tools.builtin_tool.providers.knowledge_fs.tools.create_research_task.create_knowledge_fs_runtime",
            return_value=runtime,
        ),
    ):
        list(
            tool.invoke(
                session=session,
                user_id="user-1",
                tool_parameters={
                    "resource": {"kind": "knowledge_fs", "control_space_id": "control-1"},
                    "query": "question",
                },
            )
        )

    payload = capabilities.calls[0]["payload"]
    assert isinstance(payload, KnowledgeFSResearchTaskCreatePayload)
    assert payload.model_dump(mode="json", exclude_none=True, by_alias=True) == {
        "query": "question",
        "metadata": {},
    }

    with (
        Session(engine) as session,
        pytest.raises(ToolInvokeError),
    ):
        list(
            tool.invoke(
                session=session,
                user_id="user-1",
                tool_parameters={"resource": {"kind": "not-knowledge-fs"}, "query": "question"},
            )
        )


def test_tool_preserves_explicit_tool_errors_from_the_capability_boundary() -> None:
    tool = _tool(tool_invoke_from=ToolInvokeFrom.AGENT, run_context=_run_context())
    runtime = SimpleNamespace(
        app_capabilities=SimpleNamespace(
            create_research_task=lambda **_: (_ for _ in ()).throw(ToolInvokeError("binding revoked"))
        )
    )
    engine = create_engine("sqlite://")

    with (
        Session(engine) as session,
        patch(
            "core.tools.builtin_tool.providers.knowledge_fs.tools.create_research_task.create_knowledge_fs_runtime",
            return_value=runtime,
        ),
        pytest.raises(ToolInvokeError, match="binding revoked"),
    ):
        list(
            tool.invoke(
                session=session,
                user_id="user-1",
                tool_parameters={
                    "resource": {"kind": "knowledge_fs", "control_space_id": "control-1"},
                    "query": "question",
                },
            )
        )
