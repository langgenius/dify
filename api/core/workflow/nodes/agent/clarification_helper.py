from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from core.repositories.human_input_repository import HumanInputFormRepositoryImpl
from dify_graph.entities.pause_reason import HumanInputRequired
from dify_graph.enums import WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from dify_graph.model_runtime.entities.llm_entities import LLMUsage
from dify_graph.node_events import AgentLogEvent, NodeRunResult, PauseRequestedEvent
from dify_graph.nodes.human_input.entities import HumanInputNodeData
from dify_graph.repositories.human_input_form_repository import FormCreateParams, HumanInputFormRepository

from .entities import AgentClarificationPayload


def _default_form_repository_factory(tenant_id: str) -> HumanInputFormRepository:
    return HumanInputFormRepositoryImpl(tenant_id=tenant_id)


class AgentClarificationHelper:
    """Translate agent clarification payloads into standard workflow pause events."""

    def __init__(
        self,
        *,
        form_repository_factory: Callable[[str], HumanInputFormRepository] | None = None,
    ) -> None:
        self._form_repository_factory = form_repository_factory or _default_form_repository_factory

    def extract_payload(self, json_object: Mapping[str, Any]) -> AgentClarificationPayload | None:
        raw_payload = json_object.get("human_required") or json_object.get("clarification")
        if raw_payload is None:
            return None
        return AgentClarificationPayload.model_validate(raw_payload)

    def build_pause_event(
        self,
        *,
        payload: AgentClarificationPayload,
        tenant_id: str,
        app_id: str,
        workflow_execution_id: str | None,
        node_id: str,
        node_title: str,
        node_execution_id: str,
        tool_info: Mapping[str, Any],
        parameters_for_log: Mapping[str, Any],
        partial_outputs: Mapping[str, Any],
        execution_metadata: Mapping[WorkflowNodeExecutionMetadataKey, Any],
        llm_usage: LLMUsage,
        agent_logs: list[AgentLogEvent],
    ) -> PauseRequestedEvent:
        form_config = payload.to_human_input_node_data(node_title=node_title)
        form_entity = self._form_repository_factory(tenant_id).create_form(
            FormCreateParams(
                app_id=app_id,
                workflow_execution_id=workflow_execution_id,
                node_id=node_id,
                form_config=form_config,
                rendered_content=form_config.form_content,
                delivery_methods=form_config.delivery_methods,
                display_in_ui=payload.display_in_ui,
                resolved_default_values={},
                # Match HumanInputNode's baseline behavior so non-UI clarifications are still recoverable in Console.
                backstage_recipient_required=True,
            )
        )

        pause_info = self._build_pause_info(
            payload=payload,
            form_config=form_config,
            form_id=form_entity.id,
            form_token=form_entity.web_app_token,
            node_id=node_id,
            node_execution_id=node_execution_id,
            node_title=node_title,
            tool_info=tool_info,
        )
        pause_metadata = {
            **execution_metadata,
            WorkflowNodeExecutionMetadataKey.TOOL_INFO: tool_info,
            WorkflowNodeExecutionMetadataKey.AGENT_LOG: agent_logs,
            WorkflowNodeExecutionMetadataKey.PAUSE_INFO: pause_info,
        }

        return PauseRequestedEvent(
            reason=HumanInputRequired(
                form_id=form_entity.id,
                form_content=form_entity.rendered_content,
                inputs=form_config.inputs,
                actions=form_config.user_actions,
                display_in_ui=payload.display_in_ui,
                node_id=node_id,
                node_title=node_title,
                form_token=form_entity.web_app_token,
                resolved_default_values={},
            ),
            node_run_result=NodeRunResult(
                status=WorkflowNodeExecutionStatus.PAUSED,
                inputs=parameters_for_log,
                outputs={**partial_outputs, "clarification": pause_info},
                metadata=pause_metadata,
                llm_usage=llm_usage,
            ),
        )

    @staticmethod
    def _build_pause_info(
        *,
        payload: AgentClarificationPayload,
        form_config: HumanInputNodeData,
        form_id: str,
        form_token: str | None,
        node_id: str,
        node_execution_id: str,
        node_title: str,
        tool_info: Mapping[str, Any],
    ) -> dict[str, Any]:
        required_fields = [
            {"name": field.name, "type": field.type.value}
            for field in payload.normalized_required_fields()
        ]
        return {
            "type": "agent_clarification",
            "human_required": True,
            "resumable": True,
            "question": payload.question,
            "required_fields": required_fields,
            "form_id": form_id,
            "form_token": form_token,
            "form_content": payload.to_form_content(),
            "display_in_ui": payload.display_in_ui,
            "node_id": node_id,
            "node_execution_id": node_execution_id,
            "node_title": node_title,
            "agent_strategy": tool_info.get("agent_strategy"),
            "actions": [action.model_dump(mode="json") for action in form_config.user_actions],
        }
